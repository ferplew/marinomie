import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { orgScope, scopedWhere } from "@/server/scope";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  markIdempotentOperationUncertain,
  releaseIdempotentOperation,
} from "@/server/idempotency";
import {
  createOmieContext,
  customersService,
  isOmieIntegrationError,
} from "@/integrations/omie";
import type { ActorContext } from "@/domain/permissions/authorize";
import { resolveReadScope } from "@/domain/permissions/authorize";
import {
  normalizeState,
  normalizeZipCode,
  splitPhone,
  validateDocument,
} from "./document";

/**
 * Módulo de clientes.
 *
 * É o primeiro fluxo de escrita da plataforma, e por isso concentra três
 * proteções que voltam a aparecer em orçamento e pedido:
 *
 * 1. **Deduplicação por documento** antes de qualquer chamada à Omie.
 * 2. **Código de integração gerado uma única vez** e reutilizado em todo retry.
 * 3. **Resultado incerto nunca vira reenvio automático** — a chave de
 *    idempotência fica reservada e o caso vai para revisão.
 */

export interface CustomerListItem {
  readonly id: string;
  readonly omieId: number | null;
  readonly document: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly email: string | null;
  readonly syncStatus: string;
  readonly lastSyncAt: Date | null;
}

export interface CustomerPage {
  readonly items: readonly CustomerListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

const MAX_PAGE_SIZE = 50;

/**
 * Busca de clientes, já com o escopo do vendedor aplicado na query.
 *
 * O filtro por `ownerSellerLinkId` entra no `where` do Prisma, não como
 * pós-filtro: um bug de paginação não pode expor cliente de outro vendedor.
 */
export async function searchCustomers(
  actor: ActorContext,
  params: { readonly query?: string; readonly page?: number; readonly pageSize?: number } = {},
): Promise<CustomerPage> {
  const scope = resolveReadScope(actor, "customers");
  if (scope.kind === "none") {
    return { items: [], page: 1, pageSize: 0, totalItems: 0, totalPages: 1 };
  }

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const query = params.query?.trim();

  const digitsOnly = query?.replace(/\D/g, "") ?? "";

  const where = scopedWhere(
    actor,
    scope,
    {
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { legalName: { contains: query, mode: "insensitive" as const } },
              { tradeName: { contains: query, mode: "insensitive" as const } },
              ...(digitsOnly.length >= 3
                ? [{ document: { contains: digitsOnly } }]
                : []),
            ],
          }
        : {}),
    },
    "ownerSellerLinkId",
  );

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { legalName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        omieId: true,
        document: true,
        legalName: true,
        tradeName: true,
        email: true,
        syncStatus: true,
        lastSyncAt: true,
      },
    }),
  ]);

  return {
    items: rows,
    page,
    pageSize,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomerById(
  actor: ActorContext,
  customerId: string,
): Promise<CustomerListItem | null> {
  const scope = resolveReadScope(actor, "customers");
  if (scope.kind === "none") return null;

  return prisma.customer.findFirst({
    where: scopedWhere(actor, scope, { id: customerId, deletedAt: null }, "ownerSellerLinkId"),
    select: {
      id: true,
      omieId: true,
      document: true,
      legalName: true,
      tradeName: true,
      email: true,
      syncStatus: true,
      lastSyncAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

export interface CreateCustomerInput {
  readonly document: string;
  readonly legalName: string;
  readonly tradeName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address?: {
    readonly street: string;
    readonly number: string;
    readonly complement?: string;
    readonly district: string;
    readonly city: string;
    readonly state: string;
    readonly zipCode: string;
  };
  /** Gerada pelo cliente no primeiro clique — protege contra duplo envio. */
  readonly idempotencyKey: string;
}

export type CreateCustomerResult =
  | { readonly kind: "created"; readonly customerId: string; readonly omieId: number | null }
  | { readonly kind: "duplicate"; readonly customerId: string; readonly message: string }
  | { readonly kind: "in_progress" }
  | { readonly kind: "invalid"; readonly field: string; readonly message: string }
  | { readonly kind: "uncertain"; readonly customerId: string; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export async function createCustomer(
  actor: ActorContext,
  input: CreateCustomerInput,
): Promise<CreateCustomerResult> {
  // 1. Validação de documento antes de tudo. Recusar aqui é barato; descobrir
  //    na emissão da nota é caro.
  const documentCheck = validateDocument(input.document);
  if (!documentCheck.valid) {
    return {
      kind: "invalid",
      field: "document",
      message: documentCheck.reason ?? "Documento inválido.",
    };
  }
  const document = documentCheck.normalized;

  if (input.legalName.trim().length < 3) {
    return {
      kind: "invalid",
      field: "legalName",
      message: "Informe a razão social.",
    };
  }

  // 2. Deduplicação local. A constraint única garante a integridade, mas checar
  //    antes permite responder "esse cliente já existe" em vez de um erro cru.
  const existing = await prisma.customer.findFirst({
    where: orgScope(actor, { document, deletedAt: null }),
    select: { id: true, legalName: true },
  });
  if (existing) {
    return {
      kind: "duplicate",
      customerId: existing.id,
      message: `Já existe um cliente com este documento: ${existing.legalName}.`,
    };
  }

  // 3. Idempotência: quem ganha a corrida executa; quem colide recebe o
  //    resultado da primeira execução.
  const operation = await beginIdempotentOperation<{ customerId: string; omieId: number | null }>({
    organizationId: actor.organizationId,
    scope: "customer.create",
    key: input.idempotencyKey,
  });

  if (operation.kind === "replay") {
    return {
      kind: "created",
      customerId: operation.result.customerId,
      omieId: operation.result.omieId,
    };
  }
  if (operation.kind === "in_progress") {
    return { kind: "in_progress" };
  }

  // 4. Código de integração gerado UMA vez. Todo retry reutiliza este valor —
  //    regenerá-lo é exatamente como se cria cliente duplicado no Omie.
  const integrationCode = `cus_${randomUUID()}`;
  const zipCode = input.address ? normalizeZipCode(input.address.zipCode) : null;
  const state = input.address ? normalizeState(input.address.state) : null;

  if (input.address && (zipCode === null || state === null)) {
    await releaseIdempotentOperation(operation.recordId);
    return {
      kind: "invalid",
      field: zipCode === null ? "zipCode" : "state",
      message: zipCode === null ? "CEP inválido." : "UF inválida.",
    };
  }

  // 5. Grava localmente ANTES de chamar a Omie. Se a chamada falhar, o cadastro
  //    não se perde: fica como LOCAL_ONLY e pode ser reenviado.
  const customer = await prisma.customer.create({
    data: {
      organizationId: actor.organizationId,
      integrationCode,
      document,
      legalName: input.legalName.trim(),
      tradeName: input.tradeName?.trim() ?? null,
      email: input.email?.trim() ?? null,
      phone: input.phone ? (splitPhone(input.phone)?.number ?? null) : null,
      ownerSellerLinkId: actor.sellerLinkId,
      syncStatus: "PENDING",
      ...(input.address && zipCode && state
        ? {
            addresses: {
              create: {
                street: input.address.street,
                number: input.address.number,
                complement: input.address.complement ?? null,
                district: input.address.district,
                city: input.address.city,
                state,
                zipCode,
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  await recordAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "customer.created",
    entityType: "customer",
    entityId: customer.id,
    afterData: { document, legalName: input.legalName, integrationCode },
  });

  // 6. Envio à Omie.
  const phoneParts = input.phone ? splitPhone(input.phone) : null;

  try {
    const context = await createOmieContext({
      organizationId: actor.organizationId,
      priority: "interactive",
    });

    const result = await customersService.upsertCustomerByDocument(context, {
      integrationCode,
      legalName: input.legalName.trim(),
      document,
      tradeName: input.tradeName?.trim() || input.legalName.trim(),
      email: input.email?.trim() ?? "",
      ...(phoneParts ? { phone: phoneParts } : {}),
      ...(input.address && zipCode && state
        ? {
            address: {
              street: input.address.street,
              number: input.address.number,
              ...(input.address.complement
                ? { complement: input.address.complement }
                : {}),
              district: input.address.district,
              city: input.address.city,
              state,
              zipCode,
            },
          }
        : {}),
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        omieId: result.omieId,
        syncStatus: "SYNCED",
        lastSyncAt: new Date(),
        lastSyncAttemptAt: new Date(),
        syncAttempts: { increment: 1 },
        lastSyncError: null,
      },
    });

    await completeIdempotentOperation(
      operation.recordId,
      { customerId: customer.id, omieId: result.omieId },
      { type: "customer", id: customer.id },
    );

    return { kind: "created", customerId: customer.id, omieId: result.omieId };
  } catch (error) {
    const uncertain =
      isOmieIntegrationError(error) && error.disposition === "UNCERTAIN_RESULT";

    const message = isOmieIntegrationError(error)
      ? error.omieDescription ?? error.code
      : "Falha inesperada ao enviar o cliente ao Omie";

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        syncStatus: uncertain ? "CONFLICT" : "FAILED",
        lastSyncAttemptAt: new Date(),
        syncAttempts: { increment: 1 },
        lastSyncError: message.slice(0, 500),
      },
    });

    logger.error(
      {
        customerId: customer.id,
        integrationCode,
        uncertain,
        err: message,
      },
      "Envio de cliente ao Omie falhou",
    );

    if (uncertain) {
      // A chave permanece reservada de propósito: o cliente PODE ter sido
      // criado no Omie. Reenviar às cegas duplicaria o cadastro. A resolução
      // passa por consultar pelo código de integração — job da Fase 6.
      await markIdempotentOperationUncertain(operation.recordId, message);
      return {
        kind: "uncertain",
        customerId: customer.id,
        message:
          "O cliente foi salvo aqui, mas não foi possível confirmar o cadastro no Omie. Ele será verificado automaticamente antes de qualquer novo envio.",
      };
    }

    await releaseIdempotentOperation(operation.recordId);
    return {
      kind: "failed",
      message:
        "O cliente foi salvo localmente, mas o envio ao Omie falhou. Você pode tentar sincronizar novamente.",
    };
  }
}

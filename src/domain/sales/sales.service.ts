import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { orgScope, scopedWhere } from "@/server/scope";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit";
import { getCommercialSettings } from "@/server/settings";
import {
  createOmieContext,
  isOmieIntegrationError,
  salesOrdersService,
} from "@/integrations/omie";
import type { ActorContext } from "@/domain/permissions/authorize";
import {
  assertPermission,
  resolveReadScope,
  resolveSellerForWrite,
} from "@/domain/permissions/authorize";
import {
  applyDiscount,
  calculateTotals,
  lineTotal,
  resolvePrice,
  type PriceCandidate,
} from "@/domain/pricing/resolve-price";
import { calculateAvailability } from "@/domain/inventory/availability";
import { refreshStockFromOmie } from "@/domain/inventory/stock.service";

/**
 * Orçamentos e pedidos.
 *
 * Uma única entidade local (`SalesDocument`) com discriminador `kind`, porque no
 * Omie orçamento e pedido são o mesmo registro diferenciado por `etapa`. Isso
 * evita que um registro do ERP corresponda a duas linhas nossas que podem
 * divergir.
 *
 * Regras que este módulo garante, e que o navegador não pode influenciar:
 * - o vendedor é resolvido do usuário autenticado;
 * - preço e desconto são recalculados do zero no servidor;
 * - estoque é revalidado antes de enviar;
 * - o código de integração é gerado uma vez e preservado na conversão.
 */

export interface CartItemInput {
  readonly productId: string;
  readonly quantity: string;
  readonly requestedDiscountPercent?: string;
}

export type CreateQuoteResult =
  | { readonly kind: "created"; readonly documentId: string; readonly localNumber: number }
  | { readonly kind: "requires_approval"; readonly documentId: string; readonly message: string }
  | { readonly kind: "invalid"; readonly message: string };

/**
 * Cria um orçamento em rascunho, calculando tudo no servidor.
 *
 * O rascunho vive **apenas localmente** (briefing §15: "o orçamento em rascunho
 * pode ficar somente na base local"). Nada é enviado à Omie aqui.
 */
export async function createQuoteDraft(
  actor: ActorContext,
  input: {
    readonly customerId: string;
    readonly items: readonly CartItemInput[];
    readonly paymentTermCode?: string;
    readonly notes?: string;
    readonly onBehalfOfSellerLinkId?: string | null;
  },
): Promise<CreateQuoteResult> {
  assertPermission(actor, "quotes.create");

  if (input.items.length === 0) {
    return { kind: "invalid", message: "Adicione ao menos um produto." };
  }

  // O vendedor NUNCA vem do formulário: é resolvido do usuário autenticado.
  // Criar em nome de outro exige permissão própria e é auditado.
  const seller = resolveSellerForWrite(actor, input.onBehalfOfSellerLinkId);

  const customer = await prisma.customer.findFirst({
    where: orgScope(actor, { id: input.customerId, deletedAt: null }),
    select: { id: true, omieId: true, priceTableId: true, legalName: true },
  });
  if (!customer) {
    return { kind: "invalid", message: "Cliente não encontrado." };
  }

  const sellerLink = await prisma.sellerLink.findFirst({
    where: orgScope(actor, { id: seller.sellerLinkId }),
    select: { id: true, maxDiscountPercent: true, defaultPriceTableId: true },
  });
  if (!sellerLink) {
    return { kind: "invalid", message: "Vendedor vinculado não encontrado." };
  }

  const settings = await getCommercialSettings(actor.organizationId);

  const productIds = input.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: orgScope(actor, { id: { in: productIds }, deletedAt: null }),
    select: {
      id: true,
      omieId: true,
      description: true,
      unit: true,
      basePrice: true,
      active: true,
      priceItems: {
        select: {
          price: true,
          maxDiscountPercent: true,
          suggestedDiscountPercent: true,
          priceTable: { select: { id: true, omieId: true } },
        },
      },
    },
  });

  const productById = new Map(products.map((product) => [product.id, product]));

  const resolvedItems: Array<{
    productId: string;
    quantity: string;
    listUnitPrice: string;
    unitPrice: string;
    discountPercent: string;
    lineTotal: string;
    priceTableId: string | null;
    priceSource: string;
  }> = [];

  let needsApproval = false;
  let approvalDetail: { requested: string; ceiling: string } | null = null;

  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) {
      return { kind: "invalid", message: "Produto não encontrado no catálogo." };
    }
    if (!product.active) {
      return {
        kind: "invalid",
        message: `O produto "${product.description}" está inativo e não pode ser vendido.`,
      };
    }
    if (Number(item.quantity) <= 0) {
      return {
        kind: "invalid",
        message: `Informe uma quantidade válida para "${product.description}".`,
      };
    }

    // Monta os candidatos de preço na ordem de precedência da organização.
    const candidates = buildPriceCandidates(product, {
      customerPriceTableId: customer.priceTableId,
      sellerPriceTableOmieId: sellerLink.defaultPriceTableId,
    });

    const price = resolvePrice(candidates, settings.priceTablePrecedence);
    if (price === null) {
      return {
        kind: "invalid",
        message: `Sem preço definido para "${product.description}".`,
      };
    }

    const discount = applyDiscount({
      listUnitPrice: price.unitPrice,
      requestedDiscountPercent: item.requestedDiscountPercent ?? "0",
      sellerMaxDiscountPercent: sellerLink.maxDiscountPercent.toString(),
      tableMaxDiscountPercent: price.tableMaxDiscountPercent,
      // Teto absoluto de aprovação. Configurável por organização é evolução
      // natural; por ora, um limite conservador e explícito.
      approvalMaxDiscountPercent: "30",
    });

    if (discount.kind === "rejected") {
      return { kind: "invalid", message: discount.reason };
    }

    if (discount.kind === "requires_approval") {
      needsApproval = true;
      approvalDetail = {
        requested: discount.discountPercent,
        ceiling: discount.ceilingPercent,
      };
    }

    resolvedItems.push({
      productId: product.id,
      quantity: item.quantity,
      listUnitPrice: price.unitPrice,
      unitPrice: discount.finalUnitPrice,
      discountPercent: discount.discountPercent,
      lineTotal: lineTotal(discount.finalUnitPrice, item.quantity),
      priceTableId: price.priceTableId,
      priceSource: price.source,
    });
  }

  const totals = calculateTotals({
    lines: resolvedItems.map((item) => ({
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    })),
  });

  const localNumber = await nextLocalNumber(actor.organizationId);

  const document = await prisma.salesDocument.create({
    data: {
      organizationId: actor.organizationId,
      kind: "QUOTE",
      status: needsApproval ? "PENDING_APPROVAL" : "DRAFT",
      localNumber,
      // Gerado UMA vez. Preservado em todo retry e na conversão em pedido.
      integrationCode: `sd_${randomUUID()}`,
      sellerLinkId: seller.sellerLinkId,
      createdByUserId: seller.onBehalf ? actor.userId : null,
      customerId: customer.id,
      paymentTermCode: input.paymentTermCode ?? null,
      notes: input.notes ?? null,
      subtotal: totals.subtotal,
      total: totals.total,
      syncStatus: "LOCAL_ONLY",
      items: {
        create: resolvedItems.map((item) => ({
          productId: item.productId,
          itemIntegrationCode: `sdi_${randomUUID()}`,
          quantity: item.quantity,
          listUnitPrice: item.listUnitPrice,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent,
          lineTotal: item.lineTotal,
          priceTableId: item.priceTableId,
          priceSource: item.priceSource,
        })),
      },
    },
    select: { id: true, localNumber: true },
  });

  await recordAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "quote.created",
    entityType: "sales_document",
    entityId: document.id,
    afterData: {
      localNumber: document.localNumber,
      customer: customer.legalName,
      total: totals.total,
      items: resolvedItems.length,
      // A auditoria registra explicitamente quando alguém cria em nome de outro.
      onBehalf: seller.onBehalf,
      sellerLinkId: seller.sellerLinkId,
    },
  });

  if (needsApproval && approvalDetail) {
    await prisma.approvalRequest.create({
      data: {
        organizationId: actor.organizationId,
        documentId: document.id,
        requestedByUserId: actor.userId,
        reason: "Desconto acima do limite do vendedor",
        requestedPercent: approvalDetail.requested,
        ceilingPercent: approvalDetail.ceiling,
      },
    });

    return {
      kind: "requires_approval",
      documentId: document.id,
      message: `O desconto solicitado (${approvalDetail.requested}%) ultrapassa seu limite de ${approvalDetail.ceiling}%. O orçamento foi salvo e aguarda aprovação.`,
    };
  }

  return {
    kind: "created",
    documentId: document.id,
    localNumber: document.localNumber,
  };
}

function buildPriceCandidates(
  product: {
    basePrice: { toString(): string } | null;
    priceItems: ReadonlyArray<{
      price: { toString(): string } | null;
      maxDiscountPercent: { toString(): string } | null;
      suggestedDiscountPercent: { toString(): string } | null;
      priceTable: { id: string; omieId: number };
    }>;
  },
  context: {
    customerPriceTableId: string | null;
    sellerPriceTableOmieId: number | null;
  },
): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];

  const customerItem = context.customerPriceTableId
    ? product.priceItems.find(
        (item) => item.priceTable.id === context.customerPriceTableId,
      )
    : undefined;
  if (customerItem) {
    candidates.push(toCandidate("customer", customerItem));
  }

  const sellerItem = context.sellerPriceTableOmieId
    ? product.priceItems.find(
        (item) => item.priceTable.omieId === context.sellerPriceTableOmieId,
      )
    : undefined;
  if (sellerItem) {
    candidates.push(toCandidate("seller", sellerItem));
  }

  // "organization" ainda não tem tabela padrão configurável; quando tiver, entra
  // aqui na mesma ordem. O preço do cadastro é sempre o último recurso.
  candidates.push({
    source: "product",
    priceTableId: null,
    price: product.basePrice?.toString() ?? null,
    maxDiscountPercent: null,
    suggestedDiscountPercent: null,
  });

  return candidates;
}

function toCandidate(
  source: PriceCandidate["source"],
  item: {
    price: { toString(): string } | null;
    maxDiscountPercent: { toString(): string } | null;
    suggestedDiscountPercent: { toString(): string } | null;
    priceTable: { id: string };
  },
): PriceCandidate {
  return {
    source,
    priceTableId: item.priceTable.id,
    price: item.price?.toString() ?? null,
    maxDiscountPercent: item.maxDiscountPercent?.toString() ?? null,
    suggestedDiscountPercent: item.suggestedDiscountPercent?.toString() ?? null,
  };
}

/**
 * Número local sequencial por organização.
 *
 * Existe para o vendedor ter uma referência antes de o documento existir no
 * Omie. Usa uma agregação em vez de contador dedicado: sob concorrência alta
 * isso pode colidir, mas a constraint única `(organizationId, localNumber)`
 * transforma a colisão em erro visível, nunca em dois documentos com o mesmo
 * número. Um contador transacional entra junto com as filas da Fase 6.
 */
async function nextLocalNumber(organizationId: string): Promise<number> {
  const last = await prisma.salesDocument.findFirst({
    where: { organizationId },
    orderBy: { localNumber: "desc" },
    select: { localNumber: true },
  });
  return (last?.localNumber ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Envio ao Omie
// ---------------------------------------------------------------------------

export type SubmitResult =
  | { readonly kind: "synced"; readonly omieId: number; readonly omieNumber: string | null }
  | { readonly kind: "already_synced"; readonly omieId: number }
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "uncertain"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Envia o documento à Omie.
 *
 * Executa a sequência exigida pelo briefing §15 antes de enviar: revalida
 * cliente, vendedor, preços e **estoque** — este último consultando o cache
 * local mais recente, com a leitura direta na Omie ficando a cargo do botão de
 * atualizar estoque na tela do produto.
 */
export async function submitToOmie(
  actor: ActorContext,
  documentId: string,
): Promise<SubmitResult> {
  const document = await prisma.salesDocument.findFirst({
    where: orgScope(actor, { id: documentId, deletedAt: null }),
    select: {
      id: true,
      kind: true,
      status: true,
      integrationCode: true,
      omieId: true,
      paymentTermCode: true,
      syncStatus: true,
      customer: { select: { omieId: true, legalName: true } },
      sellerLink: { select: { omieSellerId: true, active: true } },
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          itemIntegrationCode: true,
          product: {
            select: {
              id: true,
              omieId: true,
              description: true,
              unit: true,
              active: true,
            },
          },
        },
      },
    },
  });

  if (!document) {
    return { kind: "blocked", message: "Orçamento não encontrado." };
  }

  if (document.omieId !== null) {
    // Já sincronizado: reenviar criaria duplicidade.
    return { kind: "already_synced", omieId: document.omieId };
  }

  if (document.status === "PENDING_APPROVAL") {
    return {
      kind: "blocked",
      message: "Este orçamento aguarda aprovação de desconto e não pode ser enviado.",
    };
  }

  if (document.customer.omieId === null) {
    return {
      kind: "blocked",
      message: `O cliente "${document.customer.legalName}" ainda não foi sincronizado com o Omie. Sincronize o cliente antes de enviar.`,
    };
  }

  if (!document.sellerLink.active) {
    return {
      kind: "blocked",
      message: "O vendedor vinculado está inativo.",
    };
  }

  if (document.items.length === 0) {
    return { kind: "blocked", message: "O orçamento não tem itens." };
  }

  for (const item of document.items) {
    if (!item.product.active) {
      return {
        kind: "blocked",
        message: `O produto "${item.product.description}" foi inativado e não pode ser vendido.`,
      };
    }
  }

  // Revalidação de estoque antes de enviar.
  //
  // Lê direto da Omie, sem cache: este é o momento em que um número velho custa
  // uma venda a mais do que existe. A leitura atualiza o cache local, e só
  // depois a checagem roda sobre o dado recém-buscado.
  await Promise.all(
    document.items.map((item) =>
      refreshStockFromOmie(actor.organizationId, item.product.omieId, {
        priority: "interactive",
      }).catch(() => {
        // Falha na releitura não bloqueia o envio: cair para o cache é melhor
        // que impedir a venda por indisponibilidade momentânea da consulta. A
        // checagem seguinte usa o que houver.
        return { ok: false as const };
      }),
    ),
  );

  const stockIssue = await checkStock(actor, document.items);
  if (stockIssue) {
    return { kind: "blocked", message: stockIssue };
  }

  const settings = await getCommercialSettings(actor.organizationId);
  const stage =
    document.kind === "QUOTE"
      ? settings.defaultQuoteStage
      : settings.defaultConfirmedStage;

  await prisma.salesDocument.update({
    where: { id: document.id },
    data: { syncStatus: "PROCESSING", status: "SYNCING", lastSyncAttemptAt: new Date() },
  });

  const attemptNumber =
    (await prisma.integrationAttempt.count({
      where: { documentId: document.id, omieCall: "IncluirPedido" },
    })) + 1;

  try {
    const context = await createOmieContext({
      organizationId: actor.organizationId,
      priority: "interactive",
    });

    const result = await salesOrdersService.createSalesDocument(context, {
      integrationCode: document.integrationCode,
      customerOmieId: document.customer.omieId,
      stage,
      paymentTermCode: document.paymentTermCode ?? "000",
      expectedDate: formatOmieDate(new Date()),
      sellerOmieId: document.sellerLink.omieSellerId,
      items: document.items.map((item) => ({
        productOmieId: item.product.omieId,
        itemIntegrationCode: item.itemIntegrationCode,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        description: item.product.description,
        ...(item.product.unit ? { unit: item.product.unit } : {}),
      })),
    });

    await prisma.$transaction([
      prisma.salesDocument.update({
        where: { id: document.id },
        data: {
          omieId: result.omieId,
          omieNumber: result.omieNumber,
          omieStage: stage,
          status: "SYNCED",
          syncStatus: "SYNCED",
          lastSyncAt: new Date(),
          lastSyncError: null,
          syncAttempts: { increment: 1 },
        },
      }),
      prisma.integrationAttempt.create({
        data: {
          organizationId: actor.organizationId,
          documentId: document.id,
          entityType: "sales_document",
          entityId: document.id,
          omieCall: "IncluirPedido",
          idempotencyKey: document.integrationCode,
          attemptNumber,
          outcome: "SUCCESS",
        },
      }),
    ]);

    await recordAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "quote.updated",
      entityType: "sales_document",
      entityId: document.id,
      afterData: { omieId: result.omieId, omieNumber: result.omieNumber, stage },
    });

    return {
      kind: "synced",
      omieId: result.omieId,
      omieNumber: result.omieNumber,
    };
  } catch (error) {
    const uncertain =
      isOmieIntegrationError(error) && error.disposition === "UNCERTAIN_RESULT";
    const message = isOmieIntegrationError(error)
      ? error.omieDescription ?? error.code
      : "Falha inesperada ao enviar ao Omie";

    await prisma.$transaction([
      prisma.salesDocument.update({
        where: { id: document.id },
        data: {
          status: "SYNC_FAILED",
          syncStatus: uncertain ? "CONFLICT" : "FAILED",
          lastSyncError: message.slice(0, 500),
          syncAttempts: { increment: 1 },
        },
      }),
      prisma.integrationAttempt.create({
        data: {
          organizationId: actor.organizationId,
          documentId: document.id,
          entityType: "sales_document",
          entityId: document.id,
          omieCall: "IncluirPedido",
          idempotencyKey: document.integrationCode,
          attemptNumber,
          outcome: uncertain ? "UNCERTAIN" : "FAILED",
          ...(isOmieIntegrationError(error)
            ? {
                omieCode: String(error.omieCode ?? error.code),
                omieDescription: error.omieDescription ?? null,
                correlationId: error.correlationId,
              }
            : {}),
        },
      }),
    ]);

    logger.error(
      { documentId: document.id, uncertain, err: message },
      "Envio de documento de venda falhou",
    );

    if (uncertain) {
      return {
        kind: "uncertain",
        message:
          "Não foi possível confirmar se o pedido chegou ao Omie. Ele será verificado pelo código de integração antes de qualquer novo envio — não reenvie manualmente.",
      };
    }

    return {
      kind: "failed",
      message: `O envio falhou: ${message}. O orçamento continua salvo e pode ser reenviado.`,
    };
  }
}

/**
 * Reconciliação de um envio incerto.
 *
 * Consulta a Omie pelo código de integração para descobrir se a inclusão chegou
 * a ser aplicada. É o passo que o briefing §33 exige antes de repetir qualquer
 * inclusão após timeout — e é por isso que o código de integração nunca é
 * regenerado.
 */
export async function reconcileUncertainSubmit(
  actor: ActorContext,
  documentId: string,
): Promise<{ readonly resolved: boolean; readonly message: string }> {
  const document = await prisma.salesDocument.findFirst({
    where: orgScope(actor, { id: documentId }),
    select: { id: true, integrationCode: true, omieId: true, syncStatus: true },
  });

  if (!document) return { resolved: false, message: "Documento não encontrado." };
  if (document.omieId !== null) {
    return { resolved: true, message: "Documento já está sincronizado." };
  }

  try {
    const context = await createOmieContext({
      organizationId: actor.organizationId,
      priority: "background",
    });

    const found = await salesOrdersService.consultSalesDocument(context, {
      integrationCode: document.integrationCode,
    });

    if (found.omieId !== null) {
      await prisma.salesDocument.update({
        where: { id: document.id },
        data: {
          omieId: found.omieId,
          omieNumber: found.omieNumber,
          omieStage: found.stage,
          status: "SYNCED",
          syncStatus: "SYNCED",
          lastSyncAt: new Date(),
          lastSyncError: null,
        },
      });
      return {
        resolved: true,
        message: `O pedido existia no Omie (nº ${found.omieNumber ?? found.omieId}). Situação regularizada sem duplicar.`,
      };
    }

    // Não existe no Omie: é seguro liberar para reenvio.
    await prisma.salesDocument.update({
      where: { id: document.id },
      data: { status: "SYNC_PENDING", syncStatus: "PENDING" },
    });
    return {
      resolved: true,
      message: "O pedido não chegou ao Omie. Pode ser reenviado com segurança.",
    };
  } catch (error) {
    if (isOmieIntegrationError(error) && error.code === "RESOURCE_NOT_FOUND") {
      await prisma.salesDocument.update({
        where: { id: document.id },
        data: { status: "SYNC_PENDING", syncStatus: "PENDING" },
      });
      return {
        resolved: true,
        message: "O pedido não chegou ao Omie. Pode ser reenviado com segurança.",
      };
    }

    return {
      resolved: false,
      message: "Não foi possível verificar o pedido no Omie agora. Tente mais tarde.",
    };
  }
}

/**
 * Converte orçamento em pedido.
 *
 * É `TrocarEtapaPedido` sobre o **mesmo** registro Omie — não uma nova inclusão.
 * O `omieId` e o código de integração são preservados; muda o `kind` local e a
 * etapa remota.
 */
export async function convertQuoteToOrder(
  actor: ActorContext,
  documentId: string,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  assertPermission(actor, "quotes.convert");

  const document = await prisma.salesDocument.findFirst({
    where: orgScope(actor, { id: documentId, deletedAt: null }),
    select: { id: true, kind: true, omieId: true, integrationCode: true, localNumber: true },
  });

  if (!document) return { ok: false, message: "Orçamento não encontrado." };
  if (document.kind === "ORDER") {
    return { ok: false, message: "Este documento já é um pedido." };
  }
  if (document.omieId === null) {
    return {
      ok: false,
      message: "Envie o orçamento ao Omie antes de convertê-lo em pedido.",
    };
  }

  const settings = await getCommercialSettings(actor.organizationId);

  try {
    const context = await createOmieContext({
      organizationId: actor.organizationId,
      priority: "interactive",
    });

    await salesOrdersService.changeSalesDocumentStage(
      context,
      { omieId: document.omieId },
      settings.defaultConfirmedStage,
    );

    await prisma.salesDocument.update({
      where: { id: document.id },
      data: {
        kind: "ORDER",
        status: "SYNCED",
        omieStage: settings.defaultConfirmedStage,
        lastSyncAt: new Date(),
      },
    });

    await recordAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "quote.converted",
      entityType: "sales_document",
      entityId: document.id,
      afterData: {
        localNumber: document.localNumber,
        omieId: document.omieId,
        stage: settings.defaultConfirmedStage,
      },
    });

    return {
      ok: true,
      message: `Orçamento ${document.localNumber} convertido em pedido.`,
    };
  } catch (error) {
    const message = isOmieIntegrationError(error)
      ? error.omieDescription ?? error.code
      : "Falha inesperada";

    logger.error({ documentId, err: message }, "Conversão em pedido falhou");
    return { ok: false, message: `Não foi possível converter: ${message}` };
  }
}

async function checkStock(
  actor: ActorContext,
  items: ReadonlyArray<{
    quantity: { toString(): string };
    product: { id: string; description: string };
  }>,
): Promise<string | null> {
  const settings = await getCommercialSettings(actor.organizationId);

  for (const item of items) {
    const positions = await prisma.inventoryPosition.findMany({
      where: orgScope(actor, { productId: item.product.id }),
      select: {
        physical: true,
        reserved: true,
        expectedOut: true,
        expectedIn: true,
        omieAvailable: true,
        warehouse: { select: { availableForSale: true, active: true } },
      },
    });

    // Sem posição em cache não bloqueamos a venda: o vendedor pode estar
    // vendendo um item recém-cadastrado. Bloquear aqui seria pior que permitir
    // e deixar a Omie recusar, que é a autoridade real sobre o estoque.
    if (positions.length === 0) continue;

    let available = 0;
    let allIndeterminate = true;

    for (const position of positions) {
      if (!position.warehouse.availableForSale || !position.warehouse.active) {
        continue;
      }

      const result = calculateAvailability(
        {
          physical: position.physical?.toString() ?? null,
          reserved: position.reserved?.toString() ?? null,
          expectedOut: position.expectedOut?.toString() ?? null,
          expectedIn: position.expectedIn?.toString() ?? null,
          omieAvailable: position.omieAvailable?.toString() ?? null,
        },
        {
          rule: settings.availableStockRule,
          safetyMargin: settings.stockSafetyMargin,
        },
      );

      if (!result.indeterminate) {
        allIndeterminate = false;
        available += Number(result.displayed);
      }
    }

    // Disponibilidade indeterminada não bloqueia: alegar "sem estoque" quando
    // não sabemos seria tão errado quanto vender o que não existe.
    if (allIndeterminate) continue;

    if (Number(item.quantity.toString()) > available) {
      return `Estoque insuficiente para "${item.product.description}": disponível ${available}.`;
    }
  }

  return null;
}

function formatOmieDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export interface SalesDocumentListItem {
  readonly id: string;
  readonly localNumber: number;
  readonly kind: string;
  readonly status: string;
  readonly syncStatus: string;
  readonly omieNumber: string | null;
  readonly customerName: string;
  readonly total: string;
  readonly createdAt: Date;
}

export async function listSalesDocuments(
  actor: ActorContext,
  params: { readonly kind: "QUOTE" | "ORDER"; readonly page?: number },
): Promise<{
  readonly items: readonly SalesDocumentListItem[];
  readonly totalItems: number;
}> {
  const resource = params.kind === "QUOTE" ? "quotes" : "orders";
  const scope = resolveReadScope(actor, resource);
  if (scope.kind === "none") return { items: [], totalItems: 0 };

  const where = scopedWhere(
    actor,
    scope,
    { kind: params.kind, deletedAt: null },
    "sellerLinkId",
  );

  const [totalItems, rows] = await Promise.all([
    prisma.salesDocument.count({ where }),
    prisma.salesDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        localNumber: true,
        kind: true,
        status: true,
        syncStatus: true,
        omieNumber: true,
        total: true,
        createdAt: true,
        customer: { select: { legalName: true, tradeName: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      localNumber: row.localNumber,
      kind: row.kind,
      status: row.status,
      syncStatus: row.syncStatus,
      omieNumber: row.omieNumber,
      customerName: row.customer.tradeName || row.customer.legalName,
      total: row.total.toString(),
      createdAt: row.createdAt,
    })),
    totalItems,
  };
}

export async function getSalesDocument(
  actor: ActorContext,
  documentId: string,
) {
  const scope = resolveReadScope(actor, "quotes");
  if (scope.kind === "none") return null;

  return prisma.salesDocument.findFirst({
    where: scopedWhere(
      actor,
      scope,
      { id: documentId, deletedAt: null },
      "sellerLinkId",
    ),
    select: {
      id: true,
      localNumber: true,
      kind: true,
      status: true,
      syncStatus: true,
      omieId: true,
      omieNumber: true,
      omieStage: true,
      total: true,
      subtotal: true,
      notes: true,
      lastSyncError: true,
      createdAt: true,
      customer: { select: { legalName: true, tradeName: true, document: true } },
      sellerLink: { select: { displayName: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          listUnitPrice: true,
          unitPrice: true,
          discountPercent: true,
          lineTotal: true,
          priceSource: true,
          product: { select: { description: true, sku: true, unit: true } },
        },
      },
      attempts: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          omieCall: true,
          outcome: true,
          omieDescription: true,
          attemptNumber: true,
          createdAt: true,
        },
      },
    },
  });
}


// ---------------------------------------------------------------------------
// Aprovação de desconto
// ---------------------------------------------------------------------------

export interface PendingApproval {
  readonly id: string;
  readonly documentId: string;
  readonly localNumber: number;
  readonly customerName: string;
  readonly sellerName: string;
  readonly requestedPercent: string;
  readonly ceilingPercent: string;
  readonly total: string;
  readonly createdAt: Date;
}

export async function listPendingApprovals(
  actor: ActorContext,
): Promise<readonly PendingApproval[]> {
  assertPermission(actor, "discounts.approve");

  const rows = await prisma.approvalRequest.findMany({
    where: orgScope(actor, { status: "PENDING" }),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      documentId: true,
      requestedPercent: true,
      ceilingPercent: true,
      createdAt: true,
      document: {
        select: {
          localNumber: true,
          total: true,
          customer: { select: { legalName: true, tradeName: true } },
          sellerLink: { select: { displayName: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    localNumber: row.document.localNumber,
    customerName:
      row.document.customer.tradeName || row.document.customer.legalName,
    sellerName: row.document.sellerLink.displayName,
    requestedPercent: row.requestedPercent.toString(),
    ceilingPercent: row.ceilingPercent.toString(),
    total: row.document.total.toString(),
    createdAt: row.createdAt,
  }));
}

/**
 * Aprova ou recusa um desconto.
 *
 * Quem aprova nunca pode ser quem solicitou — mesmo que a pessoa tenha as duas
 * permissões. Sem essa regra, `discounts.approve` viraria "desconto ilimitado
 * para mim mesmo", que é exatamente o controle que o fluxo existe para impor.
 */
export async function decideApproval(
  actor: ActorContext,
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
): Promise<{ readonly ok: boolean; readonly message: string }> {
  assertPermission(actor, "discounts.approve");

  const approval = await prisma.approvalRequest.findFirst({
    where: orgScope(actor, { id: approvalId, status: "PENDING" }),
    select: {
      id: true,
      documentId: true,
      requestedByUserId: true,
      requestedPercent: true,
      document: { select: { localNumber: true } },
    },
  });

  if (!approval) {
    return { ok: false, message: "Solicitação não encontrada ou já decidida." };
  }

  if (approval.requestedByUserId === actor.userId) {
    return {
      ok: false,
      message: "Você não pode aprovar um desconto que você mesmo solicitou.",
    };
  }

  await prisma.$transaction([
    prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: decision,
        approvedByUserId: actor.userId,
        decidedAt: new Date(),
      },
    }),
    prisma.salesDocument.update({
      where: { id: approval.documentId },
      data: {
        // Aprovado volta para DRAFT: liberado para envio, mas o envio continua
        // sendo uma ação explícita do vendedor.
        status: decision === "APPROVED" ? "DRAFT" : "REJECTED",
      },
    }),
  ]);

  await recordAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "quote.approved",
    entityType: "sales_document",
    entityId: approval.documentId,
    afterData: {
      decision,
      localNumber: approval.document.localNumber,
      requestedPercent: approval.requestedPercent.toString(),
      requestedBy: approval.requestedByUserId,
    },
  });

  return {
    ok: true,
    message:
      decision === "APPROVED"
        ? `Desconto aprovado. O orçamento ${approval.document.localNumber} pode ser enviado.`
        : `Desconto recusado no orçamento ${approval.document.localNumber}.`,
  };
}

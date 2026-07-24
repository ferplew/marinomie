import "server-only";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import { cacheInvalidatePrefix } from "@/server/redis";
import { refreshStockFromOmie } from "@/domain/inventory/stock.service";
import {
  createOmieContext,
  isOmieIntegrationError,
  productsService,
} from "@/integrations/omie";

/**
 * Processamento de eventos de webhook.
 *
 * Princípio central (briefing §6): **o webhook é gatilho, não fonte da verdade.**
 * O payload nunca é aplicado diretamente ao domínio — ele indica *que algo mudou*,
 * e nós consultamos a Omie para saber *o que ficou*. Isso protege contra evento
 * fora de ordem, payload incompleto e — como a Omie não publica assinatura HMAC
 * (docs/known-limitations.md §1, item 2) — contra payload forjado.
 *
 * Como a lista de tópicos também não é pública, o handler é deliberadamente
 * tolerante: o que não é reconhecido vira `UNHANDLED` com o payload bruto
 * preservado, para virar handler específico depois que virmos eventos reais.
 */

/** Extrai o tópico do payload, tentando as formas plausíveis sem inventar. */
export function extractTopic(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  for (const key of ["topic", "topico", "event", "evento"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** Extrai o id do evento, quando presente. */
export function extractEventId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  for (const key of ["messageId", "message_id", "id", "eventId"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

/**
 * Tenta descobrir a qual entidade o evento se refere.
 *
 * Procura identificadores conhecidos da Omie em qualquer profundidade do
 * payload. É heurística assumida como tal — por isso o resultado só serve para
 * escolher *o que consultar*, nunca para escrever direto no banco.
 */
export function extractEntityHint(
  payload: unknown,
): { readonly kind: "product" | "order"; readonly omieId: number } | null {
  const found = findNumericField(payload, [
    "codigo_produto",
    "idProduto",
    "nIdProduto",
    "codigo_pedido",
  ]);
  if (!found) return null;

  return found.key === "codigo_pedido"
    ? { kind: "order", omieId: found.value }
    : { kind: "product", omieId: found.value };
}

function findNumericField(
  input: unknown,
  keys: readonly string[],
  depth = 0,
): { key: string; value: number } | null {
  if (depth > 6 || typeof input !== "object" || input === null) return null;

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findNumericField(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = input as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return { key, value };
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return { key, value: Number(value) };
    }
  }

  for (const value of Object.values(record)) {
    const found = findNumericField(value, keys, depth + 1);
    if (found) return found;
  }

  return null;
}

export async function processWebhookEvent(
  organizationId: string,
  webhookEventId: string,
): Promise<void> {
  const event = await prisma.webhookEvent.findFirst({
    where: { id: webhookEventId, organizationId },
    select: { id: true, status: true, rawPayload: true, topic: true, attempts: true },
  });

  if (!event) {
    logger.warn({ webhookEventId }, "Evento de webhook não encontrado");
    return;
  }

  // Já processado: entrega duplicada que passou pela deduplicação por hash.
  if (event.status === "PROCESSED" || event.status === "DUPLICATE") {
    logger.debug({ webhookEventId }, "Evento já processado, ignorando");
    return;
  }

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  try {
    const hint = extractEntityHint(event.rawPayload);

    if (!hint) {
      // Sem identificador reconhecível: preserva para análise em vez de
      // descartar. O payload bruto é o que permitirá escrever o handler certo.
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: "UNHANDLED",
          processedAt: new Date(),
          lastError:
            "Nenhum identificador conhecido encontrado no payload — handler específico pendente",
        },
      });
      logger.info(
        { webhookEventId, topic: event.topic },
        "Evento de webhook sem handler específico, preservado para análise",
      );
      return;
    }

    // Consulta a Omie para obter o estado atual. O payload não é aplicado.
    if (hint.kind === "product") {
      await refreshProductFromOmie(organizationId, hint.omieId);
      await refreshStockFromOmie(organizationId, hint.omieId, {
        priority: "background",
      });
      await cacheInvalidatePrefix(`org:${organizationId}:product`);
      await cacheInvalidatePrefix(`org:${organizationId}:inventory`);
    } else {
      await refreshSalesDocumentFromOmie(organizationId, hint.omieId);
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = isOmieIntegrationError(error)
      ? `${error.code}: ${error.omieDescription ?? error.message}`
      : String(error);

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", lastError: message.slice(0, 500) },
    });

    logger.error({ webhookEventId, err: message }, "Processamento de webhook falhou");
    throw error;
  }
}

async function refreshProductFromOmie(
  organizationId: string,
  productOmieId: number,
): Promise<void> {
  const context = await createOmieContext({
    organizationId,
    priority: "background",
  });

  const product = await productsService.consultProduct(context, {
    omieId: productOmieId,
  });

  await prisma.product.upsert({
    where: { organizationId_omieId: { organizationId, omieId: product.omieId } },
    update: {
      integrationCode: product.integrationCode,
      sku: product.sku,
      description: product.description,
      unit: product.unit,
      ncm: product.ncm,
      ean: product.ean,
      basePrice: product.basePrice,
      active: product.active,
      syncStatus: "SYNCED",
      lastSyncAt: new Date(),
      sourceUpdatedAt: new Date(),
      version: { increment: 1 },
    },
    create: {
      organizationId,
      omieId: product.omieId,
      integrationCode: product.integrationCode,
      sku: product.sku,
      description: product.description,
      unit: product.unit,
      ncm: product.ncm,
      ean: product.ean,
      basePrice: product.basePrice,
      active: product.active,
      syncStatus: "SYNCED",
      lastSyncAt: new Date(),
    },
  });
}

/**
 * Atualiza a etapa de um documento de venda alterado no Omie.
 *
 * Cobre o caso do briefing §34: "pedido alterado no Omie". Se alguém mover a
 * etapa direto no ERP, o app reflete em vez de mostrar um estado antigo.
 */
async function refreshSalesDocumentFromOmie(
  organizationId: string,
  orderOmieId: number,
): Promise<void> {
  const local = await prisma.salesDocument.findFirst({
    where: { organizationId, omieId: orderOmieId },
    select: { id: true, kind: true, omieStage: true },
  });

  // Pedido criado direto no Omie, sem contrapartida local: não inventamos um
  // registro nosso a partir de um evento. Fica para a reconciliação, quando
  // `ListarPedidos` estiver disponível.
  if (!local) return;

  const { salesOrdersService } = await import("@/integrations/omie");
  const context = await createOmieContext({
    organizationId,
    priority: "background",
  });

  const remote = await salesOrdersService.consultSalesDocument(context, {
    omieId: orderOmieId,
  });

  await prisma.salesDocument.update({
    where: { id: local.id },
    data: {
      omieStage: remote.stage,
      omieNumber: remote.omieNumber,
      lastSyncAt: new Date(),
      // Omie prevalece sobre a situação oficial (briefing §34).
      ...(remote.cancelled ? { status: "CANCELLED" as const } : {}),
    },
  });
}

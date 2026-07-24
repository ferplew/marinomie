import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import { cacheInvalidatePrefix } from "@/server/redis";
import { syncProductsPage } from "@/domain/products/catalog.service";
import {
  refreshStockFromOmie,
  syncWarehouses,
} from "@/domain/inventory/stock.service";
import { reconcileUncertainSubmit } from "@/domain/sales/sales.service";
import { getQueue, QUEUE_NAMES } from "@/server/queue/queues";
import type {
  BaseJobData,
  CustomersSyncJobData,
  DeadLetterJobData,
  InventorySyncJobData,
  ProductsSyncJobData,
  ReconciliationJobData,
  SalesSyncJobData,
  WebhookJobData,
} from "@/server/queue/queues";
import { enqueueProductsSync } from "@/server/queue/enqueue";
import { processWebhookEvent } from "@/domain/webhooks/process-event";

/**
 * Processadores das filas.
 *
 * Cada um segue o mesmo contrato: marca o `SyncJob` como RUNNING, faz o
 * trabalho, e registra COMPLETED ou FAILED com o progresso. O que falha depois
 * de esgotar as tentativas vai para a dead-letter — nunca desaparece
 * silenciosamente (briefing §37: "não silencie erros").
 */

async function markRunning(data: BaseJobData): Promise<void> {
  if (!data.syncJobId) return;
  await prisma.syncJob
    .update({
      where: { id: data.syncJobId },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    })
    .catch(() => undefined);
}

async function markCompleted(
  data: BaseJobData,
  progress: { fetched?: number; changed?: number; cursor?: number },
): Promise<void> {
  if (!data.syncJobId) return;
  await prisma.syncJob
    .update({
      where: { id: data.syncJobId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        totalFetched: progress.fetched ?? 0,
        totalChanged: progress.changed ?? 0,
        cursor: progress.cursor ?? null,
      },
    })
    .catch(() => undefined);
}

async function markFailed(data: BaseJobData, error: string): Promise<void> {
  if (!data.syncJobId) return;
  await prisma.syncJob
    .update({
      where: { id: data.syncJobId },
      data: { status: "FAILED", finishedAt: new Date(), error: error.slice(0, 500) },
    })
    .catch(() => undefined);
}

/**
 * Sincronização de produtos, página a página.
 *
 * Cada job processa **uma** página e enfileira a próxima, em vez de varrer tudo
 * num job só. Isso mantém cada execução curta (não segura um worker por
 * minutos), dá cursor de retomada natural, e distribui as chamadas ao longo do
 * tempo em vez de estourar a janela de 240 req/min de uma vez.
 */
export async function processProductsSync(
  data: ProductsSyncJobData,
): Promise<void> {
  await markRunning(data);

  const result = await syncProductsPage(data.organizationId, {
    page: data.page,
    ...(data.pageSize !== undefined ? { pageSize: data.pageSize } : {}),
  });

  if (result.failed) {
    await markFailed(data, result.error ?? "falha desconhecida");
    throw new Error(result.error ?? "Sincronização de produtos falhou");
  }

  await markCompleted(data, {
    fetched: result.fetched,
    changed: result.upserted,
    cursor: data.page,
  });

  await cacheInvalidatePrefix(`org:${data.organizationId}:catalog`);

  const pageSize = data.pageSize ?? 50;
  // Página cheia sugere que há mais: encadeia a próxima.
  if (result.fetched >= pageSize) {
    await enqueueProductsSync({
      organizationId: data.organizationId,
      page: data.page + 1,
      pageSize,
      source: data.source,
      correlationId: data.correlationId,
    });
  }
}

export async function processInventorySync(
  data: InventorySyncJobData,
): Promise<void> {
  await markRunning(data);

  let changed = 0;
  const failures: string[] = [];

  for (const productOmieId of data.productOmieIds) {
    const result = await refreshStockFromOmie(data.organizationId, productOmieId, {
      priority: "background",
    });
    if (result.ok) changed += 1;
    else failures.push(`${productOmieId}: ${result.error ?? "falha"}`);
  }

  await cacheInvalidatePrefix(`org:${data.organizationId}:inventory`);

  if (failures.length === data.productOmieIds.length && failures.length > 0) {
    // Todas falharam: é problema de integração, não de um produto específico.
    await markFailed(data, failures.slice(0, 3).join("; "));
    throw new Error("Sincronização de estoque falhou para todos os produtos");
  }

  await markCompleted(data, {
    fetched: data.productOmieIds.length,
    changed,
  });
}

export async function processCustomersSync(
  data: CustomersSyncJobData,
): Promise<void> {
  await markRunning(data);
  // A sincronização de clientes Omie→local ainda não está implementada; o
  // caminho existente é local→Omie. Registrar como concluído sem trabalho seria
  // mentir sobre o estado, então falhamos explicitamente.
  await markFailed(
    data,
    "Sincronização de clientes Omie→local ainda não implementada (docs/known-limitations.md)",
  );
  throw new Error("Sincronização de clientes Omie→local não implementada");
}

export async function processSalesSync(data: SalesSyncJobData): Promise<void> {
  await markRunning(data);

  if (data.action !== "reconcile") {
    await markFailed(data, `Ação não suportada: ${data.action}`);
    throw new Error(`Ação não suportada: ${data.action}`);
  }

  // A reconciliação precisa de um ator para o escopo de organização. O worker
  // não tem sessão, então monta um ator de sistema restrito à organização do
  // job — sem permissões, porque nenhuma checagem de permissão se aplica a uma
  // rotina automática.
  const systemActor = {
    userId: "system",
    organizationId: data.organizationId,
    permissions: new Set<never>(),
    sellerLinkId: null,
    active: true,
  };

  const result = await reconcileUncertainSubmit(systemActor, data.documentId);

  if (!result.resolved) {
    await markFailed(data, result.message);
    throw new Error(result.message);
  }

  await markCompleted(data, { changed: 1 });
}

export async function processWebhook(data: WebhookJobData): Promise<void> {
  await processWebhookEvent(data.organizationId, data.webhookEventId);
}

/**
 * Reconciliação periódica.
 *
 * Compara o estado local com a Omie e corrige divergências. Hoje cobre estoque
 * (produtos com leitura mais antiga) e documentos de venda em situação incerta —
 * que são os dois casos onde divergência custa dinheiro.
 */
export async function processReconciliation(
  data: ReconciliationJobData,
): Promise<void> {
  await markRunning(data);

  switch (data.domain) {
    case "products": {
      await syncWarehouses(data.organizationId);
      await enqueueProductsSync({
        organizationId: data.organizationId,
        page: 1,
        source: "reconciliation",
        correlationId: data.correlationId,
      });
      await markCompleted(data, {});
      return;
    }

    case "inventory": {
      // Prioriza os produtos com leitura mais antiga: são os que têm maior
      // chance de estar errados na tela do vendedor.
      const stale = await prisma.inventoryPosition.findMany({
        where: { organizationId: data.organizationId },
        orderBy: { readAt: "asc" },
        take: 20,
        select: { product: { select: { omieId: true } } },
        distinct: ["productId"],
      });

      let changed = 0;
      for (const position of stale) {
        const result = await refreshStockFromOmie(
          data.organizationId,
          position.product.omieId,
          { priority: "background" },
        );
        if (result.ok) changed += 1;
      }

      await cacheInvalidatePrefix(`org:${data.organizationId}:inventory`);
      await markCompleted(data, { fetched: stale.length, changed });
      return;
    }

    case "sales": {
      // Documentos que ficaram em conflito: o envio pode ter sido aplicado no
      // Omie sem confirmação. Consultar pelo código de integração é a única
      // forma segura de resolver.
      const pending = await prisma.salesDocument.findMany({
        where: {
          organizationId: data.organizationId,
          syncStatus: "CONFLICT",
          omieId: null,
        },
        take: 20,
        select: { id: true },
      });

      const systemActor = {
        userId: "system",
        organizationId: data.organizationId,
        permissions: new Set<never>(),
        sellerLinkId: null,
        active: true,
      };

      let changed = 0;
      for (const document of pending) {
        const result = await reconcileUncertainSubmit(systemActor, document.id);
        if (result.resolved) changed += 1;
      }

      await markCompleted(data, { fetched: pending.length, changed });
      return;
    }

    case "customers": {
      await markFailed(
        data,
        "Reconciliação de clientes ainda não implementada (docs/known-limitations.md)",
      );
      throw new Error("Reconciliação de clientes não implementada");
    }
  }
}

/**
 * Move um job definitivamente falho para a dead-letter.
 *
 * Não é uma fila que reprocessa sozinha: é um depósito auditável do que falhou,
 * para o administrador inspecionar e reenfileirar pelo painel.
 */
export async function sendToDeadLetter(input: {
  organizationId: string;
  correlationId: string;
  originalQueue: string;
  originalJobId: string | undefined;
  reason: string;
  payload: unknown;
  syncJobId?: string | undefined;
}): Promise<void> {
  const data: DeadLetterJobData = {
    organizationId: input.organizationId,
    correlationId: input.correlationId,
    source: "dead-letter",
    originalQueue: input.originalQueue,
    originalJobId: input.originalJobId,
    reason: input.reason,
    payload: input.payload,
  };

  try {
    await getQueue<DeadLetterJobData>(QUEUE_NAMES.deadLetter).add("failed", data, {
      // Dead-letter nunca repete sozinha.
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });

    if (input.syncJobId) {
      await prisma.syncJob.update({
        where: { id: input.syncJobId },
        data: { status: "DEAD_LETTER", error: input.reason.slice(0, 500) },
      });
    }
  } catch (error) {
    logger.error(
      { originalQueue: input.originalQueue, err: String(error) },
      "Falha ao mover job para dead-letter",
    );
  }
}

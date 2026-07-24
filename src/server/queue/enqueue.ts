import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import {
  DEFAULT_JOB_OPTIONS,
  getQueue,
  QUEUE_NAMES,
  type CustomersSyncJobData,
  type InventorySyncJobData,
  type ProductsSyncJobData,
  type ReconciliationJobData,
  type SalesSyncJobData,
  type WebhookJobData,
} from "./queues";

/**
 * Enfileiramento com registro auditável.
 *
 * Todo job enfileirado cria um `SyncJob` no Postgres antes de entrar na fila. A
 * fila é volátil e tem retenção curta; a tabela é o histórico que o painel
 * administrativo mostra e que sobrevive a um flush do Redis.
 */
async function createSyncJobRecord(input: {
  organizationId: string;
  queue: string;
  entityType: string;
  correlationId: string;
  triggeredBy: string;
}): Promise<string> {
  const record = await prisma.syncJob.create({
    data: {
      organizationId: input.organizationId,
      queue: input.queue,
      entityType: input.entityType,
      correlationId: input.correlationId,
      triggeredBy: input.triggeredBy,
      status: "QUEUED",
    },
    select: { id: true },
  });
  return record.id;
}

export interface EnqueueOptions {
  readonly organizationId: string;
  readonly source?: string;
  readonly correlationId?: string;
}

export async function enqueueProductsSync(
  options: EnqueueOptions & {
    readonly page?: number;
    readonly pageSize?: number;
    readonly changedSince?: Date;
  },
): Promise<{ readonly syncJobId: string }> {
  const correlationId = options.correlationId ?? randomUUID();
  const syncJobId = await createSyncJobRecord({
    organizationId: options.organizationId,
    queue: QUEUE_NAMES.productsSync,
    entityType: "product",
    correlationId,
    triggeredBy: options.source ?? "manual",
  });

  const data: ProductsSyncJobData = {
    organizationId: options.organizationId,
    correlationId,
    source: options.source ?? "manual",
    syncJobId,
    page: options.page ?? 1,
    ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
    ...(options.changedSince
      ? { changedSince: options.changedSince.toISOString() }
      : {}),
  };

  const job = await getQueue<ProductsSyncJobData>(QUEUE_NAMES.productsSync).add(
    "sync-page",
    data,
  );

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { bullJobId: job.id ?? null },
  });

  return { syncJobId };
}

export async function enqueueInventorySync(
  options: EnqueueOptions & { readonly productOmieIds: readonly number[] },
): Promise<{ readonly syncJobId: string }> {
  const correlationId = options.correlationId ?? randomUUID();
  const syncJobId = await createSyncJobRecord({
    organizationId: options.organizationId,
    queue: QUEUE_NAMES.inventorySync,
    entityType: "inventory",
    correlationId,
    triggeredBy: options.source ?? "manual",
  });

  const data: InventorySyncJobData = {
    organizationId: options.organizationId,
    correlationId,
    source: options.source ?? "manual",
    syncJobId,
    productOmieIds: options.productOmieIds,
  };

  const job = await getQueue<InventorySyncJobData>(
    QUEUE_NAMES.inventorySync,
  ).add("sync-stock", data);

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { bullJobId: job.id ?? null },
  });

  return { syncJobId };
}

export async function enqueueCustomersSync(
  options: EnqueueOptions & { readonly page?: number },
): Promise<{ readonly syncJobId: string }> {
  const correlationId = options.correlationId ?? randomUUID();
  const syncJobId = await createSyncJobRecord({
    organizationId: options.organizationId,
    queue: QUEUE_NAMES.customersSync,
    entityType: "customer",
    correlationId,
    triggeredBy: options.source ?? "manual",
  });

  const data: CustomersSyncJobData = {
    organizationId: options.organizationId,
    correlationId,
    source: options.source ?? "manual",
    syncJobId,
    page: options.page ?? 1,
  };

  const job = await getQueue<CustomersSyncJobData>(
    QUEUE_NAMES.customersSync,
  ).add("sync-page", data);

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { bullJobId: job.id ?? null },
  });

  return { syncJobId };
}

export async function enqueueSalesAction(
  options: EnqueueOptions & {
    readonly documentId: string;
    readonly action: "reconcile" | "resubmit";
  },
): Promise<{ readonly syncJobId: string }> {
  const correlationId = options.correlationId ?? randomUUID();
  const syncJobId = await createSyncJobRecord({
    organizationId: options.organizationId,
    queue: QUEUE_NAMES.salesSync,
    entityType: "sales_document",
    correlationId,
    triggeredBy: options.source ?? "manual",
  });

  const data: SalesSyncJobData = {
    organizationId: options.organizationId,
    correlationId,
    source: options.source ?? "manual",
    syncJobId,
    documentId: options.documentId,
    action: options.action,
  };

  const job = await getQueue<SalesSyncJobData>(QUEUE_NAMES.salesSync).add(
    options.action,
    data,
  );

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { bullJobId: job.id ?? null },
  });

  return { syncJobId };
}

/**
 * Enfileira o processamento de um webhook já persistido.
 *
 * O `jobId` é o próprio id do evento: se a Omie entregar o mesmo evento duas
 * vezes e ambos passarem pela deduplicação por hash, o BullMQ ainda recusa o
 * segundo job pelo id repetido. É a segunda barreira contra reprocessamento.
 */
export async function enqueueWebhookProcessing(options: {
  readonly organizationId: string;
  readonly webhookEventId: string;
  readonly correlationId: string;
}): Promise<void> {
  const data: WebhookJobData = {
    organizationId: options.organizationId,
    correlationId: options.correlationId,
    source: "webhook",
    webhookEventId: options.webhookEventId,
  };

  try {
    await getQueue<WebhookJobData>(QUEUE_NAMES.webhookProcessing).add(
      "process",
      data,
      { ...DEFAULT_JOB_OPTIONS, jobId: options.webhookEventId },
    );
  } catch (error) {
    // Falhar aqui não pode derrubar a resposta ao webhook: o evento já está
    // persistido e pode ser reprocessado pelo painel.
    logger.error(
      { webhookEventId: options.webhookEventId, err: String(error) },
      "Falha ao enfileirar processamento de webhook",
    );
  }
}

export async function enqueueReconciliation(
  options: EnqueueOptions & { readonly domain: ReconciliationJobData["domain"] },
): Promise<{ readonly syncJobId: string }> {
  const correlationId = options.correlationId ?? randomUUID();
  const syncJobId = await createSyncJobRecord({
    organizationId: options.organizationId,
    queue: QUEUE_NAMES.reconciliation,
    entityType: options.domain,
    correlationId,
    triggeredBy: options.source ?? "schedule",
  });

  const data: ReconciliationJobData = {
    organizationId: options.organizationId,
    correlationId,
    source: options.source ?? "schedule",
    syncJobId,
    domain: options.domain,
  };

  const job = await getQueue<ReconciliationJobData>(
    QUEUE_NAMES.reconciliation,
  ).add(`reconcile-${options.domain}`, data);

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { bullJobId: job.id ?? null },
  });

  return { syncJobId };
}

/**
 * Processo de workers.
 *
 * Roda separado do servidor Next (docs/architecture.md §7): um job de
 * sincronização pode levar minutos, e não pode competir com requisições de
 * vendedor pelo event loop. Escala de forma independente — mais réplicas de
 * worker sem replicar o app, e vice-versa.
 *
 * Entrada: `npm run worker`.
 */
import { Worker, type Job } from "bullmq";
import { logger } from "@/lib/logger";
import { getEnv } from "@/env";
import {
  getQueueConnection,
  QUEUE_NAMES,
  type BaseJobData,
  type CustomersSyncJobData,
  type InventorySyncJobData,
  type ProductsSyncJobData,
  type ReconciliationJobData,
  type SalesSyncJobData,
  type WebhookJobData,
} from "@/server/queue/queues";
import {
  processCustomersSync,
  processInventorySync,
  processProductsSync,
  processReconciliation,
  processSalesSync,
  processWebhook,
  sendToDeadLetter,
} from "./processors";

/**
 * Concorrência por fila.
 *
 * Números baixos de propósito: todas as filas compartilham a mesma janela de
 * 240 req/min por organização. Concorrência alta só faria os jobs baterem no
 * limitador e falharem mais rápido — não processariam mais.
 *
 * Webhook tem a maior porque seu trabalho é curto e a Omie reenvia se demorarmos.
 */
const CONCURRENCY: Record<string, number> = {
  [QUEUE_NAMES.productsSync]: 2,
  [QUEUE_NAMES.inventorySync]: 2,
  [QUEUE_NAMES.customersSync]: 2,
  [QUEUE_NAMES.salesSync]: 3,
  [QUEUE_NAMES.webhookProcessing]: 5,
  [QUEUE_NAMES.reconciliation]: 1,
};

const workers: Worker[] = [];

function createWorker<T extends BaseJobData>(
  name: string,
  handler: (data: T) => Promise<void>,
): Worker<T> {
  const worker = new Worker<T>(
    name,
    async (job: Job<T>) => {
      const started = Date.now();
      logger.info(
        {
          queue: name,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          correlationId: job.data.correlationId,
          organizationId: job.data.organizationId,
        },
        "Job iniciado",
      );

      await handler(job.data);

      logger.info(
        { queue: name, jobId: job.id, durationMs: Date.now() - started },
        "Job concluído",
      );
    },
    {
      connection: getQueueConnection(),
      concurrency: CONCURRENCY[name] ?? 1,
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      {
        queue: name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        err: error.message,
      },
      "Job falhou",
    );

    // Esgotou as tentativas: vai para a dead-letter em vez de sumir.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void sendToDeadLetter({
        organizationId: job.data.organizationId,
        correlationId: job.data.correlationId,
        originalQueue: name,
        originalJobId: job.id,
        reason: error.message,
        payload: job.data,
        syncJobId: job.data.syncJobId,
      });
    }
  });

  worker.on("error", (error) => {
    logger.error({ queue: name, err: error.message }, "Erro no worker");
  });

  workers.push(worker as Worker);
  return worker;
}

function start(): void {
  // Valida o ambiente antes de abrir conexões: falhar aqui é melhor que um
  // worker vivo que não consegue trabalhar.
  const env = getEnv();

  logger.info(
    { mockMode: env.OMIE_MOCK_MODE, nodeEnv: env.NODE_ENV },
    "Iniciando workers",
  );

  createWorker<ProductsSyncJobData>(QUEUE_NAMES.productsSync, processProductsSync);
  createWorker<InventorySyncJobData>(QUEUE_NAMES.inventorySync, processInventorySync);
  createWorker<CustomersSyncJobData>(QUEUE_NAMES.customersSync, processCustomersSync);
  createWorker<SalesSyncJobData>(QUEUE_NAMES.salesSync, processSalesSync);
  createWorker<WebhookJobData>(QUEUE_NAMES.webhookProcessing, processWebhook);
  createWorker<ReconciliationJobData>(QUEUE_NAMES.reconciliation, processReconciliation);

  logger.info({ queues: workers.length }, "Workers prontos");
}

/**
 * Encerramento gracioso.
 *
 * `worker.close()` espera os jobs em andamento terminarem. Sem isso, um deploy
 * mataria um envio de pedido no meio — exatamente o cenário de resultado
 * incerto que o sistema todo tenta evitar.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Encerrando workers");
  await Promise.all(workers.map((worker) => worker.close()));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start();

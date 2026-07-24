import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "@/env";

/**
 * Filas BullMQ (briefing §20).
 *
 * Uma fila por domínio, e não uma fila única com tipo no payload: filas
 * separadas permitem concorrência e política de retry diferentes por domínio —
 * sincronizar catálogo pode ser lento e paralelo, processar webhook precisa ser
 * rápido e ordenado.
 *
 * **Nenhum job carrega credencial.** O payload leva `organizationId`, e o worker
 * resolve a credencial cifrada do banco na hora (briefing §20: "não coloque
 * credenciais completas dentro dos jobs"). Um dump da fila no Redis não expõe
 * segredo nenhum.
 */
export const QUEUE_NAMES = {
  productsSync: "omie-products-sync",
  inventorySync: "omie-inventory-sync",
  customersSync: "omie-customers-sync",
  salesSync: "omie-sales-sync",
  webhookProcessing: "omie-webhook-processing",
  reconciliation: "omie-reconciliation",
  deadLetter: "omie-dead-letter",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Payload mínimo comum a todo job. */
export interface BaseJobData {
  readonly organizationId: string;
  readonly correlationId: string;
  /** Quem originou: "manual", "schedule", "webhook". */
  readonly source: string;
  /** Id do registro em `SyncJob`, para o worker atualizar o progresso. */
  readonly syncJobId?: string;
}

export interface ProductsSyncJobData extends BaseJobData {
  readonly page: number;
  readonly pageSize?: number;
  /** Sincronização incremental a partir desta data. */
  readonly changedSince?: string;
}

export interface InventorySyncJobData extends BaseJobData {
  readonly productOmieIds: readonly number[];
}

export interface CustomersSyncJobData extends BaseJobData {
  readonly page: number;
  readonly pageSize?: number;
}

export interface SalesSyncJobData extends BaseJobData {
  /** Documento local a reconciliar/reenviar. */
  readonly documentId: string;
  readonly action: "reconcile" | "resubmit";
}

export interface WebhookJobData extends BaseJobData {
  readonly webhookEventId: string;
}

export interface ReconciliationJobData extends BaseJobData {
  readonly domain: "products" | "inventory" | "customers" | "sales";
}

export interface DeadLetterJobData extends BaseJobData {
  readonly originalQueue: string;
  readonly originalJobId: string | undefined;
  readonly reason: string;
  readonly payload: unknown;
}

/**
 * Conexão dedicada às filas.
 *
 * `maxRetriesPerRequest: null` é exigido pelo BullMQ: com um limite, um blip de
 * rede derrubaria o worker em vez de ele reconectar.
 */
let connection: Redis | null = null;

export function getQueueConnection(): Redis {
  if (connection) return connection;

  connection = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

const queues = new Map<string, Queue>();

/**
 * Política de retry padrão.
 *
 * Backoff exponencial na fila é complementar ao do client Omie: o client repete
 * dentro de uma chamada, a fila repete a operação inteira depois de um intervalo
 * maior. `removeOnComplete` limitado evita que o Redis cresça sem fim; o
 * histórico auditável fica no Postgres (`SyncJob`), não na fila.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 100, age: 24 * 3600 },
  removeOnFail: { count: 500 },
};

export function getQueue<T extends BaseJobData>(name: QueueName): Queue<T> {
  const existing = queues.get(name);
  if (existing) return existing as Queue<T>;

  const queue = new Queue<T>(name, {
    connection: getQueueConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  queues.set(name, queue);
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

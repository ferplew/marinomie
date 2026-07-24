import "server-only";
import { redis } from "@/server/redis";
import { logger, newCorrelationId } from "@/lib/logger";
import { getEnv } from "@/env";
import { OmieClient } from "./client/omie-client";
import { OmieCircuitBreaker } from "./client/circuit-breaker";
import { OmieRateLimiter } from "./client/rate-limiter";
import { HttpOmieTransport, type OmieTransport } from "./client/transport";
import { MockOmieTransport } from "./mock/mock-transport";
import { resolveOmieCredentials } from "./client/credentials";
import type { OmieServiceContext } from "./services/service-context";
import type { RequestPriority } from "./client/rate-limiter";

/**
 * Fachada da integração Omie.
 *
 * É o único ponto que o resto da aplicação importa. Casos de uso pedem um
 * contexto por organização e chamam os services — nunca constroem client,
 * transporte ou credencial por conta própria.
 */

export type { OmieServiceContext } from "./services/service-context";
export type * from "./types/dto";
export { OmieIntegrationError, isOmieIntegrationError } from "./errors/omie-error";
export type {
  OmieIntegrationErrorCode,
  OmieErrorDisposition,
} from "./errors/omie-error";
export { paginate, collectAllPages } from "./client/paginate";
export type { PageResult } from "./client/paginate";

export * as productsService from "./services/products.service";
export * as inventoryService from "./services/inventory.service";
export * as customersService from "./services/customers.service";
export * as sellersService from "./services/sellers.service";
export * as priceTablesService from "./services/price-tables.service";
export * as connectionService from "./services/connection.service";
export * as salesOrdersService from "./services/sales-orders.service";

/**
 * O breaker é in-process e por isso precisa sobreviver aos recarregamentos de
 * módulo do Next em desenvolvimento — senão o estado zeraria a cada alteração de
 * arquivo e o circuito nunca abriria.
 */
const globalForOmie = globalThis as unknown as {
  omieClient: OmieClient | undefined;
  omieBreaker: OmieCircuitBreaker | undefined;
};

function createTransport(): OmieTransport {
  return getEnv().OMIE_MOCK_MODE
    ? new MockOmieTransport()
    : new HttpOmieTransport();
}

function getClient(): OmieClient {
  if (globalForOmie.omieClient) return globalForOmie.omieClient;

  const breaker = globalForOmie.omieBreaker ?? new OmieCircuitBreaker();
  globalForOmie.omieBreaker = breaker;

  const client = new OmieClient({
    transport: createTransport(),
    rateLimiter: new OmieRateLimiter(redis),
    circuitBreaker: breaker,
    logger: {
      debug: (obj, msg) => logger.debug(obj, msg),
      warn: (obj, msg) => logger.warn(obj, msg),
      error: (obj, msg) => logger.error(obj, msg),
    },
    newCorrelationId,
  });

  globalForOmie.omieClient = client;
  return client;
}

/**
 * Monta o contexto de chamada de uma organização.
 *
 * `priority` importa: `"interactive"` para ações de vendedor na tela (espera
 * brevemente por uma vaga no limitador), `"background"` para sincronização
 * (desiste na hora e volta para a fila, liberando a janela de 240 req/min para
 * quem está esperando resposta).
 */
export async function createOmieContext(options: {
  readonly organizationId: string;
  readonly priority?: RequestPriority;
  readonly correlationId?: string;
}): Promise<OmieServiceContext> {
  const credentials = await resolveOmieCredentials(options.organizationId);

  return {
    client: getClient(),
    organizationId: options.organizationId,
    credentials,
    ...(options.priority ? { priority: options.priority } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  };
}

export function isMockMode(): boolean {
  return getEnv().OMIE_MOCK_MODE;
}

export {
  saveOmieCredentials,
  recordConnectionTest,
  setIntegrationActive,
  resolveOmieCredentials,
} from "./client/credentials";

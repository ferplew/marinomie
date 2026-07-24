import "server-only";
import Redis from "ioredis";
import { getEnv } from "@/env";
import { logger } from "@/lib/logger";

/**
 * Conexão Redis compartilhada — cache, rate limiting e (na Fase 6) filas BullMQ.
 *
 * Regra de produto: o Redis nunca é fonte única para confirmar uma venda
 * crítica (docs/synchronization-strategy.md §4). Uma falha de cache degrada a
 * experiência, mas nunca deve derrubar a operação — por isso os helpers abaixo
 * engolem erros de leitura/escrita de cache (registrando-os) em vez de propagar.
 */
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

function createRedis(): Redis {
  const env = getEnv();
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    // Conecta no primeiro comando, não no import do módulo: importar este
    // arquivo durante o build não deve abrir socket nem poluir o log.
    lazyConnect: true,
  });

  client.on("error", (error: Error) => {
    logger.error({ err: error.message }, "Erro de conexão com o Redis");
  });

  return client;
}

export const redis: Redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

/** Chave de cache com isolamento obrigatório por organização (briefing §21). */
export function cacheKey(
  organizationId: string,
  ...parts: readonly (string | number)[]
): string {
  return `org:${organizationId}:${parts.join(":")}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    logger.warn({ key, err: String(error) }, "Falha ao ler do cache");
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    logger.warn({ key, err: String(error) }, "Falha ao gravar no cache");
  }
}

/** Invalida todas as chaves de um prefixo usando SCAN (nunca KEYS, que bloqueia). */
export async function cacheInvalidatePrefix(prefix: string): Promise<number> {
  let cursor = "0";
  let removed = 0;
  try {
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) {
        removed += await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    logger.warn({ prefix, err: String(error) }, "Falha ao invalidar cache");
  }
  return removed;
}

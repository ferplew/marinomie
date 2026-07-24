/**
 * Limitador de taxa da API Omie.
 *
 * Limite documentado: **240 requisições por minuto** por `app_key`
 * (ajuda.omie.com.br/pt-BR/articles/8001888). Como o limite é por credencial e a
 * credencial é por organização, a janela é contada por organização.
 *
 * Duas decisões importantes:
 *
 * 1. O limite efetivo padrão é **menor** que 240. A mesma `app_key` pode estar
 *    sendo usada por outras integrações do cliente (Power BI, marketplaces), e
 *    estourar o limite prejudica todas elas. A margem é configurável.
 *
 * 2. Ações do vendedor têm prioridade sobre sincronização em massa. Quando a
 *    janela está cheia, uma chamada interativa espera um pouco; um job de
 *    background desiste imediatamente e volta para a fila, liberando a janela
 *    para quem está esperando na tela.
 */
import type Redis from "ioredis";

export type RequestPriority = "interactive" | "background";

export interface RateLimiterOptions {
  /** Requisições permitidas por janela. Padrão 200, abaixo do limite real de 240. */
  readonly limit?: number;
  readonly windowSeconds?: number;
  /** Espera máxima de uma chamada interativa antes de desistir. */
  readonly maxWaitMs?: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Quanto esperar antes de tentar de novo, quando não permitido. */
  readonly retryAfterMs: number;
  readonly used: number;
  readonly limit: number;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_WAIT_MS = 3_000;

export class OmieRateLimiter {
  private readonly redis: Redis;
  private readonly limit: number;
  private readonly windowSeconds: number;
  private readonly maxWaitMs: number;

  constructor(redis: Redis, options: RateLimiterOptions = {}) {
    this.redis = redis;
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  }

  /**
   * Consome uma vaga na janela atual.
   *
   * Usa um bucket fixo por minuto (INCR + EXPIRE) em vez de janela deslizante:
   * é atômico em uma única operação e não exige script Lua. O custo é permitir
   * uma rajada na virada do bucket — aceitável porque o limite efetivo já é
   * conservador em relação ao real.
   */
  async tryAcquire(organizationId: string): Promise<RateLimitDecision> {
    const bucket = Math.floor(Date.now() / (this.windowSeconds * 1000));
    const key = `omie:rate:${organizationId}:${bucket}`;

    try {
      const used = await this.redis.incr(key);
      if (used === 1) {
        // Expira depois da janela para o bucket não vazar indefinidamente.
        await this.redis.expire(key, this.windowSeconds * 2);
      }

      if (used <= this.limit) {
        return { allowed: true, retryAfterMs: 0, used, limit: this.limit };
      }

      const msIntoWindow = Date.now() % (this.windowSeconds * 1000);
      return {
        allowed: false,
        retryAfterMs: this.windowSeconds * 1000 - msIntoWindow,
        used,
        limit: this.limit,
      };
    } catch {
      // Redis indisponível não pode impedir a operação de negócio. Deixamos
      // passar e confiamos no tratamento de HTTP 429 do client como rede de
      // segurança — perder o limitador é degradação, não falha.
      return { allowed: true, retryAfterMs: 0, used: 0, limit: this.limit };
    }
  }

  /**
   * Espera por uma vaga conforme a prioridade.
   * Devolve `true` se conseguiu; `false` se deve desistir e reenfileirar.
   */
  async acquire(
    organizationId: string,
    priority: RequestPriority,
    sleep: (ms: number) => Promise<void> = defaultSleep,
  ): Promise<RateLimitDecision> {
    const first = await this.tryAcquire(organizationId);
    if (first.allowed) return first;

    // Background nunca espera: devolve a vaga para quem está na tela.
    if (priority === "background") return first;

    const waitMs = Math.min(first.retryAfterMs, this.maxWaitMs);
    if (waitMs <= 0 || first.retryAfterMs > this.maxWaitMs) return first;

    await sleep(waitMs);
    return this.tryAcquire(organizationId);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

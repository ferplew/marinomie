/**
 * Backoff exponencial com jitter (briefing §5 e §20).
 *
 * O jitter é "full jitter": o atraso é sorteado no intervalo `[0, teto]`. Sem
 * ele, várias réplicas que falharam no mesmo instante voltariam a tentar
 * exatamente juntas, recriando o pico que causou a falha — e, com o limite de
 * 240 req/min da Omie, isso é fácil de provocar.
 */
export interface BackoffOptions {
  readonly baseMs?: number;
  readonly maxMs?: number;
  readonly random?: () => number;
}

const DEFAULT_BASE_MS = 250;
const DEFAULT_MAX_MS = 8_000;

export function backoffDelayMs(
  attempt: number,
  options: BackoffOptions = {},
): number {
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const random = options.random ?? Math.random;

  // attempt começa em 1 na primeira repetição.
  const exponent = Math.max(0, attempt - 1);
  const ceiling = Math.min(maxMs, baseMs * 2 ** exponent);

  return Math.round(random() * ceiling);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

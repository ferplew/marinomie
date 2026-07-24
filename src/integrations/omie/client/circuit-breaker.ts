/**
 * Circuit breaker para a integração Omie.
 *
 * Justificativa (o briefing pede "quando justificável"): se a Omie fica
 * indisponível, cada requisição de vendedor esperaria o timeout completo antes
 * de falhar. Com dezenas de vendedores em tela, isso vira uma fila de conexões
 * penduradas por uma falha que já é conhecida. O breaker faz a segunda falha em
 * diante retornar imediatamente.
 *
 * Escopo em memória, por processo — de propósito:
 * - a decisão precisa ser instantânea, sem ida ao Redis no caminho crítico;
 * - cada réplica descobre a indisponibilidade por conta própria em poucas
 *   requisições, o que é rápido o bastante;
 * - um breaker compartilhado no Redis criaria acoplamento em que uma réplica com
 *   problema de rede local abriria o circuito para todas as outras.
 *
 * O estado é por organização: a credencial de uma empresa estar com problema não
 * pode abrir o circuito das demais.
 */
export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Falhas consecutivas para abrir o circuito. */
  readonly failureThreshold?: number;
  /** Quanto tempo o circuito fica aberto antes de permitir uma sondagem. */
  readonly openMs?: number;
  readonly now?: () => number;
}

interface CircuitEntry {
  consecutiveFailures: number;
  openedAt: number | null;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_OPEN_MS = 30_000;

export class OmieCircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.openMs = options.openMs ?? DEFAULT_OPEN_MS;
    this.now = options.now ?? Date.now;
  }

  state(organizationId: string): CircuitState {
    const entry = this.entries.get(organizationId);
    if (!entry || entry.openedAt === null) return "closed";

    if (this.now() - entry.openedAt >= this.openMs) {
      // Passou a janela: permite uma requisição de sondagem.
      return "half-open";
    }
    return "open";
  }

  /** `false` quando a chamada deve ser recusada de imediato. */
  canAttempt(organizationId: string): boolean {
    return this.state(organizationId) !== "open";
  }

  recordSuccess(organizationId: string): void {
    this.entries.delete(organizationId);
  }

  /**
   * Registra uma falha. Apenas falhas de *disponibilidade* devem chegar aqui —
   * um erro de validação da Omie significa que a API está funcionando
   * perfeitamente e não deve contar para abrir o circuito.
   */
  recordFailure(organizationId: string): void {
    const entry = this.entries.get(organizationId) ?? {
      consecutiveFailures: 0,
      openedAt: null,
    };

    entry.consecutiveFailures += 1;

    if (entry.consecutiveFailures >= this.failureThreshold) {
      entry.openedAt = this.now();
      entry.consecutiveFailures = 0;
    }

    this.entries.set(organizationId, entry);
  }

  /** Apenas para testes. */
  reset(): void {
    this.entries.clear();
  }
}

/**
 * Só falhas que indicam indisponibilidade contam para o breaker.
 * Validação, conflito e "não encontrado" provam que a Omie está saudável.
 */
export function countsTowardCircuit(code: string): boolean {
  return (
    code === "TIMEOUT_ERROR" ||
    code === "NETWORK_ERROR" ||
    code === "UNKNOWN_ERROR"
  );
}

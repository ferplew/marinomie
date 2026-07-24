import type { z } from "zod";
import { maskSensitive } from "@/lib/masking";
import { OmieIntegrationError } from "../errors/omie-error";
import {
  classifyOmieError,
  classifyTransportFailure,
  isWriteCall,
} from "../errors/classify";
import { backoffDelayMs, sleep as defaultSleep } from "./backoff";
import { countsTowardCircuit, OmieCircuitBreaker } from "./circuit-breaker";
import type { OmieRateLimiter, RequestPriority } from "./rate-limiter";
import {
  TransportFailure,
  type OmieTransport,
  type TransportResponse,
} from "./transport";

/**
 * Client da Omie — ponto único de contato com a API (docs/architecture.md §2).
 *
 * Concentra: rate limiting, retry com backoff e jitter, timeout, circuit
 * breaker, correlation ID, mascaramento de log, validação da resposta e
 * normalização de erro. Nada fora de `src/integrations/omie` conhece o formato
 * bruto da Omie.
 *
 * Regra que atravessa todo o arquivo: **escrita nunca é reenviada às cegas**.
 * Quando o resultado é incerto, o erro sai com `UNCERTAIN_RESULT` e quem chamou
 * precisa consultar pelo código de integração antes de decidir
 * (docs/synchronization-strategy.md §6).
 */

export interface OmieCredentials {
  readonly appKey: string;
  readonly appSecret: string;
}

export interface OmieClientLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Métricas do briefing §26. Implementação concreta entra na Fase 6. */
export interface OmieMetricsSink {
  requestCompleted(data: {
    endpoint: string;
    call: string;
    durationMs: number;
    outcome: "success" | "error";
    code?: string;
  }): void;
  retryPerformed(data: { endpoint: string; call: string; attempt: number }): void;
}

export interface OmieClientOptions {
  readonly transport: OmieTransport;
  readonly rateLimiter: OmieRateLimiter;
  readonly logger: OmieClientLogger;
  readonly circuitBreaker?: OmieCircuitBreaker;
  readonly metrics?: OmieMetricsSink;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly newCorrelationId?: () => string;
}

export interface OmieCallInput<TOutput> {
  readonly organizationId: string;
  readonly credentials: OmieCredentials;
  readonly endpoint: string;
  readonly call: string;
  readonly param: Record<string, unknown>;
  /** Schema Zod da resposta. Obrigatório: resposta não validada é dado não confiável. */
  readonly schema: z.ZodType<TOutput>;
  readonly priority?: RequestPriority;
  readonly correlationId?: string;
  /**
   * Sobrescreve a detecção automática de escrita. Use apenas quando o nome do
   * método não revelar a natureza da chamada.
   */
  readonly isWrite?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export class OmieClient {
  private readonly transport: OmieTransport;
  private readonly rateLimiter: OmieRateLimiter;
  private readonly logger: OmieClientLogger;
  private readonly circuitBreaker: OmieCircuitBreaker;
  private readonly metrics: OmieMetricsSink | undefined;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly newCorrelationId: () => string;

  constructor(options: OmieClientOptions) {
    this.transport = options.transport;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
    this.circuitBreaker = options.circuitBreaker ?? new OmieCircuitBreaker();
    this.metrics = options.metrics;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.newCorrelationId =
      options.newCorrelationId ?? (() => crypto.randomUUID());
  }

  async call<TOutput>(input: OmieCallInput<TOutput>): Promise<TOutput> {
    const correlationId = input.correlationId ?? this.newCorrelationId();
    const isWrite = input.isWrite ?? isWriteCall(input.call);
    const priority = input.priority ?? "interactive";
    const startedAt = Date.now();

    // Escrita nunca é repetida automaticamente: uma única tentativa, e o
    // chamador decide o que fazer com um resultado incerto.
    const attemptLimit = isWrite ? 1 : this.maxAttempts;

    let lastError: OmieIntegrationError | null = null;

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      if (!this.circuitBreaker.canAttempt(input.organizationId)) {
        throw this.buildError(
          {
            code: "CIRCUIT_OPEN",
            disposition: "RETRYABLE",
            matchedBy: "circuito aberto",
          },
          { input, correlationId, attempt, message: "Circuito aberto para a organização" },
        );
      }

      const rate = await this.rateLimiter.acquire(
        input.organizationId,
        priority,
        this.sleep,
      );
      if (!rate.allowed) {
        throw this.buildError(
          {
            code: "RATE_LIMIT_ERROR",
            disposition: "RETRYABLE",
            matchedBy: "limitador local",
          },
          {
            input,
            correlationId,
            attempt,
            message: `Limite local de ${rate.limit} req/min atingido (${rate.used} usadas)`,
          },
        );
      }

      try {
        const response = await this.transport.send({
          endpoint: input.endpoint,
          call: input.call,
          param: input.param,
          appKey: input.credentials.appKey,
          appSecret: input.credentials.appSecret,
          timeoutMs: this.timeoutMs,
          correlationId,
        });

        const result = this.handleResponse(response, {
          input,
          correlationId,
          attempt,
          isWrite,
        });

        this.circuitBreaker.recordSuccess(input.organizationId);
        this.metrics?.requestCompleted({
          endpoint: input.endpoint,
          call: input.call,
          durationMs: Date.now() - startedAt,
          outcome: "success",
        });

        this.logger.debug(
          {
            correlationId,
            endpoint: input.endpoint,
            call: input.call,
            attempt,
            durationMs: Date.now() - startedAt,
            transport: this.transport.mode,
          },
          "Chamada Omie concluída",
        );

        return result;
      } catch (error) {
        const normalized = this.normalize(error, {
          input,
          correlationId,
          attempt,
          isWrite,
        });

        if (countsTowardCircuit(normalized.code)) {
          this.circuitBreaker.recordFailure(input.organizationId);
        }

        lastError = normalized;

        const canRetry = normalized.retryable && attempt < attemptLimit;
        if (!canRetry) break;

        this.metrics?.retryPerformed({
          endpoint: input.endpoint,
          call: input.call,
          attempt,
        });
        this.logger.warn(
          { ...normalized.toLogObject(), willRetry: true },
          "Chamada Omie falhou, repetindo",
        );

        await this.sleep(backoffDelayMs(attempt, { random: this.random }));
      }
    }

    const finalError =
      lastError ??
      this.buildError(
        { code: "UNKNOWN_ERROR", disposition: "RETRYABLE", matchedBy: "sem erro capturado" },
        { input, correlationId, attempt: attemptLimit, message: "Falha sem erro capturado" },
      );

    this.metrics?.requestCompleted({
      endpoint: input.endpoint,
      call: input.call,
      durationMs: Date.now() - startedAt,
      outcome: "error",
      code: finalError.code,
    });
    this.logger.error(finalError.toLogObject(), "Chamada Omie falhou");

    throw finalError;
  }

  /**
   * Interpreta a resposta.
   *
   * A Omie não tem envelope de erro uniforme (docs/omie-api-mapping.md §1): há
   * casos de HTTP 500 com texto, e casos de HTTP 200 com `faultstring` ou
   * `cCodStatus` diferente de sucesso. Por isso o sucesso é reconhecido pela
   * ausência de sinal de erro **e** pela validação do schema, não pelo status.
   */
  private handleResponse<TOutput>(
    response: TransportResponse,
    context: ErrorContext<TOutput> & { isWrite: boolean },
  ): TOutput {
    const errorSignal = extractErrorSignal(response);

    if (errorSignal || response.httpStatus >= 400) {
      throw this.buildError(
        classifyOmieError({
          httpStatus: response.httpStatus,
          message: errorSignal?.message ?? response.rawText,
          omieCode: errorSignal?.code,
          isWrite: context.isWrite,
        }),
        {
          ...context,
          message:
            errorSignal?.message ??
            response.rawText ??
            `HTTP ${response.httpStatus} sem corpo interpretável`,
          omieCode: errorSignal?.code,
          omieDescription: errorSignal?.message,
          httpStatus: response.httpStatus,
        },
      );
    }

    const parsed = context.input.schema.safeParse(response.body);
    if (!parsed.success) {
      // Schema divergente é problema nosso, não da Omie: exige revisão humana
      // em vez de retry, que só repetiria a mesma incompatibilidade.
      throw this.buildError(
        {
          code: "SCHEMA_ERROR",
          disposition: "MANUAL_REVIEW_REQUIRED",
          matchedBy: "validação de schema",
        },
        {
          ...context,
          message: `Resposta da Omie não corresponde ao schema esperado: ${parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
          httpStatus: response.httpStatus,
        },
      );
    }

    return parsed.data;
  }

  private normalize<TOutput>(
    error: unknown,
    context: ErrorContext<TOutput> & { isWrite: boolean },
  ): OmieIntegrationError {
    if (error instanceof OmieIntegrationError) return error;

    if (error instanceof TransportFailure) {
      return this.buildError(
        classifyTransportFailure(error.kind, context.isWrite),
        { ...context, message: error.message },
        error,
      );
    }

    return this.buildError(
      {
        code: "UNKNOWN_ERROR",
        disposition: context.isWrite ? "UNCERTAIN_RESULT" : "RETRYABLE",
        matchedBy: "exceção inesperada",
      },
      { ...context, message: "Exceção inesperada na chamada à Omie" },
      error,
    );
  }

  private buildError<TOutput>(
    classification: {
      code: OmieIntegrationError["code"];
      disposition: OmieIntegrationError["disposition"];
      matchedBy: string;
    },
    context: ErrorContext<TOutput> & {
      message: string;
      omieCode?: string | number | undefined;
      omieDescription?: string | undefined;
      httpStatus?: number | undefined;
    },
    cause?: unknown,
  ): OmieIntegrationError {
    // O `param` pode conter documento, e-mail e endereço de cliente: só entra no
    // log depois de mascarado.
    this.logger.debug(
      {
        correlationId: context.correlationId,
        endpoint: context.input.endpoint,
        call: context.input.call,
        matchedBy: classification.matchedBy,
        param: maskSensitive(context.input.param),
      },
      "Erro classificado na chamada Omie",
    );

    return new OmieIntegrationError(
      {
        code: classification.code,
        disposition: classification.disposition,
        message: context.message,
        correlationId: context.correlationId,
        endpoint: context.input.endpoint,
        call: context.input.call,
        attempt: context.attempt,
        ...(context.omieCode !== undefined ? { omieCode: context.omieCode } : {}),
        ...(context.omieDescription !== undefined
          ? { omieDescription: context.omieDescription }
          : {}),
        ...(context.httpStatus !== undefined ? { httpStatus: context.httpStatus } : {}),
      },
      cause !== undefined ? { cause } : undefined,
    );
  }
}

interface ErrorContext<TOutput> {
  readonly input: OmieCallInput<TOutput>;
  readonly correlationId: string;
  readonly attempt: number;
}

export interface OmieErrorSignal {
  readonly code: string | number | undefined;
  readonly message: string;
}

/**
 * Procura sinal de erro no corpo da resposta.
 *
 * Cobre as três formas observadas na documentação da Omie:
 * - `faultstring` / `faultcode` (herança do envelope SOAP);
 * - `cCodStatus` / `cDesStatus` em serviços de escrita;
 * - `codigo_status` / `descricao_status` em cadastros (ex.: `clientes_status`).
 *
 * Em todas, o status de sucesso é `"0"`. Qualquer outro valor é erro.
 */
export function extractErrorSignal(
  response: TransportResponse,
): OmieErrorSignal | null {
  const body = response.body;
  if (body === null || typeof body !== "object") return null;

  const record = body as Record<string, unknown>;

  const faultString = record["faultstring"];
  if (typeof faultString === "string" && faultString.length > 0) {
    const faultCode = record["faultcode"];
    return {
      code: typeof faultCode === "string" || typeof faultCode === "number" ? faultCode : undefined,
      message: faultString,
    };
  }

  for (const [codeKey, descriptionKey] of [
    ["cCodStatus", "cDesStatus"],
    ["codigo_status", "descricao_status"],
  ] as const) {
    const rawCode = record[codeKey];
    if (rawCode === undefined || rawCode === null) continue;

    const normalizedCode = String(rawCode).trim();
    // "0" e "0000" são sucesso; o resto é erro.
    if (normalizedCode === "" || Number(normalizedCode) === 0) continue;

    const description = record[descriptionKey];
    return {
      code: normalizedCode,
      message:
        typeof description === "string" && description.length > 0
          ? description
          : `Status ${normalizedCode} retornado pela Omie`,
    };
  }

  return null;
}

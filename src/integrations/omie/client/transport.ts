/**
 * Transporte HTTP da Omie.
 *
 * Existe como interface para que o **modo mock seja uma implementação separada**
 * em vez de um `if` espalhado pelo client (briefing §38: "mantenha o mock
 * separado da integração real"). O client de cima — com retry, rate limit,
 * breaker, validação — é exatamente o mesmo nos dois modos, o que significa que
 * desenvolver contra o mock exercita o código real.
 */

/** Formato de requisição confirmado em developer.omie.com.br/quick-start. */
export interface OmieRequestBody<TParam> {
  readonly call: string;
  readonly app_key: string;
  readonly app_secret: string;
  /** `param` é sempre um array com um único objeto. */
  readonly param: readonly [TParam];
}

export interface TransportRequest {
  /** Caminho relativo do serviço, ex.: "geral/produtos". */
  readonly endpoint: string;
  readonly call: string;
  readonly param: Record<string, unknown>;
  readonly appKey: string;
  readonly appSecret: string;
  readonly timeoutMs: number;
  readonly correlationId: string;
}

export interface TransportResponse {
  readonly httpStatus: number;
  /** Corpo já parseado. `null` quando não era JSON válido. */
  readonly body: unknown;
  /** Corpo bruto, usado só para diagnóstico quando o parse falha. */
  readonly rawText: string | undefined;
}

export type TransportFailureKind = "timeout" | "network";

export class TransportFailure extends Error {
  readonly kind: TransportFailureKind;

  constructor(kind: TransportFailureKind, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "TransportFailure";
    this.kind = kind;
  }
}

export interface OmieTransport {
  readonly mode: "http" | "mock";
  send(request: TransportRequest): Promise<TransportResponse>;
}

const BASE_URL = "https://app.omie.com.br/api/v1";

/**
 * Transporte real. Faz uma única tentativa — retry, backoff e classificação são
 * responsabilidade do client, para que o mock não precise reimplementá-los.
 */
export class HttpOmieTransport implements OmieTransport {
  readonly mode = "http" as const;
  private readonly baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    const body: OmieRequestBody<Record<string, unknown>> = {
      call: request.call,
      app_key: request.appKey,
      app_secret: request.appSecret,
      param: [request.param],
    };

    const url = `${this.baseUrl}/${request.endpoint}/`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // Ajuda a rastrear a requisição do nosso lado e no suporte da Omie.
          "X-Correlation-Id": request.correlationId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(request.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "TimeoutError";
      throw new TransportFailure(
        isTimeout ? "timeout" : "network",
        isTimeout
          ? `Timeout de ${request.timeoutMs}ms ao chamar ${request.call}`
          : `Falha de rede ao chamar ${request.call}`,
        error,
      );
    }

    const rawText = await response.text();

    let parsed: unknown = null;
    if (rawText.length > 0) {
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        // A Omie devolve HTML/texto em algumas falhas de infraestrutura.
        parsed = null;
      }
    }

    return {
      httpStatus: response.status,
      body: parsed,
      // Truncado: o corpo bruto vai para log de diagnóstico e não deve virar
      // um despejo gigante.
      rawText: parsed === null ? rawText.slice(0, 500) : undefined,
    };
  }
}

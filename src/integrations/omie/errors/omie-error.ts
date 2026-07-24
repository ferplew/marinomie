/**
 * Erro normalizado da integração Omie.
 *
 * O resto da aplicação nunca vê o formato de erro bruto da Omie — só este tipo.
 * Isso é o que permite trocar detalhes da API sem propagar mudança para o
 * domínio, e garante que nenhuma mensagem interna vaze para o usuário.
 */
export type OmieIntegrationErrorCode =
  | "AUTHENTICATION_ERROR"
  | "VALIDATION_ERROR"
  | "RATE_LIMIT_ERROR"
  | "TIMEOUT_ERROR"
  | "NETWORK_ERROR"
  | "RESOURCE_NOT_FOUND"
  | "CONFLICT_ERROR"
  | "CIRCUIT_OPEN"
  | "SCHEMA_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Como a fila deve tratar o erro (briefing §20).
 *
 * `UNCERTAIN_RESULT` é o caso mais delicado: a escrita pode ter sido aplicada no
 * Omie mesmo sem resposta. Nunca deve ser reenviada às cegas — exige consulta
 * pelo código de integração antes (docs/synchronization-strategy.md §6).
 */
export type OmieErrorDisposition =
  | "RETRYABLE"
  | "NON_RETRYABLE"
  | "UNCERTAIN_RESULT"
  | "AUTHENTICATION_REQUIRED"
  | "MANUAL_REVIEW_REQUIRED";

export interface OmieErrorDetails {
  readonly code: OmieIntegrationErrorCode;
  readonly disposition: OmieErrorDisposition;
  /** Mensagem interna, para log e auditoria. Nunca exibida ao usuário final. */
  readonly message: string;
  readonly omieCode?: string | number;
  readonly omieDescription?: string;
  readonly httpStatus?: number;
  readonly correlationId: string;
  /** Serviço e método chamados, úteis para agrupar falhas por origem. */
  readonly endpoint?: string;
  readonly call?: string;
  readonly attempt?: number;
}

export class OmieIntegrationError extends Error {
  readonly code: OmieIntegrationErrorCode;
  readonly disposition: OmieErrorDisposition;
  readonly omieCode: string | number | undefined;
  readonly omieDescription: string | undefined;
  readonly httpStatus: number | undefined;
  readonly correlationId: string;
  readonly endpoint: string | undefined;
  readonly call: string | undefined;
  readonly attempt: number | undefined;

  constructor(details: OmieErrorDetails, options?: { cause?: unknown }) {
    super(details.message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OmieIntegrationError";
    this.code = details.code;
    this.disposition = details.disposition;
    this.omieCode = details.omieCode;
    this.omieDescription = details.omieDescription;
    this.httpStatus = details.httpStatus;
    this.correlationId = details.correlationId;
    this.endpoint = details.endpoint;
    this.call = details.call;
    this.attempt = details.attempt;
  }

  /** Só erros com esta disposição podem ser reenviados automaticamente. */
  get retryable(): boolean {
    return this.disposition === "RETRYABLE";
  }

  /**
   * Forma segura para log estruturado: sem payload, sem credencial, sem stack.
   * A descrição vinda da Omie é preservada porque é diagnóstico útil e não
   * contém segredo nosso — mas nunca é exibida ao vendedor.
   */
  toLogObject(): Record<string, unknown> {
    return {
      code: this.code,
      disposition: this.disposition,
      omieCode: this.omieCode,
      omieDescription: this.omieDescription,
      httpStatus: this.httpStatus,
      correlationId: this.correlationId,
      endpoint: this.endpoint,
      call: this.call,
      attempt: this.attempt,
    };
  }
}

export function isOmieIntegrationError(
  error: unknown,
): error is OmieIntegrationError {
  return error instanceof OmieIntegrationError;
}

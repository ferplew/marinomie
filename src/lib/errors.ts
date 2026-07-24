/**
 * Erros de domínio da aplicação (docs/api-contracts.md §1).
 *
 * Regra inegociável: o usuário final nunca vê stack trace, mensagem interna ou
 * detalhe de credencial. `AppError.userMessage` é o único texto que pode ser
 * exibido; `cause`/`details` existem só para log e auditoria.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTEGRATION_ERROR"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTEGRATION_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/** Mensagens seguras por padrão — genéricas o bastante para não vazar contexto. */
const DEFAULT_USER_MESSAGE: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: "Sua sessão expirou. Entre novamente.",
  FORBIDDEN: "Você não tem permissão para executar esta ação.",
  NOT_FOUND: "Registro não encontrado.",
  VALIDATION_ERROR: "Verifique os dados informados.",
  CONFLICT: "Este registro foi alterado por outra operação. Recarregue e tente novamente.",
  RATE_LIMITED: "Muitas tentativas. Aguarde alguns instantes.",
  INTEGRATION_ERROR: "Não foi possível comunicar com o Omie no momento. Tente novamente.",
  INTERNAL_ERROR: "Ocorreu um erro inesperado. Nossa equipe foi notificada.",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly details: Record<string, unknown> | undefined;
  readonly correlationId: string | undefined;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: {
      userMessage?: string;
      details?: Record<string, unknown>;
      correlationId?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.userMessage = options?.userMessage ?? DEFAULT_USER_MESSAGE[code];
    this.details = options?.details;
    this.correlationId = options?.correlationId;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  /** Forma segura para enviar ao cliente — sem `message` interna nem stack. */
  toClientJSON(): { code: AppErrorCode; message: string; correlationId?: string } {
    return {
      code: this.code,
      message: this.userMessage,
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Converte qualquer erro desconhecido em AppError, preservando a causa para log.
 * Nunca propaga a mensagem original para o usuário.
 */
export function toAppError(error: unknown, correlationId?: string): AppError {
  if (isAppError(error)) return error;
  return new AppError("INTERNAL_ERROR", "Erro não tratado", {
    ...(correlationId ? { correlationId } : {}),
    cause: error,
  });
}

/** Resultado padrão de Server Actions (docs/api-contracts.md §1). */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: AppErrorCode; message: string; fieldErrors?: Record<string, string[]> };
    };

import pino from "pino";
import { maskSensitive } from "./masking";

/**
 * Logs estruturados com correlation ID (docs/architecture.md, briefing §26).
 * Todo objeto logado passa por `maskSensitive` — não existe caminho de log que
 * escape do mascaramento.
 */
const level = process.env["LOG_LEVEL"] ?? "info";
const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level,
  base: { service: "marinomie" },
  formatters: {
    level: (label) => ({ level: label }),
    // Ponto único por onde todo objeto logado passa.
    log: (object) => maskSensitive(object) as Record<string, unknown>,
  },
  redact: {
    paths: [
      "app_key",
      "app_secret",
      "password",
      "*.app_key",
      "*.app_secret",
      "*.password",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});

/** Logger filho carregando o correlation ID de uma requisição/job. */
export function withCorrelation(correlationId: string): pino.Logger {
  return logger.child({ correlationId });
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Mascaramento de dados sensíveis para logs (docs/security.md §4 e §7).
 *
 * Módulo puro e sem dependências para ser testável isoladamente e reutilizável
 * tanto pelo logger quanto pelo `beforeSend` do Sentry e pelo client da Omie.
 *
 * Princípio: é preferível mascarar demais a vazar de menos. Qualquer chave cujo
 * nome sugira segredo é redigida por completo, independentemente do valor.
 */

/** Chaves cujo valor NUNCA pode aparecer em log, nem parcialmente. */
const FULLY_REDACTED_KEYS = new Set([
  "app_key",
  "app_secret",
  "appkey",
  "appsecret",
  "appkeyencrypted",
  "appsecretencrypted",
  "password",
  "passwordhash",
  "senha",
  "authorization",
  "cookie",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "auth_secret",
  "encryption_key",
  "webhooksecrettoken",
  "sessiontoken",
  "apikey",
]);

/** Chaves de dado pessoal que são mascaradas parcialmente (LGPD). */
const PARTIALLY_MASKED_KEYS = new Set([
  "cnpj_cpf",
  "cpf",
  "cnpj",
  "document",
  "documento",
  "email",
  "telefone",
  "phone",
]);

export const REDACTED = "[REDACTED]";

/** Mantém apenas os 4 últimos caracteres: "12345678901" -> "***8901". */
export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return "*".repeat(value.length);
  return `***${value.slice(-visible)}`;
}

/** "fulano@empresa.com.br" -> "f***@empresa.com.br" */
export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return maskTail(value);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const first = local[0] ?? "";
  return `${first}***${domain}`;
}

function maskValue(key: string, value: string): string {
  if (key === "email" && value.includes("@")) return maskEmail(value);
  return maskTail(value);
}

/**
 * Percorre uma estrutura arbitrária e devolve uma cópia com os campos
 * sensíveis mascarados. Não muta a entrada. Protege contra ciclos.
 */
export function maskSensitive(input: unknown, seen = new WeakSet<object>()): unknown {
  if (input === null || input === undefined) return input;

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  if (input instanceof Date) return input;

  if (Array.isArray(input)) {
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    return input.map((item) => maskSensitive(item, seen));
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const normalized = key.toLowerCase().replace(/[-\s]/g, "_");
      const compact = normalized.replace(/_/g, "");

      if (FULLY_REDACTED_KEYS.has(normalized) || FULLY_REDACTED_KEYS.has(compact)) {
        out[key] = REDACTED;
        continue;
      }

      if (
        (PARTIALLY_MASKED_KEYS.has(normalized) || PARTIALLY_MASKED_KEYS.has(compact)) &&
        typeof value === "string"
      ) {
        out[key] = maskValue(normalized, value);
        continue;
      }

      out[key] = maskSensitive(value, seen);
    }
    return out;
  }

  return input;
}

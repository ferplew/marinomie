import "server-only";
import { z } from "zod";

/**
 * Validação de variáveis de ambiente (docs/security.md §4).
 *
 * Regras:
 * - Nenhum segredo é prefixado com NEXT_PUBLIC_ — nada aqui chega ao navegador.
 * - OMIE_APP_KEY / OMIE_APP_SECRET são OPCIONAIS e existem apenas como
 *   conveniência de desenvolvimento local. Em produção, as credenciais da Omie
 *   vivem criptografadas no banco (`OmieCredential`), por organização.
 * - A validação é preguiçosa (lazy) para não quebrar `next build`, que executa
 *   sem o ambiente de runtime completo.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // Em produção na Vercel, cai para o domínio estável do projeto em vez de
  // localhost — sem isso o Better Auth usa localhost como baseURL e rejeita
  // toda requisição de login vinda do domínio real ("Invalid origin").
  APP_URL: z
    .url()
    .default(
      process.env["VERCEL_PROJECT_PRODUCTION_URL"]
        ? `https://${process.env["VERCEL_PROJECT_PRODUCTION_URL"]}`
        : "http://localhost:3000",
    ),

  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  REDIS_URL: z.string().min(1, "REDIS_URL é obrigatória"),

  /** Segredo de sessão do Better Auth. Mínimo de 32 caracteres. */
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET deve ter ao menos 32 caracteres"),

  /**
   * Chave de criptografia em repouso das credenciais Omie (AES-256-GCM).
   * 32 bytes em hexadecimal = 64 caracteres.
   */
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "ENCRYPTION_KEY deve ser 32 bytes em hexadecimal (64 caracteres)",
    ),

  /** Modo mock: permite desenvolver e demonstrar sem chamar a API real. */
  OMIE_MOCK_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  OMIE_APP_KEY: z.string().optional(),
  OMIE_APP_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Nunca imprimimos os valores recebidos — apenas quais chaves falharam.
    throw new Error(
      `Variáveis de ambiente inválidas:\n${issues}\n\nVeja .env.example.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Apenas para testes: descarta o cache entre casos. */
export function resetEnvCache(): void {
  cached = null;
}

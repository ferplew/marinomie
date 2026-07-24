import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { getEnv } from "@/env";

/**
 * Autenticação (docs/security.md §1).
 *
 * Decisões relevantes:
 * - Cadastro público desabilitado: usuários são criados por um administrador da
 *   organização, nunca por auto-registro. Não existe fluxo em que alguém entra
 *   sozinho numa organização.
 * - Sessão em banco (tabela `sessions`), o que torna a revogação imediata e real
 *   — um token antigo não continua válido depois que o admin encerra a sessão.
 * - Hash de senha: scrypt (padrão do Better Auth). É um KDF com custo de memória
 *   adequado; se migrarmos para Argon2id no futuro, o Better Auth suporta hash
 *   customizado e a migração pode ser feita de forma transparente na validação.
 */
/**
 * Instância memoizada, construída no primeiro uso.
 *
 * Antes ela era criada no import, o que fazia `next build` exigir `AUTH_SECRET`
 * e `APP_URL` — variáveis que só existem em runtime. O build importa a rota
 * `/api/auth/[...all]` para coletar metadados, e isso bastava para quebrar o
 * deploy. Ver o mesmo padrão em `src/server/db.ts`.
 */
let instance: ReturnType<typeof buildAuth> | null = null;

export function getAuth(): ReturnType<typeof buildAuth> {
  instance ??= buildAuth();
  return instance;
}

function buildAuth() {
  return betterAuth({
    appName: "marinomie",
    secret: getEnv().AUTH_SECRET,
    baseURL: getEnv().APP_URL,
    // A Vercel muda a URL de deployment a cada build (produção e preview).
    // `APP_URL` cobre só uma delas; sem as demais aqui, login a partir de
    // qualquer outra URL do mesmo projeto cai em "Invalid origin" (403).
    trustedOrigins: [
      getEnv().APP_URL,
      process.env["VERCEL_URL"] && `https://${process.env["VERCEL_URL"]}`,
      process.env["VERCEL_BRANCH_URL"] &&
        `https://${process.env["VERCEL_BRANCH_URL"]}`,
      process.env["VERCEL_PROJECT_PRODUCTION_URL"] &&
        `https://${process.env["VERCEL_PROJECT_PRODUCTION_URL"]}`,
    ].filter((origin): origin is string => Boolean(origin)),

    database: prismaAdapter(prisma, {
      provider: "postgresql",
      transaction: true,
    }),

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },

    session: {
      expiresIn: 60 * 60 * 8, // 8 horas
      updateAge: 60 * 60, // renova a cada hora de uso
      cookieCache: {
        enabled: false, // sessão sempre conferida no banco (revogação imediata)
      },
    },

    advanced: {
      cookiePrefix: "marinomie",
      useSecureCookies: getEnv().NODE_ENV === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
      database: {
        // Sem isto o Better Auth gera IDs alfanuméricos próprios, que as colunas
        // `@db.Uuid` do schema rejeitam. UUID em toda a base é a decisão
        // registrada em docs/database-model.md.
        generateId: "uuid",
      },
    },

    user: {
      modelName: "user",
      additionalFields: {
        organizationId: {
          type: "string",
          required: true,
          // Nunca editável pelo próprio usuário: trocar de organização por
          // atualização de perfil seria escalada de privilégio.
          input: false,
        },
        active: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        failedLoginCount: {
          type: "number",
          required: false,
          defaultValue: 0,
          input: false,
        },
        lockedUntil: { type: "date", required: false, input: false },
        mfaEnabled: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
        lastLoginAt: { type: "date", required: false, input: false },
      },
    },

    /**
     * Auditoria de login e logout (docs/security.md §8, briefing §25).
     *
     * Feita via hooks de banco em vez de no formulário de login: uma sessão só é
     * criada quando a autenticação realmente teve sucesso, então este é o único
     * ponto em que "login" é um fato — e ele cobre qualquer caminho de entrada,
     * não só a nossa tela.
     */
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { organizationId: true },
            });
            if (!user) return;

            await Promise.all([
              recordAudit({
                organizationId: user.organizationId,
                actorUserId: session.userId,
                action: "auth.login",
                entityType: "session",
                entityId: session.id,
              }),
              // Login bem-sucedido zera o contador de tentativas falhas.
              prisma.user.update({
                where: { id: session.userId },
                data: { lastLoginAt: new Date(), failedLoginCount: 0 },
              }),
            ]);
          },
        },
        delete: {
          after: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { organizationId: true },
            });
            if (!user) return;

            await recordAudit({
              organizationId: user.organizationId,
              actorUserId: session.userId,
              action: "auth.logout",
              entityType: "session",
              entityId: session.id,
            });
          },
        },
      },
    },

    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

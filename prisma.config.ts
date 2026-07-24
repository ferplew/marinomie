import { defineConfig } from "prisma/config";

/**
 * Configuração do Prisma 7. A URL do banco vive aqui (e não mais no
 * schema.prisma) e é usada apenas pelas ferramentas de migration/introspection.
 * Em runtime, o PrismaClient recebe a conexão via driver adapter
 * (src/server/db.ts) — este arquivo nunca é importado por código de aplicação.
 *
 * `process.env.DATABASE_URL` direto, em vez do helper `env()` do próprio
 * pacote: `env()` resolve a variável de forma EAGER, no carregamento do
 * módulo, e lança se ela não existir — mesmo para `prisma generate`, que não
 * precisa de conexão real, só do schema. Isso quebrava `postinstall` em
 * qualquer build (Vercel, CI) que ainda não tem `DATABASE_URL` no estágio de
 * instalação de dependências. O fallback vazio é inofensivo: só importa para
 * comandos de migration, que sempre rodam com a variável real definida.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});

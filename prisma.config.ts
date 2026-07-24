import { defineConfig, env } from "prisma/config";

/**
 * Configuração do Prisma 7. A URL do banco vive aqui (e não mais no
 * schema.prisma) e é usada apenas pelas ferramentas de migration/introspection.
 * Em runtime, o PrismaClient recebe a conexão via driver adapter
 * (src/server/db.ts).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});

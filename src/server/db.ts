import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getEnv } from "@/env";

/**
 * Prisma Client com inicialização preguiçosa.
 *
 * O client é construído no **primeiro uso**, não no import do módulo. Isso
 * importa por dois motivos:
 *
 * 1. `next build` importa cada rota para coletar metadados, mas não executa
 *    query nenhuma. Construir no import fazia o build exigir `DATABASE_URL` e
 *    falhar em qualquer ambiente que só tem as variáveis em runtime — foi
 *    exatamente o que quebrou o primeiro deploy.
 * 2. Um módulo importado por engano num contexto sem banco não deve derrubar o
 *    processo antes de alguém tentar consultar algo.
 *
 * O cache global evita que o hot reload do Next abra um pool novo a cada
 * alteração de arquivo até esgotar as conexões do Postgres.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const env = getEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function resolveClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const client = createPrismaClient();
  // Em produção também cacheamos: o proxy precisa devolver sempre a mesma
  // instância, senão cada acesso abriria um pool.
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Proxy que resolve o client de verdade no primeiro acesso a qualquer
 * propriedade. Métodos são ligados à instância para que `this` continue correto
 * em chamadas como `prisma.$transaction([...])`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, _receiver) {
    const client = resolveClient();
    const value = Reflect.get(client as object, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(resolveClient() as object, property);
  },
});

import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { redis } from "@/server/redis";
import { logger } from "@/lib/logger";

/**
 * Readiness probe (docs/api-contracts.md §8).
 *
 * Verifica apenas as dependências que o app precisa para servir tráfego:
 * Postgres e Redis. NÃO chama a Omie de propósito — acoplar a disponibilidade
 * do nosso app à disponibilidade momentânea de um ERP externo faria o
 * orquestrador reciclar pods por um problema que não é nosso.
 *
 * A resposta é deliberadamente pobre em detalhes: "up" ou "down" por
 * subsistema, sem mensagem de erro, versão ou host.
 */
export const dynamic = "force-dynamic";

type SubsystemStatus = "up" | "down";

async function checkDatabase(): Promise<SubsystemStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch (error) {
    logger.error({ err: String(error) }, "Readiness: Postgres indisponível");
    return "down";
  }
}

async function checkRedis(): Promise<SubsystemStatus> {
  try {
    const pong = await redis.ping();
    return pong === "PONG" ? "up" : "down";
  } catch (error) {
    logger.error({ err: String(error) }, "Readiness: Redis indisponível");
    return "down";
  }
}

export async function GET(): Promise<NextResponse> {
  const [database, cache] = await Promise.all([checkDatabase(), checkRedis()]);
  const ready = database === "up" && cache === "up";

  return NextResponse.json(
    { status: ready ? "ok" : "down", checks: { database, cache } },
    { status: ready ? 200 : 503 },
  );
}

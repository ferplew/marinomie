import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import { maskSensitive } from "@/lib/masking";
import type { Prisma } from "@prisma/client";

/**
 * Trilha de auditoria (docs/security.md §8, briefing §25).
 *
 * `beforeData`/`afterData` passam por `maskSensitive` antes de serem gravados —
 * a auditoria registra o que mudou sem virar um repositório de segredos.
 */
export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "user.created"
  | "user.updated"
  | "user.disabled"
  | "role.permissions_changed"
  | "seller_link.created"
  | "seller_link.updated"
  | "customer.created"
  | "customer.updated"
  | "customer.viewed_sensitive"
  | "quote.created"
  | "quote.updated"
  | "quote.approved"
  | "quote.converted"
  | "order.created"
  | "order.cancelled"
  | "integration.configured"
  | "integration.sync_requested"
  | "integration.retry_requested"
  | "product.cost_viewed"
  | "report.exported";

export interface AuditInput {
  organizationId: string;
  actorUserId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  correlationId?: string;
}

/**
 * Registra um evento de auditoria.
 *
 * Falha de auditoria nunca derruba a operação de negócio que a originou — mas
 * também nunca é silenciosa: é logada em nível `error` para investigação.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  // IP e user-agent só existem quando há requisição. Um job de worker ou uma
  // rotina de reconciliação não tem cliente — e a ausência desses campos não
  // pode impedir a gravação, senão nada originado no worker seria auditado.
  const { ipAddress, userAgent } = await tryReadRequestContext();

  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeData:
          input.beforeData === undefined
            ? undefined
            : (maskSensitive(input.beforeData) as Prisma.InputJsonValue),
        afterData:
          input.afterData === undefined
            ? undefined
            : (maskSensitive(input.afterData) as Prisma.InputJsonValue),
        ipAddress,
        userAgent,
        correlationId: input.correlationId ?? null,
      },
    });
  } catch (error) {
    logger.error(
      { action: input.action, entityType: input.entityType, err: String(error) },
      "Falha ao gravar auditoria",
    );
  }
}

/**
 * Lê IP e user-agent quando existe uma requisição.
 *
 * `headers()` lança fora de um escopo de requisição — que é o caso normal num
 * worker. Isolar a chamada aqui é o que garante que uma ação automática ainda
 * seja auditada, apenas sem os campos de origem do cliente.
 */
async function tryReadRequestContext(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  try {
    const requestHeaders = await headers();
    return {
      ipAddress:
        requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        requestHeaders.get("x-real-ip") ??
        null,
      userAgent: requestHeaders.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

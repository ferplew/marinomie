"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/actor";
import { assertPermission } from "@/domain/permissions/authorize";
import { recordAudit } from "@/server/audit";
import {
  enqueueInventorySync,
  enqueueProductsSync,
  enqueueReconciliation,
} from "@/server/queue/enqueue";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { toAppError, type ActionResult } from "@/lib/errors";
import { logger, newCorrelationId } from "@/lib/logger";

/**
 * Disparos manuais de sincronização.
 *
 * Diferente da Fase 5: agora só **enfileira** e devolve na hora. O trabalho
 * acontece no worker, então uma varredura completa do catálogo não segura a
 * requisição nem tem limite artificial de 5 páginas.
 */
export async function triggerProductsSyncAction(): Promise<
  ActionResult<{ syncJobId: string }>
> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    assertPermission(actor, "integrations.sync");

    const { syncJobId } = await enqueueProductsSync({
      organizationId: actor.organizationId,
      page: 1,
      pageSize: 50,
      source: "manual",
      correlationId,
    });

    await recordAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "integration.sync_requested",
      entityType: "product",
      entityId: syncJobId,
      correlationId,
    });

    revalidatePath("/admin/sincronizacoes");
    return { ok: true, data: { syncJobId } };
  } catch (error) {
    return fail(error, correlationId);
  }
}

export async function triggerInventorySyncAction(): Promise<
  ActionResult<{ products: number }>
> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    assertPermission(actor, "integrations.sync");

    // Sincroniza os produtos ativos mais desatualizados primeiro — são os que
    // têm maior chance de estar errados na tela do vendedor.
    const products = await prisma.product.findMany({
      where: orgScope(actor, { active: true, deletedAt: null }),
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: { omieId: true },
    });

    if (products.length === 0) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Sincronize o catálogo antes de atualizar o estoque.",
        },
      };
    }

    await enqueueInventorySync({
      organizationId: actor.organizationId,
      productOmieIds: products.map((p) => p.omieId),
      source: "manual",
      correlationId,
    });

    revalidatePath("/admin/sincronizacoes");
    return { ok: true, data: { products: products.length } };
  } catch (error) {
    return fail(error, correlationId);
  }
}

export async function triggerReconciliationAction(
  domain: "products" | "inventory" | "sales",
): Promise<ActionResult<{ syncJobId: string }>> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    assertPermission(actor, "integrations.sync");

    const { syncJobId } = await enqueueReconciliation({
      organizationId: actor.organizationId,
      domain,
      source: "manual",
      correlationId,
    });

    revalidatePath("/admin/sincronizacoes");
    return { ok: true, data: { syncJobId } };
  } catch (error) {
    return fail(error, correlationId);
  }
}

function fail<T>(error: unknown, correlationId: string): ActionResult<T> {
  const appError = toAppError(error, correlationId);
  logger.error({ correlationId, code: appError.code }, "Falha ao enfileirar sincronização");
  return { ok: false, error: { code: appError.code, message: appError.userMessage } };
}

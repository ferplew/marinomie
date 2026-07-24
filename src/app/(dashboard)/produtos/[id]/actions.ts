"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/actor";
import { assertPermission } from "@/domain/permissions/authorize";
import { toggleFavorite } from "@/domain/products/catalog.service";
import { refreshStockFromOmie } from "@/domain/inventory/stock.service";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { toAppError, type ActionResult } from "@/lib/errors";
import { logger, newCorrelationId } from "@/lib/logger";

export async function toggleFavoriteAction(
  productId: string,
): Promise<ActionResult<{ favorited: boolean }>> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    assertPermission(actor, "products.read");
    const result = await toggleFavorite(actor, productId);
    revalidatePath(`/produtos/${productId}`);
    return { ok: true, data: result };
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error({ correlationId, code: appError.code }, "Falha ao favoritar produto");
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

/**
 * Atualiza o estoque consultando a Omie na hora.
 *
 * Resolve o `omieId` a partir do id local **dentro do escopo da organização**:
 * aceitar um `omieId` vindo do navegador permitiria consultar produto de outra
 * empresa.
 */
export async function refreshStockAction(
  productId: string,
): Promise<ActionResult<{ refreshed: boolean }>> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    assertPermission(actor, "products.read");

    const product = await prisma.product.findFirst({
      where: orgScope(actor, { id: productId }),
      select: { omieId: true },
    });

    if (!product) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Produto não encontrado." },
      };
    }

    const result = await refreshStockFromOmie(actor.organizationId, product.omieId, {
      priority: "interactive",
    });

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: "INTEGRATION_ERROR",
          message:
            "Não foi possível consultar o estoque no Omie agora. Os números exibidos podem estar desatualizados.",
        },
      };
    }

    revalidatePath(`/produtos/${productId}`);
    return { ok: true, data: { refreshed: true } };
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error({ correlationId, code: appError.code }, "Falha ao atualizar estoque");
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/actor";
import {
  convertQuoteToOrder,
  reconcileUncertainSubmit,
  submitToOmie,
} from "@/domain/sales/sales.service";
import { toAppError, type ActionResult } from "@/lib/errors";
import { logger, newCorrelationId } from "@/lib/logger";

export async function submitQuoteAction(
  documentId: string,
): Promise<ActionResult<{ message: string }>> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    const result = await submitToOmie(actor, documentId);
    revalidatePath(`/orcamentos/${documentId}`);

    switch (result.kind) {
      case "synced":
        return {
          ok: true,
          data: {
            message: `Enviado ao Omie${result.omieNumber ? ` (nº ${result.omieNumber})` : ""}.`,
          },
        };
      case "already_synced":
        return { ok: true, data: { message: "Este orçamento já está no Omie." } };
      case "uncertain":
      case "blocked":
      case "failed":
        return {
          ok: false,
          error: { code: "INTEGRATION_ERROR", message: result.message },
        };
    }
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error({ correlationId, documentId }, "Falha ao enviar orçamento");
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

export async function convertToOrderAction(
  documentId: string,
): Promise<ActionResult<{ message: string }>> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    const result = await convertQuoteToOrder(actor, documentId);
    revalidatePath(`/orcamentos/${documentId}`);
    revalidatePath("/pedidos");

    return result.ok
      ? { ok: true, data: { message: result.message } }
      : { ok: false, error: { code: "CONFLICT", message: result.message } };
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error({ correlationId, documentId }, "Falha ao converter em pedido");
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

/**
 * Verifica no Omie se um envio de resultado incerto chegou a ser aplicado.
 * É a alternativa segura ao "tentar de novo" que duplicaria o pedido.
 */
export async function reconcileAction(
  documentId: string,
): Promise<ActionResult<{ message: string }>> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    const result = await reconcileUncertainSubmit(actor, documentId);
    revalidatePath(`/orcamentos/${documentId}`);

    return result.resolved
      ? { ok: true, data: { message: result.message } }
      : { ok: false, error: { code: "INTEGRATION_ERROR", message: result.message } };
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error({ correlationId, documentId }, "Falha ao reconciliar");
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

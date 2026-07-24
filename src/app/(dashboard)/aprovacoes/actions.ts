"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/actor";
import { decideApproval } from "@/domain/sales/sales.service";
import { toAppError, type ActionResult } from "@/lib/errors";
import { logger, newCorrelationId } from "@/lib/logger";

export async function decideApprovalAction(
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
): Promise<ActionResult<{ message: string }>> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireActor();
    const result = await decideApproval(actor, approvalId, decision);

    revalidatePath("/aprovacoes");
    revalidatePath("/orcamentos");

    return result.ok
      ? { ok: true, data: { message: result.message } }
      : { ok: false, error: { code: "CONFLICT", message: result.message } };
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error({ correlationId, approvalId }, "Falha ao decidir aprovação");
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

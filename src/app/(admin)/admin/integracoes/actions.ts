"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { assertPermission } from "@/domain/permissions/authorize";
import { recordAudit } from "@/server/audit";
import { AppError, toAppError, type ActionResult } from "@/lib/errors";
import { logger, newCorrelationId } from "@/lib/logger";
import {
  connectionService,
  createOmieContext,
  isMockMode,
  recordConnectionTest,
  saveOmieCredentials,
  setIntegrationActive,
} from "@/integrations/omie";

/**
 * Server Actions do painel de integração.
 *
 * Note qual guarda é usada: `requireActor` + `assertPermission`, não
 * `requirePermission`. Server Actions precisam devolver `ActionResult` para o
 * formulário; interromper com `forbidden()` (que é o que `requirePermission`
 * faz) daria uma página 403 no lugar de uma mensagem no formulário
 * (docs/architecture.md §9).
 */

const credentialSchema = z.object({
  appKey: z
    .string()
    .trim()
    .min(6, "Informe a app_key do aplicativo Omie.")
    .max(200),
  appSecret: z
    .string()
    .trim()
    .min(6, "Informe o app_secret do aplicativo Omie.")
    .max(400),
});

function fail<T>(error: unknown, correlationId: string): ActionResult<T> {
  const appError = toAppError(error, correlationId);
  logger.error(
    { correlationId, code: appError.code, message: appError.message },
    "Falha em ação administrativa de integração",
  );
  return {
    ok: false,
    error: { code: appError.code, message: appError.userMessage },
  };
}

export async function saveCredentialsAction(
  _previous: ActionResult<{ appKeyHint: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ appKeyHint: string }>> {
  const correlationId = newCorrelationId();

  try {
    const actor = await requireActor();
    assertPermission(actor, "integrations.configure");

    const parsed = credentialSchema.safeParse({
      appKey: formData.get("appKey"),
      appSecret: formData.get("appSecret"),
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
      }
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Verifique os dados informados.",
          fieldErrors,
        },
      };
    }

    const result = await saveOmieCredentials({
      organizationId: actor.organizationId,
      appKey: parsed.data.appKey,
      appSecret: parsed.data.appSecret,
    });

    // A auditoria registra que a credencial mudou e qual passou a valer —
    // nunca o valor. `appKeyHint` são só os 4 últimos dígitos.
    await recordAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "integration.configured",
      entityType: "omie_credential",
      entityId: actor.organizationId,
      afterData: { appKeyHint: result.appKeyHint, created: result.created },
      correlationId,
    });

    revalidatePath("/admin/integracoes");
    return { ok: true, data: { appKeyHint: result.appKeyHint } };
  } catch (error) {
    return fail(error, correlationId);
  }
}

export async function testConnectionAction(): Promise<
  ActionResult<{ detail: string; mock: boolean }>
> {
  const correlationId = newCorrelationId();

  try {
    const actor = await requireActor();
    assertPermission(actor, "integrations.read");

    const context = await createOmieContext({
      organizationId: actor.organizationId,
      priority: "interactive",
      correlationId,
    });

    const result = await connectionService.testConnection(context);

    // O resultado é gravado mesmo quando falha: saber que o último teste falhou
    // e por quê é justamente o que o administrador precisa ver.
    await recordConnectionTest(actor.organizationId, {
      ok: result.ok,
      detail: result.detail,
    }).catch(() => {
      // Sem credencial salva ainda (modo mock/env): não há linha para atualizar.
    });

    revalidatePath("/admin/integracoes");

    if (!result.ok) {
      return {
        ok: false,
        error: { code: "INTEGRATION_ERROR", message: result.detail },
      };
    }

    return { ok: true, data: { detail: result.detail, mock: isMockMode() } };
  } catch (error) {
    return fail(error, correlationId);
  }
}

export async function setIntegrationActiveAction(
  active: boolean,
): Promise<ActionResult<{ active: boolean }>> {
  const correlationId = newCorrelationId();

  try {
    const actor = await requireActor();
    assertPermission(actor, "integrations.configure");

    await setIntegrationActive(actor.organizationId, active);

    await recordAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "integration.configured",
      entityType: "omie_credential",
      entityId: actor.organizationId,
      afterData: { active },
      correlationId,
    });

    revalidatePath("/admin/integracoes");
    return { ok: true, data: { active } };
  } catch (error) {
    if (error instanceof AppError) return fail(error, correlationId);
    return fail(error, correlationId);
  }
}

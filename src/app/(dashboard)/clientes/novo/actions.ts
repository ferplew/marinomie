"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { assertPermission } from "@/domain/permissions/authorize";
import { createCustomer } from "@/domain/customers/customers.service";
import { toAppError, type ActionResult } from "@/lib/errors";
import { logger, newCorrelationId } from "@/lib/logger";

/**
 * Criação de cliente.
 *
 * O `idempotencyKey` vem do formulário, gerado uma vez quando a tela monta. É a
 * peça que faz duplo clique (ou reenvio do formulário) resolver para o mesmo
 * cliente em vez de dois — combinada com a constraint única no banco, que é
 * quem realmente garante.
 */
const schema = z.object({
  document: z.string().trim().min(11, "Informe o CPF ou CNPJ."),
  legalName: z.string().trim().min(3, "Informe a razão social."),
  tradeName: z.string().trim().optional(),
  email: z.email("E-mail inválido.").optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  street: z.string().trim().optional(),
  number: z.string().trim().optional(),
  complement: z.string().trim().optional(),
  district: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  zipCode: z.string().trim().optional(),
  idempotencyKey: z.uuid("Chave de idempotência inválida."),
});

export interface CreateCustomerActionData {
  readonly customerId: string;
  readonly warning?: string;
}

export async function createCustomerAction(
  _previous: ActionResult<CreateCustomerActionData> | null,
  formData: FormData,
): Promise<ActionResult<CreateCustomerActionData>> {
  const correlationId = newCorrelationId();

  try {
    const actor = await requireActor();
    assertPermission(actor, "customers.create");

    const parsed = schema.safeParse(Object.fromEntries(formData));
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

    const data = parsed.data;
    const hasFullAddress =
      !!data.street && !!data.number && !!data.district && !!data.city && !!data.state && !!data.zipCode;

    const result = await createCustomer(actor, {
      document: data.document,
      legalName: data.legalName,
      ...(data.tradeName ? { tradeName: data.tradeName } : {}),
      ...(data.email ? { email: data.email } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
      ...(hasFullAddress
        ? {
            address: {
              street: data.street!,
              number: data.number!,
              ...(data.complement ? { complement: data.complement } : {}),
              district: data.district!,
              city: data.city!,
              state: data.state!,
              zipCode: data.zipCode!,
            },
          }
        : {}),
      idempotencyKey: data.idempotencyKey,
    });

    revalidatePath("/clientes");

    switch (result.kind) {
      case "created":
        return { ok: true, data: { customerId: result.customerId } };

      case "uncertain":
      case "failed":
        // O cliente EXISTE localmente; o que falhou foi o envio. Reportar como
        // sucesso com aviso é mais fiel que um erro que sugeriria perda do
        // cadastro.
        return {
          ok: true,
          data: {
            customerId: "customerId" in result ? result.customerId : "",
            warning: result.message,
          },
        };

      case "duplicate":
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message: result.message,
            fieldErrors: { document: [result.message] },
          },
        };

      case "invalid":
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: result.message,
            fieldErrors: { [result.field]: [result.message] },
          },
        };

      case "in_progress":
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Este cadastro já está sendo enviado. Aguarde um instante.",
          },
        };
    }
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error(
      { correlationId, code: appError.code, message: appError.message },
      "Falha ao criar cliente",
    );
    return {
      ok: false,
      error: { code: appError.code, message: appError.userMessage },
    };
  }
}

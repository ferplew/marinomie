"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { createQuoteDraft } from "@/domain/sales/sales.service";
import { searchProducts } from "@/domain/products/catalog.service";
import { searchCustomers } from "@/domain/customers/customers.service";
import { toAppError, type ActionResult } from "@/lib/errors";
import { logger, newCorrelationId } from "@/lib/logger";

/**
 * Ações do fluxo rápido de venda.
 *
 * O carrinho vive no cliente até o envio: o vendedor monta a lista offline-ish,
 * e o servidor recalcula **tudo** ao receber. Preço, desconto e total vindos do
 * navegador são ignorados — só produto, quantidade e desconto solicitado são
 * lidos, e o resto é derivado no backend (docs/security.md §3).
 */
const cartSchema = z.object({
  customerId: z.uuid("Selecione um cliente."),
  paymentTermCode: z.string().trim().max(3).optional(),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.string().min(1),
        requestedDiscountPercent: z.string().optional(),
      }),
    )
    .min(1, "Adicione ao menos um produto."),
});

export type CreateQuoteData = {
  readonly documentId: string;
  readonly localNumber?: number;
  readonly warning?: string;
};

export async function createQuoteAction(
  input: unknown,
): Promise<ActionResult<CreateQuoteData>> {
  const correlationId = newCorrelationId();

  try {
    const actor = await requireActor();

    const parsed = cartSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        },
      };
    }

    const result = await createQuoteDraft(actor, {
      customerId: parsed.data.customerId,
      items: parsed.data.items,
      ...(parsed.data.paymentTermCode
        ? { paymentTermCode: parsed.data.paymentTermCode }
        : {}),
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });

    revalidatePath("/orcamentos");

    switch (result.kind) {
      case "created":
        return {
          ok: true,
          data: { documentId: result.documentId, localNumber: result.localNumber },
        };
      case "requires_approval":
        // O orçamento EXISTE — só não pode ser enviado ainda. Reportar erro
        // sugeriria que nada foi salvo.
        return {
          ok: true,
          data: { documentId: result.documentId, warning: result.message },
        };
      case "invalid":
        return {
          ok: false,
          error: { code: "VALIDATION_ERROR", message: result.message },
        };
    }
  } catch (error) {
    const appError = toAppError(error, correlationId);
    logger.error(
      { correlationId, code: appError.code, message: appError.message },
      "Falha ao criar orçamento",
    );
    return {
      ok: false,
      error: { code: appError.code, message: appError.userMessage },
    };
  }
}

/** Busca de produtos para o carrinho, já filtrada por organização e permissão. */
export async function searchProductsForCartAction(
  query: string,
): Promise<
  ActionResult<
    ReadonlyArray<{
      id: string;
      sku: string | null;
      description: string;
      unit: string | null;
      basePrice: string | null;
    }>
  >
> {
  try {
    const actor = await requireActor();
    const result = await searchProducts(actor, { query, pageSize: 10 });
    return {
      ok: true,
      data: result.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        description: item.description,
        unit: item.unit,
        basePrice: item.basePrice,
      })),
    };
  } catch (error) {
    const appError = toAppError(error);
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

export async function searchCustomersForCartAction(
  query: string,
): Promise<
  ActionResult<
    ReadonlyArray<{ id: string; legalName: string; tradeName: string | null; document: string }>
  >
> {
  try {
    const actor = await requireActor();
    const result = await searchCustomers(actor, { query, pageSize: 10 });
    return {
      ok: true,
      data: result.items.map((item) => ({
        id: item.id,
        legalName: item.legalName,
        tradeName: item.tradeName,
        document: item.document,
      })),
    };
  } catch (error) {
    const appError = toAppError(error);
    return { ok: false, error: { code: appError.code, message: appError.userMessage } };
  }
}

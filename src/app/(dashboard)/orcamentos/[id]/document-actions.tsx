"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  convertToOrderAction,
  reconcileAction,
  submitQuoteAction,
} from "./actions";

/**
 * Ações do documento de venda.
 *
 * Duas decisões de interface que existem por causa de risco real, não estética:
 *
 * 1. Quando o envio ficou **incerto**, o botão de enviar some e dá lugar a
 *    "Verificar no Omie". Deixar "enviar" disponível ali seria oferecer ao
 *    vendedor o caminho mais rápido para duplicar um pedido.
 * 2. Enviar e converter pedem confirmação. São ações que criam registro em
 *    sistema externo — o briefing §22 pede confirmação para ações críticas.
 */
export function DocumentActions({
  documentId,
  isQuote,
  isSynced,
  needsReconcile,
  blockedByApproval,
  canConvert,
}: {
  documentId: string;
  isQuote: boolean;
  isSynced: boolean;
  needsReconcile: boolean;
  blockedByApproval: boolean;
  canConvert: boolean;
}): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function run(
    action: () => Promise<{ ok: boolean; data?: { message: string }; error?: { message: string } }>,
    confirmText?: string,
  ): void {
    if (confirmText && !window.confirm(confirmText)) return;

    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(
        result.ok
          ? { ok: true, text: result.data?.message ?? "Concluído." }
          : { ok: false, text: result.error?.message ?? "Falhou." },
      );
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {needsReconcile ? (
          <Button
            variant="secondary"
            pending={pending}
            onClick={() => run(() => reconcileAction(documentId))}
          >
            Verificar no Omie
          </Button>
        ) : (
          !isSynced &&
          !blockedByApproval && (
            <Button
              pending={pending}
              onClick={() =>
                run(
                  () => submitQuoteAction(documentId),
                  "Enviar este orçamento ao Omie?",
                )
              }
            >
              Enviar ao Omie
            </Button>
          )
        )}

        {isQuote && isSynced && canConvert && !needsReconcile && (
          <Button
            variant="secondary"
            pending={pending}
            onClick={() =>
              run(
                () => convertToOrderAction(documentId),
                "Converter este orçamento em pedido? A etapa será alterada no Omie.",
              )
            }
          >
            Converter em pedido
          </Button>
        )}
      </div>

      {message && (
        <p
          role="status"
          className={
            message.ok
              ? "text-sm text-[color:var(--color-success)]"
              : "text-sm text-destructive"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

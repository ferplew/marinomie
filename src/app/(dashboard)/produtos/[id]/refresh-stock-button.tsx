"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { refreshStockAction } from "./actions";

/**
 * Atualização manual do estoque (briefing §6: "atualização manual" faz parte da
 * estratégia híbrida de sincronização).
 *
 * A falha é mostrada com a consequência prática — "os números podem estar
 * desatualizados" — em vez de um "erro" genérico que não ajuda o vendedor a
 * decidir se pode vender.
 */
export function RefreshStockButton({
  productId,
}: {
  productId: string;
}): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRefresh(): void {
    setError(null);
    startTransition(async () => {
      const result = await refreshStockAction(productId);
      if (!result.ok) setError(result.error.message);
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleRefresh}
        pending={pending}
      >
        Atualizar estoque
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

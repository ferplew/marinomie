"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncCatalogAction } from "./actions";

/**
 * Sincronização manual do catálogo.
 *
 * Enquanto as filas da Fase 6 não existem, esta ação roda no próprio request e
 * é limitada a poucas páginas — o texto abaixo do botão diz isso ao
 * administrador em vez de deixá-lo achar que sincronizou tudo.
 */
export function SyncCatalogButton(): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function handleSync(): void {
    setMessage(null);
    startTransition(async () => {
      const result = await syncCatalogAction();
      setMessage(
        result.ok
          ? {
              ok: true,
              text: `${result.data.products} produto(s) e ${result.data.warehouses} local(is) sincronizados em ${result.data.pages} página(s).`,
            }
          : { ok: false, text: result.error.message },
      );
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={handleSync} pending={pending}>
        Sincronizar catálogo e locais
      </Button>
      <p className="text-xs text-muted-foreground">
        Limitado a 5 páginas por execução enquanto as filas não existem.
      </p>
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

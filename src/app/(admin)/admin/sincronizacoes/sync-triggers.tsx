"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  triggerInventorySyncAction,
  triggerProductsSyncAction,
  triggerReconciliationAction,
} from "./actions";

export function SyncTriggers(): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function run(
    action: () => Promise<{ ok: boolean; error?: { message: string } }>,
    successText: string,
  ): void {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(
        result.ok
          ? { ok: true, text: successText }
          : { ok: false, text: result.error?.message ?? "Falhou." },
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disparar sincronização</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            pending={pending}
            onClick={() =>
              run(
                triggerProductsSyncAction,
                "Catálogo enfileirado. O worker processa página a página.",
              )
            }
          >
            Catálogo
          </Button>
          <Button
            size="sm"
            variant="secondary"
            pending={pending}
            onClick={() =>
              run(triggerInventorySyncAction, "Estoque enfileirado.")
            }
          >
            Estoque
          </Button>
          <Button
            size="sm"
            variant="secondary"
            pending={pending}
            onClick={() =>
              run(
                () => triggerReconciliationAction("sales"),
                "Reconciliação de vendas enfileirada.",
              )
            }
          >
            Reconciliar vendas
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          As ações apenas enfileiram — o trabalho acontece no processo de workers.
          Se nenhum worker estiver rodando, os jobs ficam em “na fila”.
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
      </CardContent>
    </Card>
  );
}

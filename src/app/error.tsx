"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Tratamento global de erro da UI (briefing §37: "não silencie erros",
 * docs/security.md §7: nunca exibir stack trace ao usuário).
 *
 * O `digest` é o único identificador mostrado — ele permite correlacionar com o
 * log estruturado no servidor sem revelar nada sobre a falha.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // Em produção, aqui entra o Sentry (Fase 6). O erro nunca é engolido.
    console.error("Erro não tratado na interface", {
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Algo deu errado</h1>
      <p className="text-sm text-muted-foreground">
        Não foi possível concluir esta operação. Tente novamente em alguns
        instantes.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Código de referência: <code>{error.digest}</code>
        </p>
      )}
      <Button onClick={reset}>Tentar novamente</Button>
    </main>
  );
}

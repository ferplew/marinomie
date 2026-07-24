"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * URL do webhook da organização.
 *
 * O token faz parte da URL porque a Omie não oferece assinatura HMAC — então a
 * URL inteira **é** o segredo. O painel deixa isso explícito para o
 * administrador não colar o endereço em lugar público.
 */
export function WebhookUrlPanel({ url }: { url: string | null }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!url) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>URL do webhook</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configure a credencial da Omie em Integrações para gerar a URL.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>URL do webhook</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Cadastre esta URL no portal do desenvolvedor Omie, em “Adicionar novo
          webhook”.
        </p>

        <code className="block overflow-x-auto rounded-[var(--radius)] border border-border p-2 text-xs">
          {revealed ? url : url.replace(/\/[^/]+$/, "/••••••••••••")}
        </code>

        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRevealed(!revealed)}>
            {revealed ? "Ocultar" : "Revelar"}
          </Button>
          <Button size="sm" onClick={copy}>
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>

        <p className="text-xs text-[color:var(--color-warning)]">
          A Omie não assina os webhooks, então o token na URL é a única
          autenticação. Trate o endereço como uma senha.
        </p>
      </CardContent>
    </Card>
  );
}

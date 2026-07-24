import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Integrações · marinomie" };

/**
 * Estado da integração com o Omie.
 *
 * Nesta fase a tela é só leitura: configurar credenciais, testar conexão,
 * sincronizar e reprocessar dependem do client de integração (Fase 4) e das
 * filas (Fase 6). Preferimos declarar o que falta a exibir botões que não fazem
 * nada.
 *
 * Os campos criptografados (`appKeyEncrypted`, `appSecretEncrypted`) nunca são
 * selecionados aqui — só a dica dos últimos dígitos (docs/security.md §4).
 */
export default async function AdminIntegrationsPage(): Promise<React.JSX.Element> {
  const actor = await requirePermission("integrations.read");

  const credential = await prisma.omieCredential.findUnique({
    where: { organizationId: actor.organizationId },
    select: {
      appKeyHint: true,
      active: true,
      lastTestedAt: true,
      lastTestResult: true,
      createdAt: true,
    },
  });

  const mockMode = process.env["OMIE_MOCK_MODE"] !== "false";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Integrações</h1>

      <Card>
        <CardHeader>
          <CardTitle>Credencial Omie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {credential ? (
            <>
              <p>
                app_key: <code className="text-muted-foreground">***{credential.appKeyHint}</code>
              </p>
              <p className="text-muted-foreground">
                {credential.active ? "Integração ativa" : "Integração pausada"}
              </p>
              <p className="text-muted-foreground">
                {credential.lastTestedAt
                  ? `Último teste: ${credential.lastTestedAt.toLocaleString("pt-BR")} — ${credential.lastTestResult ?? "sem detalhe"}`
                  : "Conexão nunca testada."}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Nenhuma credencial configurada para esta organização.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modo de operação</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            {mockMode
              ? "Modo mock ativo: nenhuma chamada é feita à API real da Omie."
              : "Modo real: as chamadas usarão a credencial configurada."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ainda não disponível</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-inside list-disc space-y-1">
            <li>Configurar credenciais e testar conexão (Fase 4)</li>
            <li>Sincronizações de produtos, estoque e clientes (Fases 5 e 6)</li>
            <li>Jobs pendentes/falhos e reprocessamento (Fase 6)</li>
            <li>Webhooks recebidos e eventos duplicados (Fase 6)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

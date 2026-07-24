import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { hasPermission } from "@/domain/permissions/authorize";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isMockMode } from "@/integrations/omie";
import { CredentialForm } from "./credential-form";

export const metadata: Metadata = { title: "Integrações · marinomie" };

/**
 * Estado da integração com o Omie.
 *
 * Os campos criptografados (`appKeyEncrypted`, `appSecretEncrypted`) nunca são
 * selecionados: só a dica dos últimos dígitos (docs/security.md §4).
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

  const mockMode = isMockMode();
  const canConfigure = hasPermission(actor, "integrations.configure");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Integrações</h1>

      <Card>
        <CardHeader>
          <CardTitle>Estado da conexão</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {credential ? (
            <>
              <p>
                app_key:{" "}
                <code className="text-muted-foreground">
                  ***{credential.appKeyHint}
                </code>
              </p>
              <p className="text-muted-foreground">
                {credential.active ? "Integração ativa" : "Integração pausada"} ·
                configurada em {credential.createdAt.toLocaleDateString("pt-BR")}
              </p>
              <p className="text-muted-foreground">
                {credential.lastTestedAt
                  ? `Último teste em ${credential.lastTestedAt.toLocaleString("pt-BR")} — ${credential.lastTestResult ?? "sem detalhe"}`
                  : "Conexão ainda não testada."}
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
          {mockMode ? (
            <p>
              <strong>Modo mock ativo.</strong> Nenhuma chamada é feita à API real
              da Omie — as respostas vêm de fixtures locais. Desative{" "}
              <code>OMIE_MOCK_MODE</code> para usar a integração real.
            </p>
          ) : (
            <p>
              <strong>Modo real.</strong> As chamadas usam a credencial
              configurada e contam para o limite de 240 requisições por minuto da
              Omie.
            </p>
          )}
        </CardContent>
      </Card>

      {canConfigure && (
        <Card>
          <CardHeader>
            <CardTitle>
              {credential ? "Substituir credencial" : "Configurar credencial"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CredentialForm hasCredential={credential !== null} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ainda não disponível</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-inside list-disc space-y-1">
            <li>Sincronizações de produtos, estoque e clientes (Fases 5 e 6)</li>
            <li>Jobs pendentes/falhos e reprocessamento (Fase 6)</li>
            <li>Webhooks recebidos e eventos duplicados (Fase 6)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import { requireActor } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { hasPermission } from "@/domain/permissions/authorize";
import { orgScope } from "@/server/scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Administração · marinomie" };

/**
 * Visão geral administrativa.
 *
 * Só mostra o que já existe de verdade na Fase 3. O painel de integração
 * completo (estado da conexão, últimas sincronizações, jobs, webhooks) é da
 * Fase 6 — declarar aqui números que ainda não são coletados seria mentir sobre
 * o estado do sistema.
 */
export default async function AdminOverviewPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();

  const [userCount, sellerLinkCount, credential] = await Promise.all([
    prisma.user.count({ where: orgScope(actor, { deletedAt: null }) }),
    prisma.sellerLink.count({ where: orgScope(actor, { active: true }) }),
    hasPermission(actor, "integrations.read")
      ? prisma.omieCredential.findUnique({
          where: { organizationId: actor.organizationId },
          // Nunca selecionamos os campos criptografados: o painel mostra apenas
          // a dica dos últimos dígitos (docs/security.md §4).
          select: { appKeyHint: true, active: true, lastTestedAt: true, lastTestResult: true },
        })
      : null,
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Usuários ativos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{userCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vendedores vinculados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{sellerLinkCount}</p>
          </CardContent>
        </Card>
      </div>

      {hasPermission(actor, "integrations.read") && (
        <Card>
          <CardHeader>
            <CardTitle>Integração Omie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {credential ? (
              <>
                <p>
                  Credencial configurada:{" "}
                  <code className="text-muted-foreground">
                    ***{credential.appKeyHint}
                  </code>
                </p>
                <p className="text-muted-foreground">
                  Status: {credential.active ? "ativa" : "pausada"}
                  {credential.lastTestedAt
                    ? ` · último teste em ${credential.lastTestedAt.toLocaleString("pt-BR")}`
                    : " · nunca testada"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Nenhuma credencial da Omie configurada. O client de integração e a
                ação “testar conexão” entram na Fase 4 do roadmap.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

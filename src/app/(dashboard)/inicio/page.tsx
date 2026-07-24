import type { Metadata } from "next";
import { requireActor } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";

export const metadata: Metadata = { title: "Início · marinomie" };

/**
 * Dashboard do vendedor.
 *
 * Na Fase 3 os indicadores comerciais (pedidos do dia, orçamentos vencendo,
 * pedidos com erro) ainda não existem — as entidades correspondentes entram na
 * Fase 5. Em vez de exibir números falsos, a tela declara honestamente o que
 * ainda não está disponível.
 */
export default async function HomePage(): Promise<React.JSX.Element> {
  const actor = await requireActor();

  const [organization, sellerLink] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    }),
    actor.sellerLinkId
      ? prisma.sellerLink.findUnique({
          where: { id: actor.sellerLinkId },
          select: { displayName: true, omieSellerId: true },
        })
      : null,
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Início</h1>
        <p className="text-sm text-muted-foreground">{organization?.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vendedor vinculado</CardTitle>
        </CardHeader>
        <CardContent>
          {sellerLink ? (
            <p className="text-sm">
              {sellerLink.displayName}{" "}
              <span className="text-muted-foreground">
                (código Omie {sellerLink.omieSellerId})
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Seu usuário ainda não está vinculado a um vendedor do Omie. Peça ao
              administrador para configurar o vínculo antes de criar orçamentos.
            </p>
          )}
        </CardContent>
      </Card>

      <EmptyState
        title="Indicadores comerciais ainda não disponíveis"
        description="Pedidos do dia, orçamentos em aberto e status de sincronização aparecem aqui quando os módulos comerciais entrarem (Fase 5 do roadmap)."
      />
    </div>
  );
}

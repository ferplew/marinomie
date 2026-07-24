import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { Card, CardContent, EmptyState } from "@/components/ui/card";

export const metadata: Metadata = { title: "Auditoria · marinomie" };

const PAGE_SIZE = 50;

/**
 * Trilha de auditoria da organização.
 *
 * Mostra apenas metadados do evento (ator, ação, entidade, IP). `beforeData` e
 * `afterData` existem no banco já mascarados, mas não são exibidos nesta
 * listagem: visualizar o conteúdo de um evento é uma ação mais sensível que
 * merece sua própria tela e seu próprio registro de auditoria.
 */
export default async function AdminAuditPage(): Promise<React.JSX.Element> {
  const actor = await requirePermission("audit.read");

  const events = await prisma.auditLog.findMany({
    where: orgScope(actor),
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      ipAddress: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Auditoria</h1>

      {events.length === 0 ? (
        <EmptyState
          title="Nenhum evento registrado"
          description="Ações auditáveis aparecem aqui conforme forem ocorrendo."
        />
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li key={event.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{event.action}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {event.entityType}
                        {event.entityId ? ` · ${event.entityId}` : ""}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {event.actor?.name ?? "sistema"}
                        {event.ipAddress ? ` · ${event.ipAddress}` : ""}
                      </p>
                    </div>
                    <time
                      dateTime={event.createdAt.toISOString()}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {event.createdAt.toLocaleString("pt-BR")}
                    </time>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Exibindo os {PAGE_SIZE} eventos mais recentes. Paginação, filtros por
        ação/ator/período e detalhamento do evento entram junto com a auditoria
        completa (Fase 6).
      </p>
    </div>
  );
}

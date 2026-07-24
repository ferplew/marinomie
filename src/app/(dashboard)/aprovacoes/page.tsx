import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { listPendingApprovals } from "@/domain/sales/sales.service";
import { Card, CardContent, EmptyState } from "@/components/ui/card";
import { ApprovalButtons } from "./approval-buttons";

export const metadata: Metadata = { title: "Aprovações · marinomie" };

/**
 * Fila de aprovação de desconto.
 *
 * Fecha a lacuna da Fase 5, em que o bloqueio funcionava mas aprovar exigia
 * mexer no banco.
 */
export default async function ApprovalsPage(): Promise<React.JSX.Element> {
  const actor = await requirePermission("discounts.approve");
  const pending = await listPendingApprovals(actor);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Aprovações</h1>

      {pending.length === 0 ? (
        <EmptyState
          title="Nenhuma aprovação pendente"
          description="Descontos acima do limite do vendedor aparecem aqui."
        />
      ) : (
        <ul className="space-y-2">
          {pending.map((approval) => (
            <li key={approval.id}>
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        Orçamento #{approval.localNumber}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {approval.customerName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {approval.sellerName} ·{" "}
                        {approval.createdAt.toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium tabular-nums">
                        {formatCurrency(approval.total)}
                      </p>
                      <p className="text-xs text-[color:var(--color-warning)]">
                        {approval.requestedPercent}% (limite{" "}
                        {approval.ceilingPercent}%)
                      </p>
                    </div>
                  </div>
                  <ApprovalButtons approvalId={approval.id} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Quem solicitou um desconto não pode aprová-lo, mesmo tendo a permissão.
      </p>
    </div>
  );
}

function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

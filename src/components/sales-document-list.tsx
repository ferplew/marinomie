import Link from "next/link";
import { Card, CardContent, EmptyState } from "@/components/ui/card";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import type { SalesDocumentListItem } from "@/domain/sales/sales.service";

/**
 * Listagem compartilhada por orçamentos e pedidos.
 *
 * Ambos são o mesmo tipo de registro; separar em dois componentes só duplicaria
 * a mesma marcação.
 */
export function SalesDocumentList({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: readonly SalesDocumentListItem[];
  emptyTitle: string;
  emptyDescription: string;
}): React.JSX.Element {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/orcamentos/${item.id}`} className="block">
            <Card className="transition-opacity active:opacity-70">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      #{item.localNumber}
                      {item.omieNumber ? ` · Omie ${item.omieNumber}` : ""}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {item.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.createdAt.toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums">
                      {formatCurrency(item.total)}
                    </p>
                    <SyncStatusBadge status={item.syncStatus} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

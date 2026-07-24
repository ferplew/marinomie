import type { Metadata } from "next";
import { requireAnyPermission } from "@/server/auth/actor";
import { listSalesDocuments } from "@/domain/sales/sales.service";
import { SalesDocumentList } from "@/components/sales-document-list";

export const metadata: Metadata = { title: "Pedidos · marinomie" };

/**
 * Pedidos são o mesmo registro dos orçamentos, filtrados por `kind` — reflexo
 * direto de como a Omie modela: um recurso, diferenciado pela etapa.
 */
export default async function OrdersPage(): Promise<React.JSX.Element> {
  const actor = await requireAnyPermission(["orders.read_all", "orders.read_own"]);
  const result = await listSalesDocuments(actor, { kind: "ORDER" });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Pedidos</h1>
      <SalesDocumentList
        items={result.items}
        emptyTitle="Nenhum pedido"
        emptyDescription="Pedidos aparecem aqui quando um orçamento é convertido."
      />
    </div>
  );
}

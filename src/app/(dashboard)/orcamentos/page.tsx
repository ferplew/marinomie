import type { Metadata } from "next";
import Link from "next/link";
import { requireAnyPermission } from "@/server/auth/actor";
import { hasPermission } from "@/domain/permissions/authorize";
import { listSalesDocuments } from "@/domain/sales/sales.service";
import { SalesDocumentList } from "@/components/sales-document-list";

export const metadata: Metadata = { title: "Orçamentos · marinomie" };

export default async function QuotesPage(): Promise<React.JSX.Element> {
  const actor = await requireAnyPermission(["quotes.read_all", "quotes.read_own"]);
  const result = await listSalesDocuments(actor, { kind: "QUOTE" });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Orçamentos</h1>
        {hasPermission(actor, "quotes.create") && (
          <Link href="/orcamentos/novo" className="shrink-0 text-sm text-primary">
            Novo orçamento
          </Link>
        )}
      </div>

      <SalesDocumentList
        items={result.items}
        emptyTitle="Nenhum orçamento"
        emptyDescription="Crie um orçamento escolhendo o cliente e os produtos."
      />
    </div>
  );
}

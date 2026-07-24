import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/server/auth/actor";
import { QuoteBuilder } from "./quote-builder";

export const metadata: Metadata = { title: "Novo orçamento · marinomie" };

export default async function NewQuotePage(): Promise<React.JSX.Element> {
  await requirePermission("quotes.create");

  return (
    <div className="space-y-4">
      <Link href="/orcamentos" className="text-sm text-primary">
        ← Orçamentos
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Novo orçamento</h1>
      <QuoteBuilder />
    </div>
  );
}

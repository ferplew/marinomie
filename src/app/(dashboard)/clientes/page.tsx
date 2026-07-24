import type { Metadata } from "next";
import Link from "next/link";
import { requireAnyPermission } from "@/server/auth/actor";
import { hasPermission } from "@/domain/permissions/authorize";
import { searchCustomers } from "@/domain/customers/customers.service";
import { formatDocument } from "@/domain/customers/document";
import { Card, CardContent, EmptyState } from "@/components/ui/card";
import { SearchField } from "@/components/search-field";
import { SyncStatusBadge } from "@/components/sync-status-badge";

export const metadata: Metadata = { title: "Clientes · marinomie" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requireAnyPermission([
    "customers.read_all",
    "customers.read_own",
  ]);
  const params = await searchParams;

  const result = await searchCustomers(actor, {
    ...(params.q ? { query: params.q } : {}),
    page: Number(params.page ?? "1") || 1,
  });

  const canCreate = hasPermission(actor, "customers.create");
  const seesOnlyOwn = !hasPermission(actor, "customers.read_all");

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
        {canCreate && (
          <Link href="/clientes/novo" className="shrink-0 text-sm text-primary">
            Novo cliente
          </Link>
        )}
      </div>

      <SearchField
        action="/clientes"
        placeholder="Buscar por nome, fantasia ou documento"
        defaultValue={params.q ?? ""}
      />

      {result.items.length === 0 ? (
        <EmptyState
          title={params.q ? "Nenhum cliente encontrado" : "Nenhum cliente"}
          description={
            params.q
              ? "Tente outro termo. A busca por documento aceita com ou sem pontuação."
              : seesOnlyOwn
                ? "Você ainda não tem clientes vinculados."
                : "Nenhum cliente cadastrado ou sincronizado ainda."
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {result.totalItems} cliente(s)
            {seesOnlyOwn ? " · apenas os seus" : ""}
          </p>

          <ul className="space-y-2">
            {result.items.map((customer) => (
              <li key={customer.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {customer.tradeName || customer.legalName}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {formatDocument(customer.document)}
                        </p>
                        {customer.email && (
                          <p className="truncate text-xs text-muted-foreground">
                            {customer.email}
                          </p>
                        )}
                      </div>
                      <SyncStatusBadge status={customer.syncStatus} />
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

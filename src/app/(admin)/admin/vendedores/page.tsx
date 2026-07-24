import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { Card, CardContent, EmptyState } from "@/components/ui/card";

export const metadata: Metadata = { title: "Vendedores · marinomie" };

/**
 * Vínculos entre usuários da plataforma e vendedores do Omie.
 *
 * `maxDiscountPercent` e `defaultPriceTableId` são atributos exclusivamente
 * locais: a API de vendedores da Omie não possui esses campos
 * (docs/omie-api-mapping.md §6).
 */
export default async function AdminSellersPage(): Promise<React.JSX.Element> {
  const actor = await requirePermission("users.read");

  const sellerLinks = await prisma.sellerLink.findMany({
    where: orgScope(actor),
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      omieSellerId: true,
      omieSellerCode: true,
      active: true,
      maxDiscountPercent: true,
      defaultPriceTableId: true,
      user: { select: { email: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Vendedores</h1>

      {sellerLinks.length === 0 ? (
        <EmptyState
          title="Nenhum vínculo de vendedor"
          description="Nenhum usuário está vinculado a um vendedor do Omie. Sem vínculo, o usuário não consegue criar orçamentos ou pedidos."
        />
      ) : (
        <ul className="space-y-2">
          {sellerLinks.map((link) => (
            <li key={link.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{link.displayName}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {link.user.email}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Código Omie {link.omieSellerId}
                        {link.omieSellerCode ? ` · ${link.omieSellerCode}` : ""} ·
                        desconto máximo {link.maxDiscountPercent.toString()}%
                      </p>
                    </div>
                    <span
                      className={
                        link.active
                          ? "shrink-0 text-xs text-[color:var(--color-success)]"
                          : "shrink-0 text-xs text-destructive"
                      }
                    >
                      {link.active ? "ativo" : "inativo"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        A busca de vendedores no Omie (<code>ListarVendedores</code>) para criar
        vínculos pela interface depende do client de integração — Fase 4 do
        roadmap.
      </p>
    </div>
  );
}

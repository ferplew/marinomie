import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/actor";
import {
  getProductById,
  isFavorite,
  recordProductView,
} from "@/domain/products/catalog.service";
import { getStockForDisplay } from "@/domain/inventory/stock.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LastSyncBadge } from "@/components/last-sync-badge";
import { FavoriteButton } from "./favorite-button";
import { RefreshStockButton } from "./refresh-stock-button";

export const metadata: Metadata = { title: "Produto · marinomie" };

/**
 * Detalhe do produto com a posição de estoque.
 *
 * Os campos físico e reservado só chegam aqui se o usuário tiver a permissão —
 * a remoção acontece na serialização do serviço, não nesta tela. Por isso o
 * código testa `!== undefined` em vez de checar permissão de novo: se o campo
 * veio, é porque podia vir.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requirePermission("products.read");
  const { id } = await params;

  const product = await getProductById(actor, id);
  if (!product) notFound();

  const [stock, favorited] = await Promise.all([
    getStockForDisplay(actor, id),
    isFavorite(actor, id),
    recordProductView(actor, id),
  ]);

  return (
    <div className="space-y-4">
      <Link href="/produtos" className="text-sm text-primary">
        ← Produtos
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {product.description}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {product.sku ?? "sem SKU"}
            {product.unit ? ` · ${product.unit}` : ""}
            {product.familyName ? ` · ${product.familyName}` : ""}
          </p>
        </div>
        <FavoriteButton productId={id} initialFavorited={favorited} />
      </div>

      {!product.active && (
        <p className="rounded-[var(--radius)] border border-destructive p-3 text-sm text-destructive">
          Produto inativo no Omie — não deve ser vendido.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Preço</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums">
            {formatCurrency(product.basePrice)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Preço do cadastro. O preço de venda é resolvido pela tabela aplicável
            ao cliente no momento do orçamento.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Estoque</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stock === null ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma posição de estoque em cache. Atualize para consultar o Omie.
            </p>
          ) : (
            <>
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {stock.totalAvailable}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    disponível
                  </span>
                </p>
                {stock.hasIndeterminate && (
                  <p className="text-xs text-[color:var(--color-warning)]">
                    Alguns depósitos não puderam ser calculados com a regra atual
                    e ficaram fora do total.
                  </p>
                )}
              </div>

              <ul className="space-y-2">
                {stock.positions.map((position) => (
                  <li
                    key={position.warehouseId}
                    className="rounded-[var(--radius)] border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {position.warehouseName ?? "Depósito"}
                        </p>
                        {!position.availableForSale && (
                          <p className="text-xs text-muted-foreground">
                            não disponível para venda
                          </p>
                        )}
                        {position.belowMinimum && (
                          <p className="text-xs text-[color:var(--color-warning)]">
                            abaixo do estoque mínimo ({position.minStock})
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 tabular-nums">
                        {position.indeterminate ? "—" : position.available}
                      </p>
                    </div>

                    {(position.physical !== undefined ||
                      position.reserved !== undefined) && (
                      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {position.physical !== undefined && (
                          <div className="flex gap-1">
                            <dt>físico:</dt>
                            <dd className="tabular-nums">
                              {position.physical ?? "—"}
                            </dd>
                          </div>
                        )}
                        {position.reserved !== undefined && (
                          <div className="flex gap-1">
                            <dt>reservado:</dt>
                            <dd className="tabular-nums">
                              {position.reserved ?? "—"}
                            </dd>
                          </div>
                        )}
                        {position.expectedOut !== undefined && (
                          <div className="flex gap-1">
                            <dt>pendente:</dt>
                            <dd className="tabular-nums">
                              {position.expectedOut ?? "—"}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </li>
                ))}
              </ul>

              <p className="text-xs text-muted-foreground">
                Regra de disponibilidade: <code>{stock.rule}</code>
              </p>

              <LastSyncBadge
                lastSyncAt={stock.readAt}
                label="Estoque lido"
                emptyLabel="Estoque nunca consultado"
                stale={stock.stale}
              />
            </>
          )}

          <RefreshStockButton productId={id} />
        </CardContent>
      </Card>

      <LastSyncBadge
        lastSyncAt={product.lastSyncAt}
        label="Cadastro sincronizado"
        emptyLabel="Cadastro nunca sincronizado"
      />
    </div>
  );
}

function formatCurrency(value: string | null): string {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

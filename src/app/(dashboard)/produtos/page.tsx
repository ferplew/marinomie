import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/server/auth/actor";
import { searchProducts, getCatalogLastSync } from "@/domain/products/catalog.service";
import { Card, CardContent, EmptyState } from "@/components/ui/card";
import { SearchField } from "@/components/search-field";
import { LastSyncBadge } from "@/components/last-sync-badge";

export const metadata: Metadata = { title: "Produtos · marinomie" };

/**
 * Catálogo de produtos.
 *
 * A busca é servida pelo cache local, não pela Omie: o vendedor digitando na
 * tela não pode consumir a janela de 240 req/min. O rodapé informa quando o
 * catálogo foi sincronizado pela última vez, para o número na tela ter contexto.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; fav?: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requirePermission("products.read");
  const params = await searchParams;

  const page = Number(params.page ?? "1") || 1;
  const onlyFavorites = params.fav === "1";

  const [result, lastSync] = await Promise.all([
    searchProducts(actor, {
      ...(params.q ? { query: params.q } : {}),
      page,
      onlyFavorites,
    }),
    getCatalogLastSync(actor),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Produtos</h1>
        <Link
          href={onlyFavorites ? "/produtos" : "/produtos?fav=1"}
          className="shrink-0 text-sm text-primary"
        >
          {onlyFavorites ? "Ver todos" : "Favoritos"}
        </Link>
      </div>

      <SearchField
        action="/produtos"
        placeholder="Buscar por SKU, descrição ou EAN"
        defaultValue={params.q ?? ""}
      />

      {result.items.length === 0 ? (
        <EmptyState
          title={params.q ? "Nenhum produto encontrado" : "Catálogo vazio"}
          description={
            params.q
              ? "Tente outro termo, ou verifique se o catálogo já foi sincronizado."
              : "O catálogo ainda não foi sincronizado com o Omie. Um administrador pode iniciar a sincronização em Integrações."
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {result.totalItems} produto(s) · página {result.page} de{" "}
            {result.totalPages}
          </p>

          <ul className="space-y-2">
            {result.items.map((product) => (
              <li key={product.id}>
                <Link href={`/produtos/${product.id}`} className="block">
                  <Card className="transition-opacity active:opacity-70">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {product.description}
                          </p>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {product.sku ?? "sem SKU"}
                            {product.unit ? ` · ${product.unit}` : ""}
                            {product.familyName ? ` · ${product.familyName}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-medium tabular-nums">
                            {formatCurrency(product.basePrice)}
                          </p>
                          {!product.active && (
                            <p className="text-xs text-destructive">inativo</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            query={params.q}
            onlyFavorites={onlyFavorites}
          />
        </>
      )}

      <LastSyncBadge
        lastSyncAt={lastSync}
        label="Catálogo sincronizado"
        emptyLabel="Catálogo nunca sincronizado"
      />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  query,
  onlyFavorites,
}: {
  page: number;
  totalPages: number;
  query?: string | undefined;
  onlyFavorites: boolean;
}): React.JSX.Element | null {
  if (totalPages <= 1) return null;

  // Forma de objeto: `typedRoutes` valida o pathname literal e aceita a query
  // dinâmica, sem precisar montar (e castar) uma string.
  const buildQuery = (target: number): Record<string, string> => ({
    ...(query ? { q: query } : {}),
    ...(onlyFavorites ? { fav: "1" } : {}),
    page: String(target),
  });

  return (
    <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Paginação">
      {page > 1 ? (
        <Link
          href={{ pathname: "/produtos", query: buildQuery(page - 1) }}
          className="text-sm text-primary"
        >
          ← Anterior
        </Link>
      ) : (
        <span />
      )}
      {page < totalPages ? (
        <Link
          href={{ pathname: "/produtos", query: buildQuery(page + 1) }}
          className="text-sm text-primary"
        >
          Próxima →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function formatCurrency(value: string | null): string {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

import "server-only";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { cacheGet, cacheKey, cacheSet } from "@/server/redis";
import { logger } from "@/lib/logger";
import {
  createOmieContext,
  productsService,
  isOmieIntegrationError,
} from "@/integrations/omie";
import type { ActorContext } from "@/domain/permissions/authorize";
import { visibleStockFields } from "@/domain/permissions/authorize";

/**
 * Catálogo de produtos.
 *
 * Estratégia de leitura (docs/synchronization-strategy.md §3 e §4): a busca do
 * vendedor é servida pelo **cache local** no Postgres, que é rápido e
 * pesquisável. A Omie alimenta esse cache por sincronização; a tela nunca chama
 * a Omie no caminho da digitação, o que estouraria o limite de 240 req/min em
 * minutos com poucos vendedores buscando ao mesmo tempo.
 *
 * O preço e o estoque exibidos aqui são **informativos**. Antes de confirmar um
 * pedido, ambos são revalidados direto na Omie (briefing §7).
 */

export interface ProductListItem {
  readonly id: string;
  readonly omieId: number;
  readonly sku: string | null;
  readonly description: string;
  readonly unit: string | null;
  readonly basePrice: string | null;
  readonly active: boolean;
  readonly familyName: string | null;
  readonly lastSyncAt: Date | null;
  /** Presente apenas com `products.view_cost`. */
  readonly averageCost?: string | null;
}

export interface ProductPage {
  readonly items: readonly ProductListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface SearchProductsParams {
  readonly query?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly onlyActive?: boolean;
  readonly onlyFavorites?: boolean;
}

const MAX_PAGE_SIZE = 50;

/**
 * Busca por SKU, descrição ou código.
 *
 * A busca é `insensitive` e por `contains` — suficiente para o volume de um
 * catálogo de distribuidora. Se o catálogo crescer a ponto de isso pesar, o
 * caminho é índice GIN com trigram, não paginação maior.
 */
export async function searchProducts(
  actor: ActorContext,
  params: SearchProductsParams = {},
): Promise<ProductPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const query = params.query?.trim();

  const where = orgScope(actor, {
    deletedAt: null,
    ...(params.onlyActive !== false ? { active: true } : {}),
    ...(query
      ? {
          OR: [
            { sku: { contains: query, mode: "insensitive" as const } },
            { description: { contains: query, mode: "insensitive" as const } },
            { ean: { contains: query } },
          ],
        }
      : {}),
    ...(params.onlyFavorites
      ? { favorites: { some: { userId: actor.userId } } }
      : {}),
  });

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ description: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        omieId: true,
        sku: true,
        description: true,
        unit: true,
        basePrice: true,
        active: true,
        lastSyncAt: true,
        family: { select: { name: true } },
      },
    }),
  ]);

  const canSeeCost = visibleStockFields(actor).cost;

  return {
    items: rows.map((row) => ({
      id: row.id,
      omieId: row.omieId,
      sku: row.sku,
      description: row.description,
      unit: row.unit,
      basePrice: row.basePrice?.toString() ?? null,
      active: row.active,
      familyName: row.family?.name ?? null,
      lastSyncAt: row.lastSyncAt,
      // O campo simplesmente não existe na resposta quando falta permissão —
      // não é enviado e escondido na tela (docs/permissions.md §3).
      ...(canSeeCost ? { averageCost: null } : {}),
    })),
    page,
    pageSize,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getProductById(
  actor: ActorContext,
  productId: string,
): Promise<ProductListItem | null> {
  const row = await prisma.product.findFirst({
    where: orgScope(actor, { id: productId, deletedAt: null }),
    select: {
      id: true,
      omieId: true,
      sku: true,
      description: true,
      unit: true,
      basePrice: true,
      active: true,
      lastSyncAt: true,
      family: { select: { name: true } },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    omieId: row.omieId,
    sku: row.sku,
    description: row.description,
    unit: row.unit,
    basePrice: row.basePrice?.toString() ?? null,
    active: row.active,
    familyName: row.family?.name ?? null,
    lastSyncAt: row.lastSyncAt,
  };
}

/** Registra a consulta para o atalho "produtos recentes" do início. */
export async function recordProductView(
  actor: ActorContext,
  productId: string,
): Promise<void> {
  try {
    await prisma.productRecentView.upsert({
      where: { userId_productId: { userId: actor.userId, productId } },
      update: { viewedAt: new Date() },
      create: { userId: actor.userId, productId },
    });
  } catch (error) {
    // Registrar histórico de navegação nunca pode derrubar a consulta em si.
    logger.warn({ productId, err: String(error) }, "Falha ao registrar produto recente");
  }
}

export async function toggleFavorite(
  actor: ActorContext,
  productId: string,
): Promise<{ readonly favorited: boolean }> {
  // Confirma que o produto é da organização antes de criar o vínculo: sem isso,
  // um id de outra organização viraria um favorito válido.
  const product = await prisma.product.findFirst({
    where: orgScope(actor, { id: productId }),
    select: { id: true },
  });
  if (!product) return { favorited: false };

  const existing = await prisma.productFavorite.findUnique({
    where: { userId_productId: { userId: actor.userId, productId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.productFavorite.delete({ where: { id: existing.id } });
    return { favorited: false };
  }

  await prisma.productFavorite.create({
    data: { userId: actor.userId, productId },
  });
  return { favorited: true };
}

export async function isFavorite(
  actor: ActorContext,
  productId: string,
): Promise<boolean> {
  const found = await prisma.productFavorite.findUnique({
    where: { userId_productId: { userId: actor.userId, productId } },
    select: { id: true },
  });
  return found !== null;
}

// ---------------------------------------------------------------------------
// Sincronização a partir da Omie
// ---------------------------------------------------------------------------

export interface SyncResult {
  readonly fetched: number;
  readonly upserted: number;
  readonly failed: boolean;
  readonly error?: string;
}

/**
 * Sincroniza uma página de produtos da Omie para o cache local.
 *
 * Fica aqui, e não num worker, porque a Fase 6 (filas) ainda não existe. A
 * assinatura já é a que o job vai usar: recebe página e devolve progresso, para
 * que mover isto para a fila seja mudança de chamador, não de lógica.
 */
export async function syncProductsPage(
  organizationId: string,
  params: { readonly page: number; readonly pageSize?: number },
): Promise<SyncResult> {
  try {
    const context = await createOmieContext({
      organizationId,
      priority: "background",
    });

    const result = await productsService.listProducts(context, {
      page: params.page,
      ...(params.pageSize !== undefined ? { pageSize: params.pageSize } : {}),
    });

    let upserted = 0;

    for (const product of result.items) {
      const familyId = await upsertFamily(
        organizationId,
        product.familyOmieId,
        product.familyName,
      );

      await prisma.product.upsert({
        where: {
          organizationId_omieId: { organizationId, omieId: product.omieId },
        },
        update: {
          integrationCode: product.integrationCode,
          sku: product.sku,
          description: product.description,
          unit: product.unit,
          ncm: product.ncm,
          ean: product.ean,
          basePrice: product.basePrice,
          active: product.active,
          familyId,
          syncStatus: "SYNCED",
          lastSyncAt: new Date(),
          lastSyncError: null,
          version: { increment: 1 },
        },
        create: {
          organizationId,
          omieId: product.omieId,
          integrationCode: product.integrationCode,
          sku: product.sku,
          description: product.description,
          unit: product.unit,
          ncm: product.ncm,
          ean: product.ean,
          basePrice: product.basePrice,
          active: product.active,
          familyId,
          syncStatus: "SYNCED",
          lastSyncAt: new Date(),
        },
      });
      upserted += 1;
    }

    return { fetched: result.items.length, upserted, failed: false };
  } catch (error) {
    const message = isOmieIntegrationError(error)
      ? `${error.code}: ${error.omieDescription ?? error.message}`
      : "Falha inesperada na sincronização de produtos";

    logger.error(
      { organizationId, page: params.page, err: message },
      "Sincronização de produtos falhou",
    );

    return { fetched: 0, upserted: 0, failed: true, error: message };
  }
}

async function upsertFamily(
  organizationId: string,
  omieId: number | null,
  name: string | null,
): Promise<string | null> {
  if (omieId === null) return null;

  const family = await prisma.productFamily.upsert({
    where: { organizationId_omieId: { organizationId, omieId } },
    update: name ? { name } : {},
    create: { organizationId, omieId, name: name ?? `Família ${omieId}` },
    select: { id: true },
  });

  return family.id;
}

/** Data da sincronização mais recente do catálogo, para exibir na tela. */
export async function getCatalogLastSync(
  actor: ActorContext,
): Promise<Date | null> {
  const key = cacheKey(actor.organizationId, "catalog", "last-sync");
  const cached = await cacheGet<string>(key);
  if (cached) return new Date(cached);

  const row = await prisma.product.findFirst({
    where: orgScope(actor, { lastSyncAt: { not: null } }),
    orderBy: { lastSyncAt: "desc" },
    select: { lastSyncAt: true },
  });

  if (row?.lastSyncAt) {
    await cacheSet(key, row.lastSyncAt.toISOString(), 60);
    return row.lastSyncAt;
  }
  return null;
}

import "server-only";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { logger } from "@/lib/logger";
import {
  createOmieContext,
  inventoryService,
  isOmieIntegrationError,
} from "@/integrations/omie";
import type { ActorContext } from "@/domain/permissions/authorize";
import { visibleStockFields } from "@/domain/permissions/authorize";
import { getCommercialSettings } from "@/server/settings";
import {
  calculateAvailability,
  consolidateAvailability,
  isStockStale,
  stockAgeSeconds,
  type StockComponents,
} from "./availability";

/**
 * Consulta de estoque para o vendedor.
 *
 * Dois caminhos, por motivos diferentes:
 *
 * - `getStockForDisplay` lê do cache local. Serve a navegação no catálogo, onde
 *   um dado de 30 segundos atrás é aceitável desde que a tela **diga** que é de
 *   30 segundos atrás.
 * - `refreshStockFromOmie` vai direto à Omie, sem cache. É o que deve rodar
 *   imediatamente antes de confirmar um pedido (briefing §7).
 *
 * Os campos físico e reservado só aparecem na resposta se o usuário tiver a
 * permissão correspondente — a remoção é na serialização, não na tela.
 */

export interface StockPositionView {
  readonly warehouseId: string;
  readonly warehouseName: string | null;
  readonly availableForSale: boolean;
  /** Já com a regra da organização e a margem de segurança aplicadas. */
  readonly available: string;
  readonly indeterminate: boolean;
  readonly minStock: string | null;
  readonly belowMinimum: boolean;
  /** Só com `products.view_physical_stock`. */
  readonly physical?: string | null;
  /** Só com `products.view_reserved_stock`. */
  readonly reserved?: string | null;
  readonly expectedOut?: string | null;
}

export interface ProductStockView {
  readonly productId: string;
  readonly totalAvailable: string;
  readonly hasIndeterminate: boolean;
  readonly positions: readonly StockPositionView[];
  readonly readAt: Date | null;
  readonly ageSeconds: number | null;
  /** `true` quando o dado passou do limite configurado — a UI deve avisar. */
  readonly stale: boolean;
  /** Qual regra produziu os números, para a tela poder explicar. */
  readonly rule: string;
}

export async function getStockForDisplay(
  actor: ActorContext,
  productId: string,
): Promise<ProductStockView | null> {
  const settings = await getCommercialSettings(actor.organizationId);
  const permissions = visibleStockFields(actor);

  const positions = await prisma.inventoryPosition.findMany({
    where: orgScope(actor, { productId }),
    select: {
      physical: true,
      reserved: true,
      expectedOut: true,
      expectedIn: true,
      omieAvailable: true,
      minStock: true,
      readAt: true,
      warehouse: {
        select: { id: true, name: true, availableForSale: true, active: true },
      },
    },
  });

  if (positions.length === 0) return null;

  const config = {
    rule: settings.availableStockRule,
    safetyMargin: settings.stockSafetyMargin,
  };

  const views: StockPositionView[] = positions.map((position) => {
    const components: StockComponents = {
      physical: position.physical?.toString() ?? null,
      reserved: position.reserved?.toString() ?? null,
      expectedOut: position.expectedOut?.toString() ?? null,
      expectedIn: position.expectedIn?.toString() ?? null,
      omieAvailable: position.omieAvailable?.toString() ?? null,
    };

    const availability = calculateAvailability(components, config);
    const minStock = position.minStock?.toString() ?? null;

    return {
      warehouseId: position.warehouse.id,
      warehouseName: position.warehouse.name,
      availableForSale:
        position.warehouse.availableForSale && position.warehouse.active,
      available: availability.displayed,
      indeterminate: availability.indeterminate,
      minStock,
      belowMinimum:
        minStock !== null &&
        !availability.indeterminate &&
        Number(availability.displayed) < Number(minStock),
      ...(permissions.physical ? { physical: components.physical } : {}),
      ...(permissions.reserved ? { reserved: components.reserved } : {}),
      ...(permissions.reserved ? { expectedOut: components.expectedOut } : {}),
    };
  });

  const consolidated = consolidateAvailability(
    positions.map((position) => ({
      components: {
        physical: position.physical?.toString() ?? null,
        reserved: position.reserved?.toString() ?? null,
        expectedOut: position.expectedOut?.toString() ?? null,
        expectedIn: position.expectedIn?.toString() ?? null,
        omieAvailable: position.omieAvailable?.toString() ?? null,
      },
      availableForSale:
        position.warehouse.availableForSale && position.warehouse.active,
    })),
    config,
  );

  // A leitura mais antiga define a idade do conjunto: dizer que o dado é
  // recente porque *um* depósito foi atualizado agora seria enganoso.
  const oldestRead = positions.reduce<Date | null>(
    (oldest, position) =>
      oldest === null || position.readAt < oldest ? position.readAt : oldest,
    null,
  );

  return {
    productId,
    totalAvailable: consolidated.total,
    hasIndeterminate: consolidated.hasIndeterminate,
    positions: views,
    readAt: oldestRead,
    ageSeconds: oldestRead ? stockAgeSeconds(oldestRead) : null,
    stale: oldestRead
      ? isStockStale(oldestRead, settings.stockStaleAfterSeconds)
      : true,
    rule: settings.availableStockRule,
  };
}

/**
 * Busca a posição atual direto na Omie e atualiza o cache local.
 *
 * Sem cache e com prioridade interativa: é a chamada que precede uma decisão de
 * venda, e nesse momento um dado velho custa mais que uma requisição a mais.
 */
export async function refreshStockFromOmie(
  organizationId: string,
  productOmieId: number,
  options: { readonly priority?: "interactive" | "background" } = {},
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const context = await createOmieContext({
      organizationId,
      priority: options.priority ?? "interactive",
    });

    const stock = await inventoryService.getProductStock(context, {
      omieId: productOmieId,
    });

    const product = await prisma.product.findUnique({
      where: { organizationId_omieId: { organizationId, omieId: productOmieId } },
      select: { id: true },
    });
    if (!product) {
      return { ok: false, error: "Produto não encontrado no cache local." };
    }

    for (const position of stock.positions) {
      if (position.warehouseOmieId === null) continue;

      const warehouse = await prisma.warehouse.upsert({
        where: {
          organizationId_omieId: {
            organizationId,
            omieId: position.warehouseOmieId,
          },
        },
        update: {
          ...(position.warehouseName ? { name: position.warehouseName } : {}),
          lastSyncAt: new Date(),
        },
        create: {
          organizationId,
          omieId: position.warehouseOmieId,
          name: position.warehouseName,
          lastSyncAt: new Date(),
        },
        select: { id: true },
      });

      await prisma.inventoryPosition.upsert({
        where: {
          productId_warehouseId: {
            productId: product.id,
            warehouseId: warehouse.id,
          },
        },
        update: {
          physical: position.physical,
          reserved: position.reserved,
          expectedOut: position.expectedOut,
          expectedIn: position.expectedIn,
          omieAvailable: position.omieAvailable,
          minStock: position.minStock,
          averageCost: position.averageCost,
          readAt: stock.readAt,
          syncStatus: "SYNCED",
        },
        create: {
          organizationId,
          productId: product.id,
          warehouseId: warehouse.id,
          physical: position.physical,
          reserved: position.reserved,
          expectedOut: position.expectedOut,
          expectedIn: position.expectedIn,
          omieAvailable: position.omieAvailable,
          minStock: position.minStock,
          averageCost: position.averageCost,
          readAt: stock.readAt,
          syncStatus: "SYNCED",
        },
      });
    }

    return { ok: true };
  } catch (error) {
    const message = isOmieIntegrationError(error)
      ? `${error.code}: ${error.omieDescription ?? error.message}`
      : "Falha inesperada ao consultar estoque";

    logger.error(
      { organizationId, productOmieId, err: message },
      "Atualização de estoque falhou",
    );
    return { ok: false, error: message };
  }
}

/** Sincroniza os locais de estoque (cadastro auxiliar, muda raramente). */
export async function syncWarehouses(
  organizationId: string,
): Promise<{ readonly synced: number; readonly failed: boolean }> {
  try {
    const context = await createOmieContext({
      organizationId,
      priority: "background",
    });

    const page = await inventoryService.listWarehouses(context, { page: 1 });

    for (const warehouse of page.items) {
      await prisma.warehouse.upsert({
        where: { organizationId_omieId: { organizationId, omieId: warehouse.omieId } },
        update: {
          code: warehouse.code,
          name: warehouse.name,
          isDefault: warehouse.isDefault,
          active: warehouse.active,
          availableForSale: warehouse.availableForSale,
          lastSyncAt: new Date(),
        },
        create: {
          organizationId,
          omieId: warehouse.omieId,
          code: warehouse.code,
          name: warehouse.name,
          isDefault: warehouse.isDefault,
          active: warehouse.active,
          availableForSale: warehouse.availableForSale,
          lastSyncAt: new Date(),
        },
      });
    }

    return { synced: page.items.length, failed: false };
  } catch (error) {
    logger.error(
      { organizationId, err: String(error) },
      "Sincronização de locais de estoque falhou",
    );
    return { synced: 0, failed: true };
  }
}

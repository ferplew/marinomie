import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { AvailableStockRule } from "@/domain/inventory/availability";
import type { PriceSource } from "@/domain/pricing/resolve-price";

/**
 * Configurações comerciais da organização.
 *
 * Centraliza a leitura para que nenhum caso de uso invente um default próprio —
 * duas telas com fórmulas de estoque diferentes seria pior que uma fórmula
 * errada, porque ninguém saberia qual número acreditar.
 */
export interface CommercialSettings {
  readonly availableStockRule: AvailableStockRule;
  readonly stockSafetyMargin: string;
  readonly priceTablePrecedence: readonly PriceSource[];
  readonly defaultQuoteStage: string;
  readonly defaultConfirmedStage: string;
  /** Idade a partir da qual o estoque é exibido como possivelmente desatualizado. */
  readonly stockStaleAfterSeconds: number;
}

const VALID_SOURCES: readonly PriceSource[] = [
  "customer",
  "seller",
  "organization",
  "product",
];

const FALLBACK_PRECEDENCE: readonly PriceSource[] = VALID_SOURCES;

function parsePrecedence(value: unknown): readonly PriceSource[] {
  if (!Array.isArray(value)) return FALLBACK_PRECEDENCE;

  const parsed = value.filter(
    (item): item is PriceSource =>
      typeof item === "string" && VALID_SOURCES.includes(item as PriceSource),
  );

  // Configuração corrompida não pode virar "sem precedência", o que deixaria
  // qualquer produto sem preço resolvido.
  return parsed.length > 0 ? parsed : FALLBACK_PRECEDENCE;
}

export const getCommercialSettings = cache(
  async (organizationId: string): Promise<CommercialSettings> => {
    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: {
        availableStockRule: true,
        stockSafetyMargin: true,
        priceTablePrecedence: true,
        defaultQuoteStage: true,
        defaultConfirmedStage: true,
        reconciliationIntervals: true,
      },
    });

    if (!settings) {
      // Organização sem linha de configuração usa os padrões documentados, em
      // vez de falhar: a ausência é um estado de instalação, não um erro.
      return {
        availableStockRule: "OMIE_CALCULATED",
        stockSafetyMargin: "0",
        priceTablePrecedence: FALLBACK_PRECEDENCE,
        defaultQuoteStage: "00",
        defaultConfirmedStage: "10",
        stockStaleAfterSeconds: 60,
      };
    }

    const intervals = settings.reconciliationIntervals as Record<string, unknown>;
    const inventoryInterval =
      typeof intervals?.["inventory"] === "number" ? intervals["inventory"] : 60;

    return {
      availableStockRule: settings.availableStockRule,
      stockSafetyMargin: settings.stockSafetyMargin.toString(),
      priceTablePrecedence: parsePrecedence(settings.priceTablePrecedence),
      defaultQuoteStage: settings.defaultQuoteStage,
      defaultConfirmedStage: settings.defaultConfirmedStage,
      stockStaleAfterSeconds: inventoryInterval,
    };
  },
);

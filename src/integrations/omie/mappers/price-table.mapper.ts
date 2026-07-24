import { omieFlagToBoolean } from "../schemas/common";
import type { OmiePriceTableItem } from "../schemas/price-table.schema";
import type { PriceTableItemDTO } from "../types/dto";
import { toDecimalString } from "./decimal";

export function mapPriceTableItem(
  input: OmiePriceTableItem,
): PriceTableItemDTO {
  return {
    productOmieId: input.nCodProd ?? null,
    productIntegrationCode: input.cCodIntProd ?? null,
    sku: input.cCodigoProduto ?? null,
    description: input.cDescricaoProduto ?? null,
    tablePrice: toDecimalString(input.nValorTabela),
    suggestedDiscountPercent: toDecimalString(input.nDescSugerido),
    maxDiscountPercent: toDecimalString(input.nDescMaximo),
    manuallyAdjusted: omieFlagToBoolean(input.cManual),
  };
}

/**
 * Teto de desconto efetivo para um item.
 *
 * Combina o limite da tabela de preço da Omie (`nDescMaximo`) com o limite do
 * vendedor (`SellerLink.maxDiscountPercent`): **prevalece o menor dos dois**
 * (docs/permissions.md §3). Quando a Omie não informa teto, vale só o limite do
 * vendedor — nunca o contrário de "sem teto".
 */
export function effectiveMaxDiscountPercent(
  omieMaxPercent: string | null,
  sellerMaxPercent: string,
): string {
  if (omieMaxPercent === null) return sellerMaxPercent;

  const omieValue = Number(omieMaxPercent);
  const sellerValue = Number(sellerMaxPercent);

  if (!Number.isFinite(omieValue)) return sellerMaxPercent;
  if (!Number.isFinite(sellerValue)) return omieMaxPercent;

  return omieValue <= sellerValue ? omieMaxPercent : sellerMaxPercent;
}

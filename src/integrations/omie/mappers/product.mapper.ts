import { omieFlagToBoolean } from "../schemas/common";
import type {
  OmieProduct,
  OmieProductSummary,
} from "../schemas/product.schema";
import type { ProductDTO, ProductSummaryDTO } from "../types/dto";
import { toDecimalString } from "./decimal";

/**
 * Omie → domínio, para produtos.
 *
 * Nota sobre `inativo`: a Omie modela o estado pela negativa ("S" = inativo).
 * Invertemos aqui para `active`, porque um booleano invertido espalhado pelo
 * domínio é fonte garantida de bug de lógica.
 */
export function mapProduct(input: OmieProduct): ProductDTO {
  return {
    omieId: input.codigo_produto,
    integrationCode: input.codigo_produto_integracao ?? null,
    sku: input.codigo ?? null,
    description: input.descricao ?? "",
    unit: input.unidade ?? null,
    ncm: input.ncm ?? null,
    ean: input.ean ?? null,
    basePrice: toDecimalString(input.valor_unitario),
    active: !omieFlagToBoolean(input.inativo),
    familyOmieId: input.codigo_familia ?? null,
    familyName: input.descricao_familia ?? null,
  };
}

export function mapProductSummary(
  input: OmieProductSummary,
): ProductSummaryDTO {
  return {
    omieId: input.codigo_produto,
    integrationCode: input.codigo_produto_integracao ?? null,
    sku: input.codigo ?? null,
    description: input.descricao ?? "",
    basePrice: toDecimalString(input.valor_unitario),
  };
}

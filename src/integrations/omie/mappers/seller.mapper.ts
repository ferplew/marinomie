import { omieFlagToBoolean } from "../schemas/common";
import type { OmieSeller } from "../schemas/seller.schema";
import type { SellerDTO } from "../types/dto";
import { toDecimalString } from "./decimal";

export function mapSeller(input: OmieSeller): SellerDTO {
  return {
    omieId: input.codigo,
    integrationCode: input.codInt ?? null,
    name: input.nome ?? null,
    email: input.email ?? null,
    active: !omieFlagToBoolean(input.inativo),
    canInvoiceOrder: omieFlagToBoolean(input.fatura_pedido),
    viewOnlyOrders: omieFlagToBoolean(input.visualiza_pedido),
    commissionPercent: toDecimalString(input.comissao),
  };
}

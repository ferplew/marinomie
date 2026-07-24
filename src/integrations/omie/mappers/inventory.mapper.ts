import { omieFlagToBoolean } from "../schemas/common";
import type {
  OmieStockByWarehouse,
  OmieStockPositionResponse,
  OmieStockSummaryResponse,
  OmieWarehouse,
} from "../schemas/inventory.schema";
import type {
  ProductStockDTO,
  StockPositionDTO,
  WarehouseDTO,
} from "../types/dto";
import { toDecimalString } from "./decimal";

/**
 * Omie → domínio, para estoque.
 *
 * Este mapper é o motivo pelo qual a camada existe: os dois serviços de estoque
 * da Omie usam nomes diferentes para os mesmos conceitos, e o domínio não deve
 * saber de qual deles o dado veio.
 *
 * O que **não** fazemos aqui: calcular estoque disponível. `nDisponivel` é
 * repassado como `omieAvailable`, e a decisão de usá-lo ou recalcular a partir
 * de físico/reservado/pendente pertence à regra configurável da organização
 * (`AvailableStockRule`). Um mapper que já entregasse "o disponível" tiraria
 * essa escolha do administrador.
 */
export function mapStockByWarehouse(
  input: OmieStockByWarehouse,
): StockPositionDTO {
  return {
    warehouseOmieId: input.nIdlocal ?? null,
    warehouseName: input.cDescricaoLocal ?? null,
    physical: toDecimalString(input.nFisico),
    reserved: toDecimalString(input.nReservado),
    expectedOut: toDecimalString(input.nPrevisaoSaida),
    expectedIn: toDecimalString(input.nPrevisaoEntrada),
    omieAvailable: toDecimalString(input.nDisponivel),
    minStock: toDecimalString(input.nEstoqueMinimo),
    averageCost: toDecimalString(input.nCMC),
  };
}

export function mapProductStock(
  input: OmieStockSummaryResponse,
  readAt: Date = new Date(),
): ProductStockDTO {
  return {
    productOmieId: input.nIdProduto,
    sku: input.cCodigo ?? null,
    description: input.cDescricao ?? null,
    unit: input.cUnidade ?? null,
    positions: input.listaEstoque.map(mapStockByWarehouse),
    readAt,
  };
}

/**
 * Normaliza a resposta do serviço `estoque/consulta` (PosicaoEstoque) para o
 * mesmo DTO.
 *
 * Duas diferenças importantes em relação a `estoque/resumo`:
 * - os nomes dos campos são outros (`fisico` em vez de `nFisico`, etc.);
 * - **não existe** disponível já calculado, então `omieAvailable` fica `null` —
 *   e `pendente` é mapeado para `expectedOut`, que é o campo do nosso DTO que
 *   representa saída prevista.
 */
export function mapStockPosition(
  input: OmieStockPositionResponse,
  options: { warehouseOmieId?: number | null } = {},
): StockPositionDTO {
  return {
    warehouseOmieId: options.warehouseOmieId ?? null,
    warehouseName: null,
    physical: toDecimalString(input.fisico),
    reserved: toDecimalString(input.reservado),
    expectedOut: toDecimalString(input.pendente),
    expectedIn: null,
    omieAvailable: null,
    minStock: toDecimalString(input.estoque_minimo),
    averageCost: toDecimalString(input.cmc),
  };
}

export function mapWarehouse(input: OmieWarehouse): WarehouseDTO {
  return {
    omieId: input.codigo_local_estoque,
    code: input.codigo ?? null,
    name: input.descricao ?? null,
    isDefault: omieFlagToBoolean(input.padrao),
    active: !omieFlagToBoolean(input.inativo),
    availableForSale: omieFlagToBoolean(input.dispVenda),
  };
}

import { omieListPriceTableItemsResponseSchema } from "../schemas/price-table.schema";
import { mapPriceTableItem } from "../mappers/price-table.mapper";
import type { PageResult } from "../client/paginate";
import { DEFAULT_PAGE_SIZE } from "../client/paginate";
import type { PriceTableItemDTO } from "../types/dto";
import { callBase, type OmieServiceContext } from "./service-context";

/**
 * Serviço de tabelas de preço — `produtos/tabelaprecos`.
 *
 * Apenas `ListarTabelaItens` é exposto: é a chamada que responde à pergunta que
 * o produto realmente faz ("qual o preço deste produto nesta tabela, e qual o
 * desconto máximo permitido").
 *
 * `ListarTabelasPreco` **não** é exposto porque o nome do array na resposta não
 * pôde ser confirmado na documentação consultada (docs/known-limitations.md).
 * Preferimos não oferecer o método a adivinhar o campo.
 */
const ENDPOINT = "produtos/tabelaprecos";

export async function listPriceTableItems(
  context: OmieServiceContext,
  params: {
    readonly page: number;
    readonly pageSize?: number;
    readonly priceTableOmieId?: number;
    readonly priceTableIntegrationCode?: string;
  },
): Promise<PageResult<PriceTableItemDTO>> {
  if (
    params.priceTableOmieId === undefined &&
    params.priceTableIntegrationCode === undefined
  ) {
    throw new Error(
      "Informe priceTableOmieId ou priceTableIntegrationCode para listar itens da tabela.",
    );
  }

  const param: Record<string, unknown> = {
    nPagina: params.page,
    nRegPorPagina: params.pageSize ?? DEFAULT_PAGE_SIZE,
  };
  if (params.priceTableOmieId !== undefined) {
    param["nCodTabPreco"] = params.priceTableOmieId;
  }
  if (params.priceTableIntegrationCode !== undefined) {
    param["cCodIntTabPreco"] = params.priceTableIntegrationCode;
  }

  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ListarTabelaItens",
    param,
    schema: omieListPriceTableItemsResponseSchema,
  });

  return {
    items: response.itensTabela.map(mapPriceTableItem),
    page: response.nPagina,
    totalPages: response.nTotPaginas,
    totalRecords: response.nTotRegistros,
  };
}

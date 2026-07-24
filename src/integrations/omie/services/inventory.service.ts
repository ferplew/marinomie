import {
  omieListWarehousesResponseSchema,
  omieStockSummaryResponseSchema,
} from "../schemas/inventory.schema";
import { mapProductStock, mapWarehouse } from "../mappers/inventory.mapper";
import type { PageResult } from "../client/paginate";
import { DEFAULT_PAGE_SIZE } from "../client/paginate";
import type { ProductStockDTO, WarehouseDTO } from "../types/dto";
import { callBase, type OmieServiceContext } from "./service-context";

/**
 * Serviço de estoque.
 *
 * A leitura por produto usa `estoque/resumo` → `ObterEstoqueProduto`, escolhido
 * como caminho principal por dois motivos: devolve a posição **por local** numa
 * única chamada e já traz `nDisponivel` calculado pela Omie — o que dá ao
 * administrador a opção de confiar no cálculo do ERP em vez do nosso.
 *
 * Ponto de produto importante: esta é a chamada que deve ser feita **sem cache**
 * imediatamente antes de confirmar um pedido (briefing §7). O cache de 15–60s
 * serve para navegação no catálogo, nunca para fechar venda.
 */
const SUMMARY_ENDPOINT = "estoque/resumo";
const WAREHOUSE_ENDPOINT = "estoque/local";

export async function getProductStock(
  context: OmieServiceContext,
  key: { omieId: number } | { sku: string } | { ean: string },
  options: { readonly day?: Date } = {},
): Promise<ProductStockDTO> {
  const param: Record<string, unknown> =
    "omieId" in key
      ? { nIdProduto: key.omieId }
      : "sku" in key
        ? { cCodigo: key.sku }
        : { cEAN: key.ean };

  if (options.day) {
    const day = options.day;
    const formatted = `${String(day.getDate()).padStart(2, "0")}/${String(
      day.getMonth() + 1,
    ).padStart(2, "0")}/${day.getFullYear()}`;
    param["dDia"] = formatted;
  }

  const response = await context.client.call({
    ...callBase(context),
    endpoint: SUMMARY_ENDPOINT,
    call: "ObterEstoqueProduto",
    param,
    schema: omieStockSummaryResponseSchema,
  });

  // `readAt` é gravado aqui, na fronteira, e não no consumidor: é o que permite
  // a UI mostrar honestamente "última atualização" e sinalizar dado velho.
  return mapProductStock(response, new Date());
}

export async function listWarehouses(
  context: OmieServiceContext,
  params: { readonly page: number; readonly pageSize?: number },
): Promise<PageResult<WarehouseDTO>> {
  const response = await context.client.call({
    ...callBase(context),
    endpoint: WAREHOUSE_ENDPOINT,
    call: "ListarLocaisEstoque",
    param: {
      nPagina: params.page,
      nRegPorPagina: params.pageSize ?? DEFAULT_PAGE_SIZE,
    },
    schema: omieListWarehousesResponseSchema,
  });

  return {
    items: response.locaisEncontrados.map(mapWarehouse),
    page: response.nPagina,
    totalPages: response.nTotPaginas,
    totalRecords: response.nTotRegistros,
  };
}

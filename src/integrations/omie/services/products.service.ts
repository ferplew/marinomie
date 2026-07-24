import {
  omieConsultProductResponseSchema,
  omieListProductsResponseSchema,
  omieListProductsSummaryResponseSchema,
} from "../schemas/product.schema";
import { formatOmieDate } from "../schemas/common";
import { mapProduct, mapProductSummary } from "../mappers/product.mapper";
import type { PageResult } from "../client/paginate";
import { DEFAULT_PAGE_SIZE } from "../client/paginate";
import type { ProductDTO, ProductSummaryDTO } from "../types/dto";
import { callBase, type OmieServiceContext } from "./service-context";

/**
 * Serviço de produtos — `geral/produtos` (ProdutoServico).
 *
 * Direção: Omie → App. A aplicação não cria nem altera produtos (briefing §12
 * descreve catálogo de leitura), então nenhum método de escrita é exposto aqui —
 * expor `IncluirProduto` sem necessidade só criaria superfície para erro.
 */
const ENDPOINT = "geral/produtos";

export interface ListProductsParams {
  readonly page: number;
  readonly pageSize?: number;
  /** Filtro incremental: apenas registros alterados a partir desta data. */
  readonly changedSince?: Date;
  readonly onlyChanged?: boolean;
  readonly description?: string;
  readonly family?: string;
}

function buildListParam(params: ListProductsParams): Record<string, unknown> {
  const param: Record<string, unknown> = {
    pagina: params.page,
    registros_por_pagina: params.pageSize ?? DEFAULT_PAGE_SIZE,
  };

  if (params.changedSince) {
    param["filtrar_por_data_de"] = formatOmieDate(params.changedSince);
  }
  if (params.onlyChanged) {
    param["filtrar_apenas_alteracao"] = "S";
  }
  if (params.description) {
    param["filtrar_apenas_descricao"] = params.description;
  }
  if (params.family) {
    param["filtrar_apenas_familia"] = params.family;
  }

  return param;
}

export async function listProducts(
  context: OmieServiceContext,
  params: ListProductsParams,
): Promise<PageResult<ProductDTO>> {
  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ListarProdutos",
    param: buildListParam(params),
    schema: omieListProductsResponseSchema,
  });

  return {
    items: response.produto_servico_cadastro.map(mapProduct),
    page: response.pagina,
    totalPages: response.total_de_paginas,
    totalRecords: response.total_de_registros,
  };
}

/**
 * Listagem resumida — bem mais leve. É a chamada indicada para alimentar a busca
 * do catálogo, onde só precisamos de código, descrição e preço.
 */
export async function listProductsSummary(
  context: OmieServiceContext,
  params: ListProductsParams,
): Promise<PageResult<ProductSummaryDTO>> {
  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ListarProdutosResumido",
    param: buildListParam(params),
    schema: omieListProductsSummaryResponseSchema,
  });

  return {
    items: response.produto_servico_resumido.map(mapProductSummary),
    page: response.pagina,
    totalPages: response.total_de_paginas,
    totalRecords: response.total_de_registros,
  };
}

export async function consultProduct(
  context: OmieServiceContext,
  key: { omieId: number } | { integrationCode: string } | { sku: string },
): Promise<ProductDTO> {
  const param: Record<string, unknown> =
    "omieId" in key
      ? { codigo_produto: key.omieId }
      : "integrationCode" in key
        ? { codigo_produto_integracao: key.integrationCode }
        : { codigo: key.sku };

  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ConsultarProduto",
    param,
    schema: omieConsultProductResponseSchema,
  });

  return mapProduct(response);
}

import {
  omieConsultSellerResponseSchema,
  omieListSellersResponseSchema,
} from "../schemas/seller.schema";
import { mapSeller } from "../mappers/seller.mapper";
import type { PageResult } from "../client/paginate";
import { DEFAULT_PAGE_SIZE } from "../client/paginate";
import type { SellerDTO } from "../types/dto";
import { callBase, type OmieServiceContext } from "./service-context";

/**
 * Serviço de vendedores — `geral/vendedores` (VendedoresCadastro).
 *
 * Somente leitura: a criação de vendedor continua sendo ato administrativo no
 * próprio Omie. O que a aplicação faz é **listar para vincular** a um usuário
 * local (`SellerLink`).
 */
const ENDPOINT = "geral/vendedores";

export async function listSellers(
  context: OmieServiceContext,
  params: {
    readonly page: number;
    readonly pageSize?: number;
    readonly nameFilter?: string;
  },
): Promise<PageResult<SellerDTO>> {
  const param: Record<string, unknown> = {
    pagina: params.page,
    registros_por_pagina: params.pageSize ?? DEFAULT_PAGE_SIZE,
  };
  if (params.nameFilter) {
    param["filtrar_por_nome"] = params.nameFilter;
  }

  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ListarVendedores",
    param,
    schema: omieListSellersResponseSchema,
  });

  return {
    // O array desta resposta se chama `cadastro`.
    items: response.cadastro.map(mapSeller),
    page: response.pagina,
    totalPages: response.total_de_paginas,
    totalRecords: response.total_de_registros,
  };
}

export async function consultSeller(
  context: OmieServiceContext,
  key: { omieId: number } | { integrationCode: string },
): Promise<SellerDTO> {
  const param: Record<string, unknown> =
    "omieId" in key ? { codigo: key.omieId } : { codInt: key.integrationCode };

  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ConsultarVendedor",
    param,
    schema: omieConsultSellerResponseSchema,
  });

  return mapSeller(response);
}

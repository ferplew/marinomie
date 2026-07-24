import { z } from "zod";

/**
 * Schemas de estoque.
 *
 * Existem **dois serviços de leitura com nomenclaturas diferentes** para os
 * mesmos conceitos (docs/omie-api-mapping.md §4). Ambos estão declarados aqui e
 * são normalizados para o mesmo DTO pelo mapper — é exatamente por isso que os
 * mappers existem.
 */

// ---------------------------------------------------------------------------
// estoque/resumo → ObterEstoqueProduto
// ---------------------------------------------------------------------------

/** Item de `listaEstoque`: posição por local de estoque. */
export const omieStockByWarehouseSchema = z.looseObject({
  nIdlocal: z.number().int().optional(),
  cDescricaoLocal: z.string().optional(),
  nFisico: z.number().optional(),
  nReservado: z.number().optional(),
  nPrevisaoSaida: z.number().optional(),
  nPrevisaoEntrada: z.number().optional(),
  /** A Omie já devolve o disponível calculado — ver AvailableStockRule. */
  nDisponivel: z.number().optional(),
  nCMC: z.number().optional(),
  nPrecoUnitario: z.number().optional(),
  nEstoqueMinimo: z.number().optional(),
});

export const omieStockSummaryResponseSchema = z.looseObject({
  nIdProduto: z.number().int(),
  cCodigo: z.string().optional(),
  cDescricao: z.string().optional(),
  cEAN: z.string().optional(),
  cUnidade: z.string().optional(),
  cNCM: z.string().optional(),
  dDia: z.string().optional(),
  listaEstoque: z.array(omieStockByWarehouseSchema).optional().default([]),
});

// ---------------------------------------------------------------------------
// estoque/consulta → PosicaoEstoque
// ---------------------------------------------------------------------------

/**
 * Nomenclatura diferente do serviço acima para os mesmos conceitos:
 * `fisico`/`reservado`/`pendente`/`saldo` em vez de `nFisico`/`nReservado`/...
 * e **sem** um campo de disponível já calculado.
 */
export const omieStockPositionResponseSchema = z.looseObject({
  saldo: z.number().optional(),
  fisico: z.number().optional(),
  reservado: z.number().optional(),
  pendente: z.number().optional(),
  estoque_minimo: z.number().optional(),
  cmc: z.number().optional(),
});

// ---------------------------------------------------------------------------
// estoque/local → ListarLocaisEstoque
// ---------------------------------------------------------------------------

export const omieWarehouseSchema = z.looseObject({
  codigo_local_estoque: z.number().int(),
  codigo: z.string().optional(),
  descricao: z.string().optional(),
  padrao: z.string().optional(),
  inativo: z.string().optional(),
  dispVenda: z.string().optional(),
});

export const omieListWarehousesResponseSchema = z.looseObject({
  nPagina: z.number().int(),
  nTotPaginas: z.number().int(),
  nRegistros: z.number().int(),
  nTotRegistros: z.number().int(),
  locaisEncontrados: z.array(omieWarehouseSchema).optional().default([]),
});

export type OmieStockSummaryResponse = z.infer<
  typeof omieStockSummaryResponseSchema
>;
export type OmieStockByWarehouse = z.infer<typeof omieStockByWarehouseSchema>;
export type OmieStockPositionResponse = z.infer<
  typeof omieStockPositionResponseSchema
>;
export type OmieWarehouse = z.infer<typeof omieWarehouseSchema>;

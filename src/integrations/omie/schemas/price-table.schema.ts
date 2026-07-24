import { z } from "zod";
import { hungarianPaginationSchema } from "./common";

/**
 * Schemas de tabelas de preço — serviço `produtos/tabelaprecos`.
 *
 * Este serviço usa a paginação em notação húngara (`nPagina`/`nRegPorPagina`),
 * diferente de produtos e clientes.
 *
 * `nDescMaximo` é relevante para o módulo de descontos: é um teto vindo da Omie
 * que se combina com o `maxDiscountPercent` do vendedor — prevalece o menor dos
 * dois (docs/permissions.md §3).
 */
export const omiePriceTableItemSchema = z.looseObject({
  nCodProd: z.number().int().optional(),
  cCodIntProd: z.string().optional(),
  cCodigoProduto: z.string().optional(),
  cDescricaoProduto: z.string().optional(),
  nValorTabela: z.number().optional(),
  nValorOriginal: z.number().optional(),
  nValorCalculado: z.number().optional(),
  nPercDesconto: z.number().optional(),
  nPercAcrescimo: z.number().optional(),
  cManual: z.string().optional(),
  cTemDesconto: z.string().optional(),
  nDescSugerido: z.number().optional(),
  nDescMaximo: z.number().optional(),
});

/** Resposta de `ListarTabelaItens`. */
export const omieListPriceTableItemsResponseSchema =
  hungarianPaginationSchema.extend({
    itensTabela: z.array(omiePriceTableItemSchema).optional().default([]),
  });

export const omiePriceTableSchema = z.looseObject({
  nCodTabPreco: z.number().int().optional(),
  cCodIntTabPreco: z.string().optional(),
  cNome: z.string().optional(),
  cCodigo: z.string().optional(),
  cAtiva: z.string().optional(),
});

/**
 * Resposta de `ListarTabelasPreco`.
 *
 * O nome do array desta resposta **não foi confirmado** na documentação
 * consultada — por isso ele é opcional aqui e o service correspondente ainda não
 * é exposto. Ver docs/known-limitations.md. Não vamos adivinhar o nome.
 */
export const omieListPriceTablesResponseSchema = hungarianPaginationSchema
  .extend({
    tabelasPreco: z.array(omiePriceTableSchema).optional(),
  })
  .loose();

export type OmiePriceTableItem = z.infer<typeof omiePriceTableItemSchema>;

import { z } from "zod";
import { snakeCasePaginationSchema } from "./common";

/**
 * Schemas de produtos — serviço `geral/produtos` (ProdutoServico).
 *
 * Campos confirmados na documentação oficial do serviço. Os objetos são
 * `looseObject` porque o cadastro completo tem 60+ campos (fiscais, dimensões,
 * variações) que não usamos hoje e não queremos declarar sem necessidade.
 */

/** Item de `produto_servico_resumido` (ListarProdutosResumido). */
export const omieProductSummarySchema = z.looseObject({
  codigo_produto: z.number().int(),
  codigo_produto_integracao: z.string().optional(),
  codigo: z.string().optional(),
  descricao: z.string().optional(),
  valor_unitario: z.number().optional(),
});

/** Item de `produto_servico_cadastro` (ListarProdutos / ConsultarProduto). */
export const omieProductSchema = z.looseObject({
  codigo_produto: z.number().int(),
  codigo_produto_integracao: z.string().optional(),
  codigo: z.string().optional(),
  descricao: z.string().optional(),
  unidade: z.string().optional(),
  valor_unitario: z.number().optional(),
  ncm: z.string().optional(),
  ean: z.string().optional(),
  inativo: z.string().optional(),
  codigo_familia: z.number().int().optional(),
  descricao_familia: z.string().optional(),
});

/** Resposta de `ListarProdutos` (container `produto_servico_listfull_response`). */
export const omieListProductsResponseSchema = snakeCasePaginationSchema.extend({
  // Ausente quando a página não tem registros.
  produto_servico_cadastro: z.array(omieProductSchema).optional().default([]),
});

/** Resposta de `ListarProdutosResumido` (`produto_servico_list_response`). */
export const omieListProductsSummaryResponseSchema =
  snakeCasePaginationSchema.extend({
    produto_servico_resumido: z
      .array(omieProductSummarySchema)
      .optional()
      .default([]),
  });

/** Resposta de `ConsultarProduto`: o próprio objeto de cadastro. */
export const omieConsultProductResponseSchema = omieProductSchema;

export type OmieProduct = z.infer<typeof omieProductSchema>;
export type OmieProductSummary = z.infer<typeof omieProductSummarySchema>;
export type OmieListProductsResponse = z.infer<
  typeof omieListProductsResponseSchema
>;

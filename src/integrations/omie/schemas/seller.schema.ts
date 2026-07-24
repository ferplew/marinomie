import { z } from "zod";
import { snakeCasePaginationSchema } from "./common";

/**
 * Schemas de vendedores — serviço `geral/vendedores` (VendedoresCadastro).
 *
 * Confirmado por ausência: **não existe** campo de tabela de preço padrão nem de
 * limite de desconto. Esses atributos vivem apenas em `SellerLink`, no nosso
 * banco (docs/omie-api-mapping.md §6).
 */
export const omieSellerSchema = z.looseObject({
  codigo: z.number().int(),
  codInt: z.string().optional(),
  nome: z.string().optional(),
  email: z.string().optional(),
  inativo: z.string().optional(),
  fatura_pedido: z.string().optional(),
  visualiza_pedido: z.string().optional(),
  comissao: z.number().optional(),
});

/** Resposta de `ListarVendedores` — o array se chama `cadastro`. */
export const omieListSellersResponseSchema = snakeCasePaginationSchema.extend({
  cadastro: z.array(omieSellerSchema).optional().default([]),
});

export const omieConsultSellerResponseSchema = omieSellerSchema;

export type OmieSeller = z.infer<typeof omieSellerSchema>;

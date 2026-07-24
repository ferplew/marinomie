import { z } from "zod";
import { snakeCasePaginationSchema } from "./common";

/**
 * Schemas de clientes — serviço `geral/clientes` (ClientesCadastro).
 *
 * Atenção a uma inconsistência real da API, confirmada na documentação: a
 * listagem completa devolve `codigo_cliente_omie`, enquanto a listagem resumida
 * devolve `codigo_cliente`. Os dois schemas refletem isso, e o mapper normaliza.
 */

export const omieCustomerSchema = z.looseObject({
  codigo_cliente_omie: z.number().int(),
  codigo_cliente_integracao: z.string().optional(),
  razao_social: z.string().optional(),
  nome_fantasia: z.string().optional(),
  cnpj_cpf: z.string().optional(),
  email: z.string().optional(),
  telefone1_ddd: z.string().optional(),
  telefone1_numero: z.string().optional(),
  endereco: z.string().optional(),
  endereco_numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  inativo: z.string().optional(),
});

export const omieCustomerSummarySchema = z.looseObject({
  // Nome diferente do schema completo — não é erro de digitação.
  codigo_cliente: z.number().int(),
  codigo_cliente_integracao: z.string().optional(),
  razao_social: z.string().optional(),
  nome_fantasia: z.string().optional(),
  cnpj_cpf: z.string().optional(),
});

/** Resposta de `ListarClientes` (`clientes_listfull_response`). */
export const omieListCustomersResponseSchema = snakeCasePaginationSchema.extend({
  clientes_cadastro: z.array(omieCustomerSchema).optional().default([]),
});

/** Resposta de `ListarClientesResumido` (`clientes_list_response`). */
export const omieListCustomersSummaryResponseSchema =
  snakeCasePaginationSchema.extend({
    clientes_cadastro_resumido: z
      .array(omieCustomerSummarySchema)
      .optional()
      .default([]),
  });

/** Resposta de `ConsultarCliente`: o próprio cadastro. */
export const omieConsultCustomerResponseSchema = omieCustomerSchema;

/**
 * Resposta de `IncluirCliente`/`AlterarCliente`/`UpsertCliente`
 * (`clientes_status`). O client já rejeita `codigo_status` de erro antes daqui.
 */
export const omieCustomerWriteResponseSchema = z.looseObject({
  codigo_cliente_omie: z.number().int(),
  codigo_cliente_integracao: z.string().optional(),
  codigo_status: z.string().optional(),
  descricao_status: z.string().optional(),
});

export type OmieCustomer = z.infer<typeof omieCustomerSchema>;
export type OmieCustomerSummary = z.infer<typeof omieCustomerSummarySchema>;
export type OmieCustomerWriteResponse = z.infer<
  typeof omieCustomerWriteResponseSchema
>;

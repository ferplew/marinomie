import { z } from "zod";

/**
 * Schemas de pedido de venda — `produtos/pedido` (PedidoVendaProduto).
 *
 * Estrutura confirmada na documentação oficial do serviço. Dois detalhes que
 * seriam fáceis de errar por suposição e por isso ficam explícitos aqui:
 *
 * 1. Cada item de `det` exige `ide.codigo_item_integracao` — é obrigatório, não
 *    opcional, e vive num objeto `ide` separado do `produto`.
 * 2. A resposta traz **dois** identificadores: `codigo_pedido` (integer, o id
 *    interno usado por `ConsultarPedido`/`TrocarEtapaPedido`) e `numero_pedido`
 *    (string, o número visível no ERP). Não são a mesma coisa.
 */

export const omieOrderWriteResponseSchema = z.looseObject({
  codigo_pedido: z.number().int(),
  codigo_pedido_integracao: z.string().optional(),
  numero_pedido: z.string().optional(),
  codigo_status: z.string().optional(),
  descricao_status: z.string().optional(),
});

/** `cabecalho` da resposta de `ConsultarPedido`. */
const omieOrderHeaderSchema = z.looseObject({
  codigo_cliente: z.number().int().optional(),
  codigo_pedido: z.number().int().optional(),
  codigo_pedido_integracao: z.string().optional(),
  numero_pedido: z.string().optional(),
  etapa: z.string().optional(),
  codigo_parcela: z.string().optional(),
  data_previsao: z.string().optional(),
});

const omieOrderTotalSchema = z.looseObject({
  valor_mercadorias: z.number().optional(),
  valor_total_pedido: z.number().optional(),
  valor_descontos: z.number().optional(),
});

export const omieConsultOrderResponseSchema = z.looseObject({
  cabecalho: omieOrderHeaderSchema.optional(),
  total_pedido: omieOrderTotalSchema.optional(),
  infoCadastro: z
    .looseObject({
      dInc: z.string().optional(),
      dAlt: z.string().optional(),
      cancelado: z.string().optional(),
      faturado: z.string().optional(),
    })
    .optional(),
});

/** Resposta de `TrocarEtapaPedido`. */
export const omieChangeStageResponseSchema = z.looseObject({
  codigo_status: z.string().optional(),
  descricao_status: z.string().optional(),
});

export type OmieOrderWriteResponse = z.infer<typeof omieOrderWriteResponseSchema>;
export type OmieConsultOrderResponse = z.infer<
  typeof omieConsultOrderResponseSchema
>;

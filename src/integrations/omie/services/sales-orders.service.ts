import {
  omieChangeStageResponseSchema,
  omieConsultOrderResponseSchema,
  omieOrderWriteResponseSchema,
} from "../schemas/order.schema";
import { callBase, type OmieServiceContext } from "./service-context";

/**
 * Serviço de pedido de venda — `produtos/pedido` (PedidoVendaProduto).
 *
 * Orçamento e pedido são o **mesmo recurso**, diferenciados pelo campo `etapa`
 * (`"00"` = orçamento). Por isso não existe `createQuote` e `createOrder`
 * separados: existe `createSalesDocument`, que recebe a etapa.
 *
 * `ListarPedidos` **não é exposto**: o nome do array na resposta não pôde ser
 * confirmado na documentação. Mesma disciplina aplicada a `ListarTabelasPreco`
 * — preferimos não oferecer o método a adivinhar o campo.
 */
const ENDPOINT = "produtos/pedido";

export interface SalesDocumentItemInput {
  readonly productOmieId: number;
  /** `codigo_item_integracao` — obrigatório pela Omie em cada item. */
  readonly itemIntegrationCode: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discountValue?: string;
  readonly description?: string;
  readonly unit?: string;
}

export interface CreateSalesDocumentInput {
  /** `codigo_pedido_integracao` — chave de idempotência. Nunca regenerar. */
  readonly integrationCode: string;
  readonly customerOmieId: number;
  /** "00" para orçamento; demais valores para pedido. */
  readonly stage: string;
  readonly paymentTermCode: string;
  /** Formato "dd/mm/aaaa". */
  readonly expectedDate: string;
  /** Vendedor resolvido no servidor, nunca vindo do navegador. */
  readonly sellerOmieId: number;
  readonly items: readonly SalesDocumentItemInput[];
  readonly notes?: string;
}

export interface SalesDocumentWriteResult {
  /** `codigo_pedido` — id interno, usado nas consultas e troca de etapa. */
  readonly omieId: number;
  /** `numero_pedido` — número visível no ERP. */
  readonly omieNumber: string | null;
  readonly integrationCode: string | null;
}

function buildPayload(input: CreateSalesDocumentInput): Record<string, unknown> {
  return {
    cabecalho: {
      codigo_cliente: input.customerOmieId,
      codigo_pedido_integracao: input.integrationCode,
      data_previsao: input.expectedDate,
      etapa: input.stage,
      codigo_parcela: input.paymentTermCode,
    },
    // `informacoes_adicionais` é obrigatório, e é onde vive o vendedor.
    informacoes_adicionais: {
      codVend: input.sellerOmieId,
    },
    det: input.items.map((item) => ({
      ide: {
        codigo_item_integracao: item.itemIntegrationCode,
      },
      produto: {
        codigo_produto: item.productOmieId,
        quantidade: Number(item.quantity),
        valor_unitario: Number(item.unitPrice),
        ...(item.discountValue !== undefined
          ? { valor_desconto: Number(item.discountValue) }
          : {}),
        ...(item.description ? { descricao: item.description } : {}),
        ...(item.unit ? { unidade: item.unit } : {}),
      },
    })),
    ...(input.notes
      ? { observacoes: { obs_venda: input.notes } }
      : {}),
  };
}

/**
 * Cria orçamento ou pedido, conforme a etapa informada.
 *
 * O client não repete esta chamada automaticamente: falha de resultado incerto
 * sai como `UNCERTAIN_RESULT` e exige `consultSalesDocument` pelo código de
 * integração antes de qualquer reenvio.
 */
export async function createSalesDocument(
  context: OmieServiceContext,
  input: CreateSalesDocumentInput,
): Promise<SalesDocumentWriteResult> {
  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "IncluirPedido",
    param: buildPayload(input),
    schema: omieOrderWriteResponseSchema,
    isWrite: true,
  });

  return {
    omieId: response.codigo_pedido,
    omieNumber: response.numero_pedido ?? null,
    integrationCode: response.codigo_pedido_integracao ?? null,
  };
}

export interface ConsultedSalesDocument {
  readonly omieId: number | null;
  readonly omieNumber: string | null;
  readonly integrationCode: string | null;
  readonly stage: string | null;
  readonly total: number | null;
  readonly cancelled: boolean;
  readonly invoiced: boolean;
}

/**
 * Consulta por qualquer um dos três identificadores.
 *
 * A consulta por `integrationCode` é a peça central da recuperação após timeout:
 * é como descobrimos se uma escrita de resultado incerto chegou a ser aplicada,
 * antes de decidir reenviar (docs/synchronization-strategy.md §6).
 */
export async function consultSalesDocument(
  context: OmieServiceContext,
  key:
    | { readonly omieId: number }
    | { readonly integrationCode: string }
    | { readonly omieNumber: string },
): Promise<ConsultedSalesDocument> {
  const param: Record<string, unknown> =
    "omieId" in key
      ? { codigo_pedido: key.omieId }
      : "integrationCode" in key
        ? { codigo_pedido_integracao: key.integrationCode }
        : { numero_pedido: key.omieNumber };

  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ConsultarPedido",
    param,
    schema: omieConsultOrderResponseSchema,
  });

  const header = response.cabecalho;

  return {
    omieId: header?.codigo_pedido ?? null,
    omieNumber: header?.numero_pedido ?? null,
    integrationCode: header?.codigo_pedido_integracao ?? null,
    stage: header?.etapa ?? null,
    total: response.total_pedido?.valor_total_pedido ?? null,
    cancelled: response.infoCadastro?.cancelado === "S",
    invoiced: response.infoCadastro?.faturado === "S",
  };
}

/**
 * Move o registro de etapa — é assim que um orçamento vira pedido.
 *
 * Regra de negócio da própria Omie, confirmada na documentação de ajuda: um
 * pedido não faturado só pode ir para etapas anteriores ao faturamento; um
 * faturado e depois cancelado, só para etapas posteriores. Não replicamos essa
 * validação aqui — deixamos a Omie recusar e tratamos o erro, em vez de manter
 * uma cópia da regra que pode divergir.
 */
export async function changeSalesDocumentStage(
  context: OmieServiceContext,
  key: { readonly omieId: number } | { readonly integrationCode: string },
  stage: string,
): Promise<void> {
  const param: Record<string, unknown> = {
    ...("omieId" in key
      ? { codigo_pedido: key.omieId }
      : { codigo_pedido_integracao: key.integrationCode }),
    etapa: stage,
  };

  await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "TrocarEtapaPedido",
    param,
    schema: omieChangeStageResponseSchema,
    isWrite: true,
  });
}

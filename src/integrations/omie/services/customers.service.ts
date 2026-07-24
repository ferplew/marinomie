import {
  omieConsultCustomerResponseSchema,
  omieCustomerWriteResponseSchema,
  omieListCustomersResponseSchema,
  omieListCustomersSummaryResponseSchema,
} from "../schemas/customer.schema";
import { formatOmieDate } from "../schemas/common";
import { mapCustomer, mapCustomerSummary } from "../mappers/customer.mapper";
import type { PageResult } from "../client/paginate";
import { DEFAULT_PAGE_SIZE } from "../client/paginate";
import type { CustomerDTO, CustomerSummaryDTO } from "../types/dto";
import { callBase, type OmieServiceContext } from "./service-context";

/**
 * Serviço de clientes — `geral/clientes` (ClientesCadastro).
 *
 * Direção: bidirecional. É o primeiro serviço de **escrita**, e por isso carrega
 * as regras de idempotência:
 *
 * - `integrationCode` é obrigatório na criação e deve ser gerado uma única vez
 *   por cliente local, nunca por tentativa. O tipo exige o campo justamente
 *   para que esquecer disso seja erro de compilação, não bug de produção.
 * - `UpsertClienteCpfCnpj` é o caminho preferido: idempotente por documento,
 *   cobrindo o caso em que o cliente já existe no Omie cadastrado por outra
 *   via (docs/omie-api-mapping.md §5).
 * - Os métodos em lote da Omie estão **depreciados** e não são expostos.
 */
const ENDPOINT = "geral/clientes";

export interface ListCustomersParams {
  readonly page: number;
  readonly pageSize?: number;
  readonly changedSince?: Date;
  readonly onlyChanged?: boolean;
}

function buildListParam(params: ListCustomersParams): Record<string, unknown> {
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
  return param;
}

export async function listCustomers(
  context: OmieServiceContext,
  params: ListCustomersParams,
): Promise<PageResult<CustomerDTO>> {
  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ListarClientes",
    param: buildListParam(params),
    schema: omieListCustomersResponseSchema,
  });

  return {
    items: response.clientes_cadastro.map(mapCustomer),
    page: response.pagina,
    totalPages: response.total_de_paginas,
    totalRecords: response.total_de_registros,
  };
}

export async function listCustomersSummary(
  context: OmieServiceContext,
  params: ListCustomersParams,
): Promise<PageResult<CustomerSummaryDTO>> {
  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ListarClientesResumido",
    param: buildListParam(params),
    schema: omieListCustomersSummaryResponseSchema,
  });

  return {
    items: response.clientes_cadastro_resumido.map(mapCustomerSummary),
    page: response.pagina,
    totalPages: response.total_de_paginas,
    totalRecords: response.total_de_registros,
  };
}

export async function consultCustomer(
  context: OmieServiceContext,
  key: { omieId: number } | { integrationCode: string },
): Promise<CustomerDTO> {
  const param: Record<string, unknown> =
    "omieId" in key
      ? { codigo_cliente_omie: key.omieId }
      : { codigo_cliente_integracao: key.integrationCode };

  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "ConsultarCliente",
    param,
    schema: omieConsultCustomerResponseSchema,
  });

  return mapCustomer(response);
}

export interface CreateCustomerInput {
  /**
   * Código de integração — chave de idempotência. Obrigatório de propósito:
   * criar sem ele impediria a consulta "já foi criado?" depois de um timeout.
   */
  readonly integrationCode: string;
  readonly legalName: string;
  readonly document: string;
  readonly tradeName: string;
  readonly email: string;
  readonly phone?: { readonly areaCode: string; readonly number: string };
  readonly address?: {
    readonly street: string;
    readonly number: string;
    readonly complement?: string;
    readonly district: string;
    readonly city: string;
    readonly state: string;
    readonly zipCode: string;
  };
}

export interface CustomerWriteResult {
  readonly omieId: number;
  readonly integrationCode: string | null;
}

function buildCustomerParam(input: CreateCustomerInput): Record<string, unknown> {
  const param: Record<string, unknown> = {
    codigo_cliente_integracao: input.integrationCode,
    razao_social: input.legalName,
    cnpj_cpf: input.document,
    nome_fantasia: input.tradeName,
    email: input.email,
  };

  if (input.phone) {
    param["telefone1_ddd"] = input.phone.areaCode;
    param["telefone1_numero"] = input.phone.number;
  }

  if (input.address) {
    param["endereco"] = input.address.street;
    param["endereco_numero"] = input.address.number;
    param["bairro"] = input.address.district;
    param["cidade"] = input.address.city;
    param["estado"] = input.address.state;
    param["cep"] = input.address.zipCode;
    if (input.address.complement) {
      param["complemento"] = input.address.complement;
    }
  }

  return param;
}

/**
 * Cria ou atualiza o cliente por CPF/CNPJ.
 *
 * `UpsertClienteCpfCnpj` em vez de `IncluirCliente`: se o documento já existir no
 * Omie, atualiza em vez de falhar com duplicidade. Isso importa porque o cliente
 * pode ter sido cadastrado direto no ERP antes de o vendedor tentar cadastrá-lo
 * pelo app — e nesse caso o resultado correto é vincular, não erro na tela.
 */
export async function upsertCustomerByDocument(
  context: OmieServiceContext,
  input: CreateCustomerInput,
): Promise<CustomerWriteResult> {
  const response = await context.client.call({
    ...callBase(context),
    endpoint: ENDPOINT,
    call: "UpsertClienteCpfCnpj",
    param: buildCustomerParam(input),
    schema: omieCustomerWriteResponseSchema,
    isWrite: true,
  });

  return {
    omieId: response.codigo_cliente_omie,
    integrationCode: response.codigo_cliente_integracao ?? null,
  };
}

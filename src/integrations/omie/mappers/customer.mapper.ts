import { omieFlagToBoolean } from "../schemas/common";
import type {
  OmieCustomer,
  OmieCustomerSummary,
} from "../schemas/customer.schema";
import type {
  CustomerAddressDTO,
  CustomerDTO,
  CustomerSummaryDTO,
} from "../types/dto";

/**
 * Omie → domínio, para clientes.
 *
 * Normaliza duas coisas que a Omie deixa inconsistentes:
 * - o identificador (`codigo_cliente_omie` na listagem completa vs.
 *   `codigo_cliente` na resumida);
 * - documento e CEP, que chegam com pontuação variável e são normalizados para
 *   apenas dígitos — é assim que ficam no nosso banco, e é o que permite a
 *   constraint única por documento funcionar de verdade.
 */
export function normalizeDocument(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function normalizeZipCode(value: string | null | undefined): string | null {
  return normalizeDocument(value);
}

function normalizePhone(
  areaCode: string | null | undefined,
  number: string | null | undefined,
): string | null {
  const digits = `${areaCode ?? ""}${number ?? ""}`.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function mapAddress(input: OmieCustomer): CustomerAddressDTO | null {
  const hasAddress =
    input.endereco || input.cidade || input.estado || input.cep;
  if (!hasAddress) return null;

  return {
    street: input.endereco ?? null,
    number: input.endereco_numero ?? null,
    complement: input.complemento ?? null,
    district: input.bairro ?? null,
    city: input.cidade ?? null,
    state: input.estado ?? null,
    zipCode: normalizeZipCode(input.cep),
  };
}

export function mapCustomer(input: OmieCustomer): CustomerDTO {
  return {
    omieId: input.codigo_cliente_omie,
    integrationCode: input.codigo_cliente_integracao ?? null,
    document: normalizeDocument(input.cnpj_cpf),
    legalName: input.razao_social ?? null,
    tradeName: input.nome_fantasia ?? null,
    email: input.email ?? null,
    phone: normalizePhone(input.telefone1_ddd, input.telefone1_numero),
    active: !omieFlagToBoolean(input.inativo),
    address: mapAddress(input),
  };
}

export function mapCustomerSummary(
  input: OmieCustomerSummary,
): CustomerSummaryDTO {
  return {
    // Aqui o campo se chama `codigo_cliente`, não `codigo_cliente_omie`.
    omieId: input.codigo_cliente,
    integrationCode: input.codigo_cliente_integracao ?? null,
    document: normalizeDocument(input.cnpj_cpf),
    legalName: input.razao_social ?? null,
    tradeName: input.nome_fantasia ?? null,
  };
}

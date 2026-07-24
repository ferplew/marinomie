/**
 * Validação e normalização de CPF/CNPJ (briefing §13).
 *
 * Implementa os algoritmos reais de dígito verificador. Validar só o tamanho
 * deixaria passar "11111111111", que é o tipo de dado que só falha lá na frente,
 * na hora de emitir a nota — quando o pedido já foi feito.
 */

export type DocumentType = "CPF" | "CNPJ";

export interface DocumentValidation {
  readonly valid: boolean;
  readonly type: DocumentType | null;
  /** Somente dígitos. É a forma que vai para o banco e para a constraint única. */
  readonly normalized: string;
  readonly reason?: string;
}

export function normalizeDocument(input: string): string {
  return input.replace(/\D/g, "");
}

/** Sequências como 000.000.000-00 passam no cálculo do dígito, mas não existem. */
function allSameDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

function cpfCheckDigit(digits: string, length: number): number {
  let sum = 0;
  let weight = length + 1;

  for (let i = 0; i < length; i += 1) {
    sum += Number(digits[i]) * weight;
    weight -= 1;
  }

  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidCPF(input: string): boolean {
  const digits = normalizeDocument(input);
  if (digits.length !== 11 || allSameDigits(digits)) return false;

  return (
    cpfCheckDigit(digits, 9) === Number(digits[9]) &&
    cpfCheckDigit(digits, 10) === Number(digits[10])
  );
}

function cnpjCheckDigit(digits: string, length: number): number {
  // Pesos oficiais: 5..2 seguidos de 9..2.
  const weights =
    length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += Number(digits[i]) * (weights[i] ?? 0);
  }

  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCNPJ(input: string): boolean {
  const digits = normalizeDocument(input);
  if (digits.length !== 14 || allSameDigits(digits)) return false;

  return (
    cnpjCheckDigit(digits, 12) === Number(digits[12]) &&
    cnpjCheckDigit(digits, 13) === Number(digits[13])
  );
}

export function validateDocument(input: string): DocumentValidation {
  const normalized = normalizeDocument(input);

  if (normalized.length === 0) {
    return { valid: false, type: null, normalized, reason: "Informe o CPF ou CNPJ." };
  }

  if (normalized.length === 11) {
    return isValidCPF(normalized)
      ? { valid: true, type: "CPF", normalized }
      : { valid: false, type: "CPF", normalized, reason: "CPF inválido." };
  }

  if (normalized.length === 14) {
    return isValidCNPJ(normalized)
      ? { valid: true, type: "CNPJ", normalized }
      : { valid: false, type: "CNPJ", normalized, reason: "CNPJ inválido." };
  }

  return {
    valid: false,
    type: null,
    normalized,
    reason: "O documento deve ter 11 dígitos (CPF) ou 14 (CNPJ).",
  };
}

/** Formatação para exibição. O banco guarda sempre a forma normalizada. */
export function formatDocument(input: string): string {
  const digits = normalizeDocument(input);

  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5",
    );
  }
  return input;
}

// ---------------------------------------------------------------------------
// Normalização de contato e endereço
// ---------------------------------------------------------------------------

/** Telefone brasileiro: somente dígitos, sem o prefixo 55 quando presente. */
export function normalizePhone(input: string): string | null {
  let digits = normalizeDocument(input);

  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  // 10 dígitos (fixo com DDD) ou 11 (celular com DDD).
  if (digits.length !== 10 && digits.length !== 11) return null;
  return digits;
}

/** Separa DDD e número, formato que a Omie espera em campos distintos. */
export function splitPhone(
  input: string,
): { readonly areaCode: string; readonly number: string } | null {
  const digits = normalizePhone(input);
  if (digits === null) return null;

  return { areaCode: digits.slice(0, 2), number: digits.slice(2) };
}

export function normalizeZipCode(input: string): string | null {
  const digits = normalizeDocument(input);
  return digits.length === 8 ? digits : null;
}

export function formatZipCode(input: string): string {
  const digits = normalizeDocument(input);
  return digits.length === 8 ? digits.replace(/^(\d{5})(\d{3})$/, "$1-$2") : input;
}

const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

export function normalizeState(input: string): string | null {
  const upper = input.trim().toUpperCase();
  return BRAZILIAN_STATES.has(upper) ? upper : null;
}

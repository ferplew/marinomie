import { describe, expect, it } from "vitest";
import {
  formatDocument,
  formatZipCode,
  isValidCNPJ,
  isValidCPF,
  normalizeDocument,
  normalizePhone,
  normalizeState,
  normalizeZipCode,
  splitPhone,
  validateDocument,
} from "@/domain/customers/document";

/**
 * Os documentos usados aqui são gerados para satisfazer o algoritmo de dígito
 * verificador — não pertencem a nenhuma pessoa ou empresa real.
 */
const VALID_CPF = "52998224725";
const VALID_CNPJ = "11222333000181";

describe("isValidCPF", () => {
  it("aceita CPF com dígitos verificadores corretos", () => {
    expect(isValidCPF(VALID_CPF)).toBe(true);
  });

  it("aceita CPF formatado", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
  });

  it("rejeita dígito verificador errado", () => {
    expect(isValidCPF("52998224726")).toBe(false);
  });

  it("rejeita sequência de dígitos iguais, que passaria no cálculo", () => {
    // 111.111.111-11 satisfaz a fórmula mas não é um CPF existente.
    expect(isValidCPF("11111111111")).toBe(false);
    expect(isValidCPF("00000000000")).toBe(false);
  });

  it("rejeita tamanho errado", () => {
    expect(isValidCPF("1234567890")).toBe(false);
    expect(isValidCPF("")).toBe(false);
  });
});

describe("isValidCNPJ", () => {
  it("aceita CNPJ válido", () => {
    expect(isValidCNPJ(VALID_CNPJ)).toBe(true);
  });

  it("aceita CNPJ formatado", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
  });

  it("rejeita dígito verificador errado", () => {
    expect(isValidCNPJ("11222333000182")).toBe(false);
  });

  it("rejeita sequência de dígitos iguais", () => {
    expect(isValidCNPJ("11111111111111")).toBe(false);
  });

  it("rejeita tamanho de CPF", () => {
    expect(isValidCNPJ(VALID_CPF)).toBe(false);
  });
});

describe("validateDocument", () => {
  it("identifica CPF e normaliza", () => {
    const result = validateDocument("529.982.247-25");
    expect(result).toMatchObject({
      valid: true,
      type: "CPF",
      normalized: VALID_CPF,
    });
  });

  it("identifica CNPJ e normaliza", () => {
    const result = validateDocument("11.222.333/0001-81");
    expect(result).toMatchObject({ valid: true, type: "CNPJ" });
  });

  it("explica por que recusou, em vez de só dizer inválido", () => {
    expect(validateDocument("").reason).toMatch(/informe/i);
    expect(validateDocument("123").reason).toMatch(/11 dígitos|14/);
    expect(validateDocument("52998224726").reason).toMatch(/CPF inválido/);
  });

  it("normaliza mesmo quando inválido, para poder registrar a tentativa", () => {
    expect(validateDocument("529.982.247-26").normalized).toBe("52998224726");
  });
});

describe("formatDocument", () => {
  it("formata CPF e CNPJ", () => {
    expect(formatDocument(VALID_CPF)).toBe("529.982.247-25");
    expect(formatDocument(VALID_CNPJ)).toBe("11.222.333/0001-81");
  });

  it("devolve a entrada quando o tamanho não bate", () => {
    expect(formatDocument("123")).toBe("123");
  });
});

describe("normalizePhone / splitPhone", () => {
  it("normaliza celular com DDD", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("11987654321");
  });

  it("normaliza fixo com DDD", () => {
    expect(normalizePhone("11 4000-0001")).toBe("1140000001");
  });

  it("remove o prefixo internacional 55", () => {
    expect(normalizePhone("+55 11 98765-4321")).toBe("11987654321");
  });

  it("rejeita telefone sem DDD", () => {
    expect(normalizePhone("98765432")).toBeNull();
  });

  it("separa DDD e número para os campos da Omie", () => {
    expect(splitPhone("(11) 98765-4321")).toEqual({
      areaCode: "11",
      number: "987654321",
    });
  });

  it("splitPhone devolve null para telefone inválido", () => {
    expect(splitPhone("123")).toBeNull();
  });
});

describe("CEP e estado", () => {
  it("normaliza CEP para 8 dígitos", () => {
    expect(normalizeZipCode("01000-000")).toBe("01000000");
  });

  it("rejeita CEP com tamanho errado", () => {
    expect(normalizeZipCode("0100000")).toBeNull();
  });

  it("formata CEP", () => {
    expect(formatZipCode("01000000")).toBe("01000-000");
  });

  it("aceita UF válida em qualquer caixa", () => {
    expect(normalizeState("sp")).toBe("SP");
    expect(normalizeState(" rj ")).toBe("RJ");
  });

  it("rejeita UF inexistente", () => {
    expect(normalizeState("XX")).toBeNull();
  });
});

describe("normalizeDocument", () => {
  it("mantém apenas dígitos", () => {
    expect(normalizeDocument("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("devolve string vazia sem dígitos", () => {
    expect(normalizeDocument("abc")).toBe("");
  });
});

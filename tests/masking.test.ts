import { describe, expect, it } from "vitest";
import { REDACTED, maskEmail, maskSensitive, maskTail } from "@/lib/masking";

describe("maskTail", () => {
  it("mantém apenas os últimos caracteres", () => {
    expect(maskTail("12345678901")).toBe("***8901");
  });

  it("mascara integralmente valores curtos", () => {
    expect(maskTail("123")).toBe("***");
  });
});

describe("maskEmail", () => {
  it("preserva o domínio e esconde o local", () => {
    expect(maskEmail("fulano@empresa.com.br")).toBe("f***@empresa.com.br");
  });

  it("cai para o mascaramento genérico sem arroba", () => {
    expect(maskEmail("naoehemail")).toBe("***mail");
  });
});

describe("maskSensitive", () => {
  it("redige integralmente credenciais da Omie", () => {
    const masked = maskSensitive({
      call: "ListarProdutos",
      app_key: "0000000000000",
      app_secret: "ffffffffffffffffffffffffffffffff",
    }) as Record<string, unknown>;

    expect(masked["call"]).toBe("ListarProdutos");
    expect(masked["app_key"]).toBe(REDACTED);
    expect(masked["app_secret"]).toBe(REDACTED);
  });

  it("não deixa o segredo aparecer em lugar nenhum do resultado serializado", () => {
    const secret = "ffffffffffffffffffffffffffffffff";
    const serialized = JSON.stringify(
      maskSensitive({ nivel1: { nivel2: [{ appSecret: secret }] } }),
    );
    expect(serialized).not.toContain(secret);
  });

  it("redige senha, token e cookie independentemente do formato da chave", () => {
    const masked = maskSensitive({
      password: "x",
      passwordHash: "y",
      accessToken: "z",
      Authorization: "Bearer abc",
      webhookSecretToken: "w",
    }) as Record<string, unknown>;

    for (const value of Object.values(masked)) {
      expect(value).toBe(REDACTED);
    }
  });

  it("mascara parcialmente dados pessoais em vez de apagá-los", () => {
    const masked = maskSensitive({
      cnpj_cpf: "12345678000199",
      email: "cliente@empresa.com.br",
    }) as Record<string, unknown>;

    expect(masked["cnpj_cpf"]).toBe("***0199");
    expect(masked["email"]).toBe("c***@empresa.com.br");
  });

  it("percorre estruturas aninhadas e arrays", () => {
    const masked = maskSensitive({
      param: [{ cliente: { cnpj_cpf: "12345678000199" } }],
    }) as { param: [{ cliente: { cnpj_cpf: string } }] };

    expect(masked.param[0].cliente.cnpj_cpf).toBe("***0199");
  });

  it("preserva valores não sensíveis", () => {
    const input = { quantidade: 10, ativo: true, descricao: "Produto A" };
    expect(maskSensitive(input)).toEqual(input);
  });

  it("não muta a entrada", () => {
    const input = { app_key: "segredo" };
    maskSensitive(input);
    expect(input.app_key).toBe("segredo");
  });

  it("sobrevive a referências circulares", () => {
    const circular: Record<string, unknown> = { nome: "x" };
    circular["self"] = circular;
    expect(() => maskSensitive(circular)).not.toThrow();
  });

  it("preserva null, undefined e Date", () => {
    const date = new Date("2026-01-01");
    expect(maskSensitive({ a: null, b: undefined, c: date })).toEqual({
      a: null,
      b: undefined,
      c: date,
    });
  });
});

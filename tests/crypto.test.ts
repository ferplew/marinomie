import { beforeAll, describe, expect, it } from "vitest";

/**
 * A criptografia lê ENCRYPTION_KEY do ambiente validado, então o ambiente
 * precisa existir antes do import do módulo.
 */
beforeAll(() => {
  process.env["DATABASE_URL"] = "postgresql://u:p@localhost:5432/db";
  process.env["REDIS_URL"] = "redis://localhost:6379";
  process.env["AUTH_SECRET"] = "0123456789012345678901234567890123456789";
  process.env["ENCRYPTION_KEY"] = "a".repeat(64);
  process.env["APP_URL"] = "http://localhost:3000";
});

const load = async () => import("@/server/crypto");

describe("encryptSecret / decryptSecret", () => {
  it("faz o ciclo completo preservando o valor", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const secret = "ffffffffffffffffffffffffffffffff";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("nunca produz texto cifrado igual para o mesmo valor (IV aleatório)", async () => {
    const { encryptSecret } = await load();
    const a = encryptSecret("mesmo-valor");
    const b = encryptSecret("mesmo-valor");
    expect(a).not.toBe(b);
  });

  it("o texto cifrado não contém o valor original", async () => {
    const { encryptSecret } = await load();
    const secret = "app-secret-super-sigiloso";
    expect(encryptSecret(secret)).not.toContain(secret);
  });

  it("carrega prefixo de versão para permitir rotação de algoritmo", async () => {
    const { encryptSecret } = await load();
    expect(encryptSecret("x").startsWith("v1:")).toBe(true);
  });

  it("detecta adulteração do texto cifrado em vez de decifrar lixo", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const encrypted = encryptSecret("valor-original");

    // Altera um caractere do payload base64.
    const body = encrypted.slice(3);
    const tampered = `v1:${body[0] === "A" ? "B" : "A"}${body.slice(1)}`;

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejeita versão desconhecida", async () => {
    const { decryptSecret } = await load();
    expect(() => decryptSecret("v9:qualquercoisa")).toThrow(/não suportada/i);
  });

  it("rejeita formato inválido e payload truncado", async () => {
    const { decryptSecret } = await load();
    expect(() => decryptSecret("sem-separador")).toThrow(/inválido/i);
    expect(() => decryptSecret("v1:AAAA")).toThrow(/truncado/i);
  });

  it("recusa cifrar valor vazio", async () => {
    const { encryptSecret } = await load();
    expect(() => encryptSecret("")).toThrow();
  });

  it("preserva acentuação e unicode", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const value = "chave-com-acentuação-e-emoji-🔐";
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });
});

describe("secretHint", () => {
  it("expõe apenas os últimos caracteres", async () => {
    const { secretHint } = await load();
    expect(secretHint("0000000000000")).toBe("0000");
  });

  it("mascara integralmente valores curtos", async () => {
    const { secretHint } = await load();
    expect(secretHint("abc")).toBe("***");
  });
});

describe("safeCompare", () => {
  it("compara corretamente", async () => {
    const { safeCompare } = await load();
    expect(safeCompare("token-abc", "token-abc")).toBe(true);
    expect(safeCompare("token-abc", "token-abd")).toBe(false);
  });

  it("devolve false para tamanhos diferentes sem lançar", async () => {
    const { safeCompare } = await load();
    expect(safeCompare("curto", "muito-mais-longo")).toBe(false);
  });
});

describe("generateWebhookToken", () => {
  it("gera tokens únicos e seguros para URL", async () => {
    const { generateWebhookToken } = await load();
    const a = generateWebhookToken();
    const b = generateWebhookToken();

    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    // base64url: seguro para compor caminho de URL sem escape.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

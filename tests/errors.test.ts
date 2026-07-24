import { describe, expect, it } from "vitest";
import { AppError, isAppError, toAppError } from "@/lib/errors";

describe("AppError", () => {
  it("mapeia código para status HTTP", () => {
    expect(new AppError("FORBIDDEN", "x").httpStatus).toBe(403);
    expect(new AppError("NOT_FOUND", "x").httpStatus).toBe(404);
    expect(new AppError("CONFLICT", "x").httpStatus).toBe(409);
    expect(new AppError("RATE_LIMITED", "x").httpStatus).toBe(429);
  });

  it("usa mensagem segura padrão quando nenhuma é informada", () => {
    const error = new AppError("INTERNAL_ERROR", "conexão recusada em 10.0.0.5:5432");
    expect(error.userMessage).not.toContain("10.0.0.5");
  });

  it("toClientJSON não expõe mensagem interna, stack nem detalhes", () => {
    const error = new AppError("VALIDATION_ERROR", "coluna cnpj_cpf inválida", {
      details: { query: "SELECT ..." },
      correlationId: "abc-123",
    });

    const payload = error.toClientJSON();
    expect(payload).toEqual({
      code: "VALIDATION_ERROR",
      message: "Verifique os dados informados.",
      correlationId: "abc-123",
    });
    expect(JSON.stringify(payload)).not.toContain("cnpj_cpf");
    expect(JSON.stringify(payload)).not.toContain("SELECT");
  });

  it("omite correlationId do payload quando não há", () => {
    expect(new AppError("NOT_FOUND", "x").toClientJSON()).not.toHaveProperty(
      "correlationId",
    );
  });
});

describe("toAppError", () => {
  it("preserva um AppError existente", () => {
    const original = new AppError("CONFLICT", "x");
    expect(toAppError(original)).toBe(original);
  });

  it("converte erro desconhecido em INTERNAL_ERROR preservando a causa", () => {
    const raw = new Error("senha do banco inválida");
    const converted = toAppError(raw, "corr-1");

    expect(converted.code).toBe("INTERNAL_ERROR");
    expect(converted.cause).toBe(raw);
    // A mensagem original nunca chega ao usuário.
    expect(converted.userMessage).not.toContain("senha");
    expect(converted.correlationId).toBe("corr-1");
  });

  it("converte valores lançados que não são Error", () => {
    expect(toAppError("string solta").code).toBe("INTERNAL_ERROR");
  });

  it("isAppError distingue corretamente", () => {
    expect(isAppError(new AppError("NOT_FOUND", "x"))).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
  });
});

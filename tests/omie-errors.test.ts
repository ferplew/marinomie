import { describe, expect, it } from "vitest";
import {
  classifyOmieError,
  classifyTransportFailure,
  isWriteCall,
} from "@/integrations/omie/errors/classify";
import { OmieIntegrationError } from "@/integrations/omie/errors/omie-error";
import { extractErrorSignal } from "@/integrations/omie/client/omie-client";

describe("isWriteCall", () => {
  it("reconhece métodos de escrita da Omie", () => {
    for (const call of [
      "IncluirPedido",
      "AlterarCliente",
      "UpsertClienteCpfCnpj",
      "TrocarEtapaPedido",
      "ExcluirProduto",
      "AssociarCodIntProduto",
    ]) {
      expect(isWriteCall(call), call).toBe(true);
    }
  });

  it("reconhece métodos de leitura", () => {
    for (const call of [
      "ListarProdutos",
      "ConsultarCliente",
      "ObterEstoqueProduto",
      "PosicaoEstoque",
      "StatusPedido",
    ]) {
      expect(isWriteCall(call), call).toBe(false);
    }
  });
});

describe("classifyOmieError — padrões documentados", () => {
  it("classifica limite de requisições como reenviável", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "Too Many Requests",
      isWrite: false,
    });
    expect(result.code).toBe("RATE_LIMIT_ERROR");
    expect(result.disposition).toBe("RETRYABLE");
  });

  it("classifica duplicidade por código de integração como conflito não reenviável", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "Cliente já cadastrado para o código de integração MOCK-CLI-1",
      isWrite: true,
    });
    expect(result.code).toBe("CONFLICT_ERROR");
    expect(result.disposition).toBe("NON_RETRYABLE");
  });

  it("classifica registro inexistente", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "Pedido não cadastrado para o número 1234",
      isWrite: false,
    });
    expect(result.code).toBe("RESOURCE_NOT_FOUND");
    expect(result.disposition).toBe("NON_RETRYABLE");
  });

  it("classifica campo obrigatório ausente como validação", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "O preenchimento da tag [codigo_cliente] é obrigatório",
      isWrite: true,
    });
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.disposition).toBe("NON_RETRYABLE");
  });

  it("classifica limite de caracteres como validação", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "O número máximo de caracteres permitido para o elemento [obs] é de 200",
      isWrite: true,
    });
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("classifica credencial inválida exigindo intervenção", () => {
    const result = classifyOmieError({
      httpStatus: 401,
      message: "app_key inválida",
      isWrite: false,
    });
    expect(result.code).toBe("AUTHENTICATION_ERROR");
    expect(result.disposition).toBe("AUTHENTICATION_REQUIRED");
  });

  it("trata PROTO_BYEBYE em escrita como resultado incerto", () => {
    // Documentado como instabilidade que pode processar parcialmente — repetir
    // às cegas duplicaria o registro.
    const result = classifyOmieError({
      httpStatus: 500,
      message: "PROTO_BYEBYE",
      isWrite: true,
    });
    expect(result.disposition).toBe("UNCERTAIN_RESULT");
  });

  it("trata PROTO_BYEBYE em leitura como reenviável", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "PROTO_BYEBYE",
      isWrite: false,
    });
    expect(result.disposition).toBe("RETRYABLE");
  });
});

describe("classifyOmieError — sem padrão reconhecido", () => {
  it("HTTP 500 sem mensagem conhecida em ESCRITA vira resultado incerto", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "erro interno qualquer",
      isWrite: true,
    });
    expect(result.disposition).toBe("UNCERTAIN_RESULT");
  });

  it("HTTP 500 sem mensagem conhecida em LEITURA é reenviável", () => {
    const result = classifyOmieError({
      httpStatus: 500,
      message: "erro interno qualquer",
      isWrite: false,
    });
    expect(result.disposition).toBe("RETRYABLE");
  });

  it("HTTP 429 é reenviável mesmo sem mensagem", () => {
    expect(
      classifyOmieError({ httpStatus: 429, isWrite: false }).code,
    ).toBe("RATE_LIMIT_ERROR");
  });

  it("HTTP 4xx genérico não é reenviável", () => {
    const result = classifyOmieError({ httpStatus: 400, isWrite: false });
    expect(result.disposition).toBe("NON_RETRYABLE");
  });
});

describe("classifyTransportFailure", () => {
  it("timeout em escrita nunca é reenviável automaticamente", () => {
    const result = classifyTransportFailure("timeout", true);
    expect(result.code).toBe("TIMEOUT_ERROR");
    expect(result.disposition).toBe("UNCERTAIN_RESULT");
  });

  it("timeout em leitura é reenviável", () => {
    expect(classifyTransportFailure("timeout", false).disposition).toBe(
      "RETRYABLE",
    );
  });

  it("falha de rede em escrita é resultado incerto", () => {
    expect(classifyTransportFailure("network", true).disposition).toBe(
      "UNCERTAIN_RESULT",
    );
  });
});

describe("extractErrorSignal", () => {
  const base = { httpStatus: 200, rawText: undefined };

  it("detecta faultstring do envelope SOAP", () => {
    const signal = extractErrorSignal({
      ...base,
      body: { faultcode: "SOAP-ENV:Client-101", faultstring: "Erro X" },
    });
    expect(signal).toEqual({ code: "SOAP-ENV:Client-101", message: "Erro X" });
  });

  it("detecta cCodStatus diferente de zero", () => {
    const signal = extractErrorSignal({
      ...base,
      body: { cCodStatus: "102", cDesStatus: "Falhou" },
    });
    expect(signal?.code).toBe("102");
    expect(signal?.message).toBe("Falhou");
  });

  it("aceita cCodStatus zero como sucesso", () => {
    expect(
      extractErrorSignal({ ...base, body: { cCodStatus: "0", cDesStatus: "ok" } }),
    ).toBeNull();
  });

  it("aceita '0000' como sucesso", () => {
    expect(
      extractErrorSignal({ ...base, body: { cCodStatus: "0000" } }),
    ).toBeNull();
  });

  it("detecta codigo_status de cadastros", () => {
    const signal = extractErrorSignal({
      ...base,
      body: { codigo_status: "500", descricao_status: "Documento inválido" },
    });
    expect(signal?.message).toBe("Documento inválido");
  });

  it("não sinaliza erro em resposta normal de listagem", () => {
    expect(
      extractErrorSignal({
        ...base,
        body: { pagina: 1, total_de_paginas: 1, produto_servico_cadastro: [] },
      }),
    ).toBeNull();
  });

  it("não quebra com corpo nulo ou não-objeto", () => {
    expect(extractErrorSignal({ ...base, body: null })).toBeNull();
    expect(extractErrorSignal({ ...base, body: "texto" })).toBeNull();
  });
});

describe("OmieIntegrationError", () => {
  it("só considera reenviável a disposição RETRYABLE", () => {
    const uncertain = new OmieIntegrationError({
      code: "TIMEOUT_ERROR",
      disposition: "UNCERTAIN_RESULT",
      message: "x",
      correlationId: "c1",
    });
    expect(uncertain.retryable).toBe(false);

    const retryable = new OmieIntegrationError({
      code: "TIMEOUT_ERROR",
      disposition: "RETRYABLE",
      message: "x",
      correlationId: "c1",
    });
    expect(retryable.retryable).toBe(true);
  });

  it("toLogObject não inclui stack nem payload", () => {
    const error = new OmieIntegrationError({
      code: "VALIDATION_ERROR",
      disposition: "NON_RETRYABLE",
      message: "interno",
      correlationId: "c1",
      endpoint: "geral/clientes",
      call: "IncluirCliente",
    });

    const log = error.toLogObject();
    expect(log).not.toHaveProperty("stack");
    expect(log).not.toHaveProperty("param");
    expect(log["endpoint"]).toBe("geral/clientes");
  });
});

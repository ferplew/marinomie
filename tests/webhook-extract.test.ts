import { describe, expect, it } from "vitest";
import {
  extractEntityHint,
  extractEventId,
  extractTopic,
} from "@/domain/webhooks/process-event";

/**
 * Extração de informação do payload de webhook.
 *
 * A Omie não publica o schema dos eventos (docs/known-limitations.md §1, item
 * 4). Estas funções são explicitamente heurísticas: o resultado só decide **o
 * que consultar** na API, nunca é escrito direto no banco. Os testes garantem
 * que a heurística não invente resultado quando não reconhece nada.
 */
describe("extractTopic", () => {
  it("aceita as variações plausíveis de nome de campo", () => {
    expect(extractTopic({ topic: "produto.alterado" })).toBe("produto.alterado");
    expect(extractTopic({ topico: "cliente.incluido" })).toBe("cliente.incluido");
    expect(extractTopic({ event: "pedido.alterado" })).toBe("pedido.alterado");
  });

  it("devolve null quando não há tópico, em vez de inventar um", () => {
    expect(extractTopic({ outro: "x" })).toBeNull();
    expect(extractTopic({})).toBeNull();
    expect(extractTopic(null)).toBeNull();
    expect(extractTopic("texto")).toBeNull();
  });

  it("ignora tópico vazio", () => {
    expect(extractTopic({ topic: "" })).toBeNull();
  });
});

describe("extractEventId", () => {
  it("aceita id como string ou número", () => {
    expect(extractEventId({ messageId: "abc-123" })).toBe("abc-123");
    expect(extractEventId({ id: 42 })).toBe("42");
  });

  it("devolve null sem id reconhecível", () => {
    expect(extractEventId({ foo: "bar" })).toBeNull();
  });
});

describe("extractEntityHint", () => {
  it("reconhece produto no nível raiz", () => {
    expect(extractEntityHint({ codigo_produto: 4001 })).toEqual({
      kind: "product",
      omieId: 4001,
    });
  });

  it("reconhece pedido", () => {
    expect(extractEntityHint({ codigo_pedido: 70001 })).toEqual({
      kind: "order",
      omieId: 70001,
    });
  });

  it("encontra o identificador aninhado, como a Omie costuma enviar", () => {
    const payload = {
      topic: "produto.alterado",
      event: { produto: { codigo_produto: 4002, descricao: "x" } },
    };
    expect(extractEntityHint(payload)).toEqual({ kind: "product", omieId: 4002 });
  });

  it("encontra dentro de arrays", () => {
    expect(
      extractEntityHint({ eventos: [{ dados: { nIdProduto: 4003 } }] }),
    ).toEqual({ kind: "product", omieId: 4003 });
  });

  it("aceita identificador que veio como string numérica", () => {
    expect(extractEntityHint({ codigo_produto: "4004" })).toEqual({
      kind: "product",
      omieId: 4004,
    });
  });

  it("devolve null quando não reconhece nada — vira UNHANDLED, não palpite", () => {
    expect(extractEntityHint({ topic: "algo.novo", dados: { xyz: 1 } })).toBeNull();
    expect(extractEntityHint({})).toBeNull();
    expect(extractEntityHint(null)).toBeNull();
  });

  it("não entra em recursão infinita com payload muito aninhado", () => {
    let deep: Record<string, unknown> = { fim: true };
    for (let i = 0; i < 50; i += 1) deep = { nivel: deep };
    expect(() => extractEntityHint(deep)).not.toThrow();
  });

  it("ignora valor não numérico no campo esperado", () => {
    expect(extractEntityHint({ codigo_produto: "abc" })).toBeNull();
  });
});

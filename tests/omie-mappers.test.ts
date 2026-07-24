import { describe, expect, it } from "vitest";
import { mapProduct, mapProductSummary } from "@/integrations/omie/mappers/product.mapper";
import {
  mapProductStock,
  mapStockByWarehouse,
  mapStockPosition,
  mapWarehouse,
} from "@/integrations/omie/mappers/inventory.mapper";
import {
  mapCustomer,
  mapCustomerSummary,
  normalizeDocument,
} from "@/integrations/omie/mappers/customer.mapper";
import { mapSeller } from "@/integrations/omie/mappers/seller.mapper";
import {
  effectiveMaxDiscountPercent,
  mapPriceTableItem,
} from "@/integrations/omie/mappers/price-table.mapper";
import { toDecimalString } from "@/integrations/omie/mappers/decimal";
import {
  formatOmieDate,
  omieFlagToBoolean,
  parseOmieDate,
} from "@/integrations/omie/schemas/common";

describe("toDecimalString", () => {
  it("converte número para string sem passar por float no destino", () => {
    expect(toDecimalString(289.9)).toBe("289.9");
    expect(toDecimalString(0)).toBe("0");
  });

  it("devolve null para ausente ou não finito", () => {
    expect(toDecimalString(null)).toBeNull();
    expect(toDecimalString(undefined)).toBeNull();
    expect(toDecimalString(Number.NaN)).toBeNull();
    expect(toDecimalString(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("flags e datas da Omie", () => {
  it("interpreta S/N", () => {
    expect(omieFlagToBoolean("S")).toBe(true);
    expect(omieFlagToBoolean("s")).toBe(true);
    expect(omieFlagToBoolean("N")).toBe(false);
    expect(omieFlagToBoolean(undefined)).toBe(false);
  });

  it("converte data dd/mm/aaaa", () => {
    const date = parseOmieDate("15/03/2026");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(15);
  });

  it("rejeita data impossível em vez de 'corrigir' silenciosamente", () => {
    expect(parseOmieDate("31/02/2026")).toBeNull();
  });

  it("rejeita formato inválido sem lançar", () => {
    expect(parseOmieDate("2026-03-15")).toBeNull();
    expect(parseOmieDate("")).toBeNull();
    expect(parseOmieDate(null)).toBeNull();
  });

  it("formata data no padrão da Omie", () => {
    expect(formatOmieDate(new Date(2026, 2, 5))).toBe("05/03/2026");
  });
});

describe("mapProduct", () => {
  it("inverte `inativo` para `active`", () => {
    expect(mapProduct({ codigo_produto: 1, inativo: "S" }).active).toBe(false);
    expect(mapProduct({ codigo_produto: 1, inativo: "N" }).active).toBe(true);
    // Ausência de `inativo` significa ativo.
    expect(mapProduct({ codigo_produto: 1 }).active).toBe(true);
  });

  it("traduz todos os campos para o DTO sem vazar nomes da Omie", () => {
    const dto = mapProduct({
      codigo_produto: 4001,
      codigo_produto_integracao: "INT-1",
      codigo: "SKU-1",
      descricao: "Cabo",
      unidade: "RL",
      valor_unitario: 289.9,
      ncm: "85444900",
      ean: "789",
      inativo: "N",
      codigo_familia: 10,
      descricao_familia: "Elétrica",
    });

    expect(dto).toEqual({
      omieId: 4001,
      integrationCode: "INT-1",
      sku: "SKU-1",
      description: "Cabo",
      unit: "RL",
      ncm: "85444900",
      ean: "789",
      basePrice: "289.9",
      active: true,
      familyOmieId: 10,
      familyName: "Elétrica",
    });
    expect(Object.keys(dto)).not.toContain("codigo_produto");
  });

  it("usa string vazia para descrição ausente, nunca undefined", () => {
    expect(mapProduct({ codigo_produto: 1 }).description).toBe("");
  });

  it("mapeia o resumo com os campos reduzidos", () => {
    expect(
      mapProductSummary({ codigo_produto: 2, codigo: "S", valor_unitario: 10 }),
    ).toEqual({
      omieId: 2,
      integrationCode: null,
      sku: "S",
      description: "",
      basePrice: "10",
    });
  });
});

describe("mapStockByWarehouse", () => {
  it("preserva os componentes brutos e o disponível da Omie separadamente", () => {
    const dto = mapStockByWarehouse({
      nIdlocal: 5001,
      cDescricaoLocal: "Matriz",
      nFisico: 80,
      nReservado: 30,
      nPrevisaoSaida: 12,
      nPrevisaoEntrada: 5,
      nDisponivel: 50,
      nEstoqueMinimo: 25,
      nCMC: 33.2,
    });

    expect(dto.physical).toBe("80");
    expect(dto.reserved).toBe("30");
    expect(dto.omieAvailable).toBe("50");
  });

  it("NÃO calcula disponível — essa decisão é da regra da organização", () => {
    // Físico 100, reservado 40, mas a Omie diz 55. O mapper repassa 55 sem
    // "corrigir" para 60: escolher a fórmula é do administrador.
    const dto = mapStockByWarehouse({
      nFisico: 100,
      nReservado: 40,
      nDisponivel: 55,
    });
    expect(dto.omieAvailable).toBe("55");
    expect(dto.physical).toBe("100");
    expect(dto.reserved).toBe("40");
  });

  it("mapeia posição do serviço alternativo, com nomes diferentes", () => {
    // estoque/consulta usa `fisico`/`reservado`/`pendente` e não tem disponível.
    const dto = mapStockPosition({
      fisico: 10,
      reservado: 2,
      pendente: 3,
      estoque_minimo: 1,
      cmc: 9.5,
    });

    expect(dto.physical).toBe("10");
    expect(dto.reserved).toBe("2");
    expect(dto.expectedOut).toBe("3");
    // Este serviço não fornece disponível calculado.
    expect(dto.omieAvailable).toBeNull();
  });

  it("normaliza os dois serviços para o mesmo formato de DTO", () => {
    const fromSummary = mapStockByWarehouse({ nFisico: 10, nReservado: 2 });
    const fromPosition = mapStockPosition({ fisico: 10, reservado: 2 });
    expect(Object.keys(fromSummary).sort()).toEqual(
      Object.keys(fromPosition).sort(),
    );
  });
});

describe("mapProductStock", () => {
  it("registra o momento da leitura para a UI sinalizar dado velho", () => {
    const readAt = new Date("2026-07-24T12:00:00Z");
    const dto = mapProductStock(
      { nIdProduto: 4001, listaEstoque: [{ nFisico: 5 }] },
      readAt,
    );
    expect(dto.readAt).toBe(readAt);
    expect(dto.positions).toHaveLength(1);
  });

  it("lida com produto sem posições de estoque", () => {
    expect(mapProductStock({ nIdProduto: 1, listaEstoque: [] }).positions).toEqual(
      [],
    );
  });
});

describe("mapWarehouse", () => {
  it("mapeia flags de local de estoque", () => {
    expect(
      mapWarehouse({
        codigo_local_estoque: 5001,
        codigo: "MATRIZ",
        descricao: "Depósito",
        padrao: "S",
        inativo: "N",
        dispVenda: "S",
      }),
    ).toEqual({
      omieId: 5001,
      code: "MATRIZ",
      name: "Depósito",
      isDefault: true,
      active: true,
      availableForSale: true,
    });
  });
});

describe("normalizeDocument", () => {
  it("remove pontuação de CNPJ e CPF", () => {
    expect(normalizeDocument("11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizeDocument("123.456.789-09")).toBe("12345678909");
  });

  it("devolve null para vazio ou sem dígitos", () => {
    expect(normalizeDocument("")).toBeNull();
    expect(normalizeDocument("---")).toBeNull();
    expect(normalizeDocument(null)).toBeNull();
  });
});

describe("mapCustomer", () => {
  it("normaliza documento, CEP e telefone", () => {
    const dto = mapCustomer({
      codigo_cliente_omie: 9001,
      cnpj_cpf: "11.222.333/0001-81",
      telefone1_ddd: "11",
      telefone1_numero: "4000-0001",
      cep: "01000-000",
      endereco: "Rua X",
      cidade: "São Paulo",
      estado: "SP",
    });

    expect(dto.document).toBe("11222333000181");
    expect(dto.phone).toBe("1140000001");
    expect(dto.address?.zipCode).toBe("01000000");
  });

  it("devolve endereço nulo quando não há nenhum campo de endereço", () => {
    expect(mapCustomer({ codigo_cliente_omie: 1 }).address).toBeNull();
  });

  it("resolve a inconsistência de nome do id entre listagem completa e resumida", () => {
    // Listagem completa: codigo_cliente_omie
    expect(mapCustomer({ codigo_cliente_omie: 9001 }).omieId).toBe(9001);
    // Listagem resumida: codigo_cliente
    expect(mapCustomerSummary({ codigo_cliente: 9001 }).omieId).toBe(9001);
  });
});

describe("mapSeller", () => {
  it("mapeia vendedor e inverte `inativo`", () => {
    expect(
      mapSeller({
        codigo: 1001,
        codInt: "V-1",
        nome: "Vanessa",
        email: "v@x",
        inativo: "N",
        fatura_pedido: "S",
        visualiza_pedido: "N",
        comissao: 3.5,
      }),
    ).toEqual({
      omieId: 1001,
      integrationCode: "V-1",
      name: "Vanessa",
      email: "v@x",
      active: true,
      canInvoiceOrder: true,
      viewOnlyOrders: false,
      commissionPercent: "3.5",
    });
  });
});

describe("effectiveMaxDiscountPercent", () => {
  it("prevalece o menor entre o teto da Omie e o limite do vendedor", () => {
    expect(effectiveMaxDiscountPercent("4", "10")).toBe("4");
    expect(effectiveMaxDiscountPercent("15", "10")).toBe("10");
  });

  it("sem teto da Omie, vale o limite do vendedor — nunca 'sem limite'", () => {
    expect(effectiveMaxDiscountPercent(null, "10")).toBe("10");
  });

  it("valores iguais devolvem o mesmo limite", () => {
    expect(effectiveMaxDiscountPercent("10", "10")).toBe("10");
  });

  it("ignora valor não numérico da Omie em vez de zerar o limite", () => {
    expect(effectiveMaxDiscountPercent("abc", "10")).toBe("10");
  });
});

describe("mapPriceTableItem", () => {
  it("expõe o desconto máximo da tabela para a validação de desconto", () => {
    const dto = mapPriceTableItem({
      nCodProd: 4002,
      cCodigoProduto: "DIS-C25",
      nValorTabela: 46,
      nDescMaximo: 4,
      nDescSugerido: 2,
      cManual: "N",
    });

    expect(dto.tablePrice).toBe("46");
    expect(dto.maxDiscountPercent).toBe("4");
    expect(dto.manuallyAdjusted).toBe(false);
  });
});

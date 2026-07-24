import { describe, expect, it } from "vitest";
import {
  calculateAvailability,
  consolidateAvailability,
  isStockStale,
  stockAgeSeconds,
  type AvailabilityConfig,
  type StockComponents,
} from "@/domain/inventory/availability";

function components(overrides: Partial<StockComponents> = {}): StockComponents {
  return {
    physical: null,
    reserved: null,
    expectedOut: null,
    expectedIn: null,
    omieAvailable: null,
    ...overrides,
  };
}

function config(
  rule: AvailabilityConfig["rule"],
  safetyMargin = "0",
): AvailabilityConfig {
  return { rule, safetyMargin };
}

describe("calculateAvailability — cada regra", () => {
  const full = components({
    physical: "100",
    reserved: "30",
    expectedOut: "12",
    expectedIn: "50",
    omieAvailable: "58",
  });

  it("OMIE_CALCULATED usa o valor da Omie sem recalcular", () => {
    // A Omie diz 58, embora físico-reservado seja 70. Confiamos no ERP.
    expect(calculateAvailability(full, config("OMIE_CALCULATED")).displayed).toBe("58");
  });

  it("PHYSICAL usa apenas o físico", () => {
    expect(calculateAvailability(full, config("PHYSICAL")).displayed).toBe("100");
  });

  it("PHYSICAL_MINUS_RESERVED subtrai o reservado", () => {
    expect(
      calculateAvailability(full, config("PHYSICAL_MINUS_RESERVED")).displayed,
    ).toBe("70");
  });

  it("BALANCE_MINUS_PENDING subtrai a saída prevista", () => {
    expect(
      calculateAvailability(full, config("BALANCE_MINUS_PENDING")).displayed,
    ).toBe("88");
  });

  it("CUSTOM é declarada indeterminada em vez de cair numa fórmula qualquer", () => {
    const result = calculateAvailability(full, config("CUSTOM"));
    expect(result.indeterminate).toBe(true);
    expect(result.displayed).toBe("0");
  });

  it("informa qual regra produziu o número", () => {
    expect(calculateAvailability(full, config("PHYSICAL")).rule).toBe("PHYSICAL");
  });
});

describe("calculateAvailability — margem de segurança", () => {
  it("subtrai a margem do valor calculado", () => {
    const result = calculateAvailability(
      components({ physical: "100", reserved: "30" }),
      config("PHYSICAL_MINUS_RESERVED", "5"),
    );
    expect(result.computed).toBe("70");
    expect(result.displayed).toBe("65");
  });

  it("nunca exibe negativo — piso em zero", () => {
    const result = calculateAvailability(
      components({ physical: "3" }),
      config("PHYSICAL", "10"),
    );
    expect(result.displayed).toBe("0");
    // O valor bruto é preservado para diagnóstico.
    expect(result.computed).toBe("3");
  });

  it("margem zero não altera o valor", () => {
    expect(
      calculateAvailability(components({ physical: "42" }), config("PHYSICAL", "0"))
        .displayed,
    ).toBe("42");
  });
});

describe("calculateAvailability — dado ausente", () => {
  it("não trata reservado ausente como zero", () => {
    // Se tratasse, exibiria o físico inteiro como vendável — overselling direto.
    const result = calculateAvailability(
      components({ physical: "100" }),
      config("PHYSICAL_MINUS_RESERVED"),
    );
    expect(result.indeterminate).toBe(true);
  });

  it("OMIE_CALCULATED sem nDisponivel fica indeterminado", () => {
    // É o caso do serviço estoque/consulta, que não fornece esse campo.
    expect(
      calculateAvailability(components({ physical: "10" }), config("OMIE_CALCULATED"))
        .indeterminate,
    ).toBe(true);
  });

  it("BALANCE cai para o físico quando não há disponível calculado", () => {
    expect(
      calculateAvailability(components({ physical: "10" }), config("BALANCE"))
        .displayed,
    ).toBe("10");
  });

  it("ignora valor não numérico em vez de produzir NaN", () => {
    expect(
      calculateAvailability(components({ physical: "abc" }), config("PHYSICAL"))
        .indeterminate,
    ).toBe(true);
  });

  it("string vazia conta como ausente", () => {
    expect(
      calculateAvailability(components({ physical: "" }), config("PHYSICAL"))
        .indeterminate,
    ).toBe(true);
  });
});

describe("calculateAvailability — precisão decimal", () => {
  it("não introduz erro de ponto flutuante", () => {
    const result = calculateAvailability(
      components({ physical: "0.3", reserved: "0.1" }),
      config("PHYSICAL_MINUS_RESERVED"),
    );
    // Em float, 0.3 - 0.1 daria 0.19999999999999998.
    expect(result.displayed).toBe("0.2");
  });

  it("preserva casas decimais de quantidade fracionada", () => {
    const result = calculateAvailability(
      components({ physical: "12.345", reserved: "0.045" }),
      config("PHYSICAL_MINUS_RESERVED"),
    );
    expect(result.displayed).toBe("12.3");
  });
});

describe("consolidateAvailability", () => {
  const conf = config("PHYSICAL_MINUS_RESERVED");

  it("soma apenas locais disponíveis para venda", () => {
    const result = consolidateAvailability(
      [
        {
          components: components({ physical: "100", reserved: "0" }),
          availableForSale: true,
        },
        {
          // Depósito de remessa: contar isto causaria overselling.
          components: components({ physical: "500", reserved: "0" }),
          availableForSale: false,
        },
      ],
      conf,
    );

    expect(result.total).toBe("100");
  });

  it("exclui posição indeterminada do total e sinaliza", () => {
    const result = consolidateAvailability(
      [
        {
          components: components({ physical: "50", reserved: "0" }),
          availableForSale: true,
        },
        { components: components({ physical: "10" }), availableForSale: true },
      ],
      conf,
    );

    expect(result.total).toBe("50");
    expect(result.hasIndeterminate).toBe(true);
  });

  it("soma múltiplos depósitos", () => {
    const result = consolidateAvailability(
      [
        {
          components: components({ physical: "120", reserved: "0" }),
          availableForSale: true,
        },
        {
          components: components({ physical: "15", reserved: "5" }),
          availableForSale: true,
        },
      ],
      conf,
    );
    expect(result.total).toBe("130");
  });

  it("lista vazia devolve zero sem indeterminação", () => {
    expect(consolidateAvailability([], conf)).toEqual({
      total: "0",
      hasIndeterminate: false,
    });
  });

  it("aplica a margem em cada posição, não uma vez no total", () => {
    // Duas posições com margem 5 => 95 + 45 = 140, não 150 - 5.
    const result = consolidateAvailability(
      [
        {
          components: components({ physical: "100", reserved: "0" }),
          availableForSale: true,
        },
        {
          components: components({ physical: "50", reserved: "0" }),
          availableForSale: true,
        },
      ],
      config("PHYSICAL_MINUS_RESERVED", "5"),
    );
    expect(result.total).toBe("140");
  });
});

describe("indicador de dado desatualizado", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  it("marca como velho quando passa do limite", () => {
    const readAt = new Date("2026-07-24T11:58:00Z"); // 120s atrás
    expect(isStockStale(readAt, 60, now)).toBe(true);
  });

  it("não marca dentro do limite", () => {
    const readAt = new Date("2026-07-24T11:59:30Z"); // 30s atrás
    expect(isStockStale(readAt, 60, now)).toBe(false);
  });

  it("calcula a idade em segundos", () => {
    expect(stockAgeSeconds(new Date("2026-07-24T11:59:00Z"), now)).toBe(60);
  });

  it("idade nunca é negativa, mesmo com relógio adiantado", () => {
    expect(stockAgeSeconds(new Date("2026-07-24T12:05:00Z"), now)).toBe(0);
  });
});

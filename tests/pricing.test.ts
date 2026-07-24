import { describe, expect, it } from "vitest";
import {
  applyDiscount,
  calculateTotals,
  effectiveDiscountCeiling,
  lineTotal,
  resolvePrice,
  type PriceCandidate,
} from "@/domain/pricing/resolve-price";

function candidate(
  source: PriceCandidate["source"],
  price: string | null,
  overrides: Partial<PriceCandidate> = {},
): PriceCandidate {
  return {
    source,
    priceTableId: `table-${source}`,
    price,
    maxDiscountPercent: null,
    suggestedDiscountPercent: null,
    ...overrides,
  };
}

const DEFAULT_PRECEDENCE = ["customer", "seller", "organization", "product"] as const;

describe("resolvePrice — precedência", () => {
  it("prefere a tabela do cliente", () => {
    const result = resolvePrice(
      [
        candidate("customer", "90"),
        candidate("seller", "95"),
        candidate("organization", "100"),
      ],
      DEFAULT_PRECEDENCE,
    );
    expect(result?.unitPrice).toBe("90");
    expect(result?.source).toBe("customer");
  });

  it("cai para a tabela do vendedor quando não há tabela do cliente", () => {
    const result = resolvePrice(
      [candidate("seller", "95"), candidate("organization", "100")],
      DEFAULT_PRECEDENCE,
    );
    expect(result?.source).toBe("seller");
  });

  it("cai para o preço do produto como último recurso", () => {
    const result = resolvePrice([candidate("product", "120")], DEFAULT_PRECEDENCE);
    expect(result?.unitPrice).toBe("120");
  });

  it("tabela sem preço para o produto não bloqueia — segue para a próxima", () => {
    // Cenário real: cliente tem tabela vinculada, mas ela não precifica o item.
    const result = resolvePrice(
      [candidate("customer", null), candidate("seller", "95")],
      DEFAULT_PRECEDENCE,
    );
    expect(result?.source).toBe("seller");
  });

  it("respeita uma ordem de precedência customizada", () => {
    const result = resolvePrice(
      [candidate("customer", "90"), candidate("seller", "95")],
      ["seller", "customer"],
    );
    expect(result?.source).toBe("seller");
  });

  it("devolve null quando nenhum candidato tem preço", () => {
    expect(
      resolvePrice([candidate("customer", null)], DEFAULT_PRECEDENCE),
    ).toBeNull();
  });

  it("devolve null sem candidatos", () => {
    expect(resolvePrice([], DEFAULT_PRECEDENCE)).toBeNull();
  });

  it("propaga o teto de desconto da tabela escolhida", () => {
    const result = resolvePrice(
      [candidate("customer", "90", { maxDiscountPercent: "8" })],
      DEFAULT_PRECEDENCE,
    );
    expect(result?.tableMaxDiscountPercent).toBe("8");
  });

  it("ignora preço não numérico", () => {
    const result = resolvePrice(
      [candidate("customer", "abc"), candidate("seller", "95")],
      DEFAULT_PRECEDENCE,
    );
    expect(result?.source).toBe("seller");
  });
});

describe("effectiveDiscountCeiling", () => {
  it("prevalece o menor entre tabela e vendedor", () => {
    expect(effectiveDiscountCeiling("4", "10")).toBe("4");
    expect(effectiveDiscountCeiling("15", "10")).toBe("10");
  });

  it("sem teto da tabela, vale o do vendedor — nunca 'ilimitado'", () => {
    expect(effectiveDiscountCeiling(null, "10")).toBe("10");
  });

  it("vendedor com limite zero não recebe desconto por causa da tabela", () => {
    expect(effectiveDiscountCeiling("20", "0")).toBe("0");
  });
});

describe("applyDiscount", () => {
  const base = {
    listUnitPrice: "100",
    sellerMaxDiscountPercent: "10",
    tableMaxDiscountPercent: null,
    approvalMaxDiscountPercent: "25",
  };

  it("permite desconto dentro do limite do vendedor", () => {
    const result = applyDiscount({ ...base, requestedDiscountPercent: "5" });
    expect(result.kind).toBe("allowed");
    if (result.kind === "allowed") expect(result.finalUnitPrice).toBe("95");
  });

  it("permite exatamente no limite", () => {
    expect(applyDiscount({ ...base, requestedDiscountPercent: "10" }).kind).toBe(
      "allowed",
    );
  });

  it("exige aprovação acima do limite do vendedor", () => {
    const result = applyDiscount({ ...base, requestedDiscountPercent: "15" });
    expect(result.kind).toBe("requires_approval");
    if (result.kind === "requires_approval") {
      expect(result.ceilingPercent).toBe("10");
      expect(result.finalUnitPrice).toBe("85");
    }
  });

  it("recusa acima do teto de aprovação", () => {
    const result = applyDiscount({ ...base, requestedDiscountPercent: "30" });
    expect(result.kind).toBe("rejected");
  });

  it("o teto da tabela limita até a aprovação", () => {
    // A Omie diz que o produto admite no máximo 8%: nem gerente libera 20%.
    const result = applyDiscount({
      ...base,
      tableMaxDiscountPercent: "8",
      requestedDiscountPercent: "20",
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.ceilingPercent).toBe("8");
  });

  it("teto da tabela reduz o limite do vendedor e também o da aprovação", () => {
    // Tabela limita a 4%: 6% fica acima do vendedor E acima do que se pode
    // aprovar, então é recusa — não "pede aprovação". Pedir aprovação aqui
    // deixaria a impressão de que alguém pode liberar algo que a Omie proíbe.
    const result = applyDiscount({
      ...base,
      tableMaxDiscountPercent: "4",
      requestedDiscountPercent: "6",
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.ceilingPercent).toBe("4");
  });

  it("aprovação continua possível quando a tabela é mais folgada que o vendedor", () => {
    // Tabela permite 15%, vendedor só 10%: 12% é justamente o caso que a
    // aprovação existe para resolver.
    const result = applyDiscount({
      ...base,
      tableMaxDiscountPercent: "15",
      requestedDiscountPercent: "12",
    });
    expect(result.kind).toBe("requires_approval");
    if (result.kind === "requires_approval") expect(result.ceilingPercent).toBe("10");
  });

  it("recusa desconto negativo — seria acréscimo sem validação", () => {
    const result = applyDiscount({ ...base, requestedDiscountPercent: "-5" });
    expect(result.kind).toBe("rejected");
  });

  it("recusa desconto acima de 100%", () => {
    expect(
      applyDiscount({ ...base, requestedDiscountPercent: "150" }).kind,
    ).toBe("rejected");
  });

  it("recusa quando não há preço de tabela", () => {
    const result = applyDiscount({
      ...base,
      listUnitPrice: "0",
      requestedDiscountPercent: "5",
    });
    expect(result.kind).toBe("rejected");
  });

  it("desconto zero é permitido", () => {
    const result = applyDiscount({ ...base, requestedDiscountPercent: "0" });
    expect(result.kind).toBe("allowed");
    if (result.kind === "allowed") expect(result.finalUnitPrice).toBe("100");
  });

  it("calcula preço final com precisão decimal", () => {
    const result = applyDiscount({
      ...base,
      listUnitPrice: "289.90",
      requestedDiscountPercent: "7.5",
    });
    if (result.kind === "requires_approval" || result.kind === "allowed") {
      // 289.90 * 0.925 = 268.1575
      expect(result.finalUnitPrice).toBe("268.1575");
    }
  });
});

describe("lineTotal", () => {
  it("multiplica com arredondamento monetário", () => {
    expect(lineTotal("289.90", "3")).toBe("869.7");
  });

  it("arredonda meio para cima em duas casas", () => {
    expect(lineTotal("0.005", "1")).toBe("0.01");
  });

  it("aceita quantidade fracionada", () => {
    expect(lineTotal("10", "2.5")).toBe("25");
  });

  it("devolve zero para entrada inválida em vez de NaN", () => {
    expect(lineTotal("abc", "2")).toBe("0");
  });
});

describe("calculateTotals", () => {
  it("soma linhas, frete e outras despesas", () => {
    const totals = calculateTotals({
      lines: [
        { unitPrice: "100", quantity: "2" },
        { unitPrice: "50.5", quantity: "3" },
      ],
      shipping: "30",
      otherCosts: "5.5",
    });

    expect(totals.subtotal).toBe("351.5");
    expect(totals.total).toBe("387");
  });

  it("funciona sem frete nem despesas", () => {
    const totals = calculateTotals({ lines: [{ unitPrice: "10", quantity: "1" }] });
    expect(totals.total).toBe("10");
  });

  it("carrinho vazio soma zero", () => {
    expect(calculateTotals({ lines: [] }).total).toBe("0");
  });

  it("não acumula erro de float ao somar muitas linhas", () => {
    const lines = Array.from({ length: 10 }, () => ({
      unitPrice: "0.1",
      quantity: "1",
    }));
    expect(calculateTotals({ lines }).subtotal).toBe("1");
  });
});

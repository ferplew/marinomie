import { Decimal } from "decimal.js";

/**
 * Resolução de preço e validação de desconto (briefing §14).
 *
 * Duas regras inegociáveis, ambas implementadas aqui e testadas:
 *
 * 1. **A precedência de tabela é explícita e configurável.** Nada de "o preço
 *    que veio junto do produto".
 * 2. **Preço e desconto são sempre recalculados no backend.** O que o navegador
 *    envia é tratado como sugestão. Este módulo é puro justamente para que a
 *    mesma regra valha em Server Action, worker e futura API REST.
 */

/** Origem possível de uma tabela de preço, na ordem de precedência configurada. */
export type PriceSource = "customer" | "seller" | "organization" | "product";

export interface PriceCandidate {
  readonly source: PriceSource;
  readonly priceTableId: string | null;
  readonly price: string | null;
  /** `nDescMaximo` da tabela Omie, quando houver. */
  readonly maxDiscountPercent: string | null;
  readonly suggestedDiscountPercent: string | null;
}

export interface ResolvedPrice {
  readonly unitPrice: string;
  readonly source: PriceSource;
  readonly priceTableId: string | null;
  /** Teto de desconto da tabela. `null` = a tabela não impõe teto próprio. */
  readonly tableMaxDiscountPercent: string | null;
  readonly suggestedDiscountPercent: string | null;
}

function toDecimal(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

/**
 * Escolhe o preço conforme a ordem de precedência da organização.
 *
 * Um candidato sem preço é ignorado e a busca continua para o próximo da ordem:
 * ter uma tabela vinculada ao cliente que não precifica aquele produto não pode
 * bloquear a venda, deve apenas cair para a tabela seguinte.
 */
export function resolvePrice(
  candidates: readonly PriceCandidate[],
  precedence: readonly PriceSource[],
): ResolvedPrice | null {
  for (const source of precedence) {
    const candidate = candidates.find((c) => c.source === source);
    if (!candidate) continue;

    const price = toDecimal(candidate.price);
    if (price === null) continue;

    return {
      unitPrice: price.toString(),
      source: candidate.source,
      priceTableId: candidate.priceTableId,
      tableMaxDiscountPercent: candidate.maxDiscountPercent,
      suggestedDiscountPercent: candidate.suggestedDiscountPercent,
    };
  }

  return null;
}

/**
 * Teto de desconto efetivo: o **menor** entre o limite da tabela Omie e o limite
 * do vendedor (docs/permissions.md §3).
 *
 * Quando a tabela não impõe teto, vale o limite do vendedor — nunca o contrário
 * de "sem limite". Ausência de restrição num lado não pode virar permissão
 * ilimitada.
 */
export function effectiveDiscountCeiling(
  tableMaxPercent: string | null,
  sellerMaxPercent: string,
): string {
  const seller = toDecimal(sellerMaxPercent) ?? new Decimal(0);
  const table = toDecimal(tableMaxPercent);

  if (table === null) return seller.toString();
  return Decimal.min(table, seller).toString();
}

export type DiscountOutcome =
  /** Dentro do limite do vendedor: pode seguir direto. */
  | { readonly kind: "allowed"; readonly finalUnitPrice: string; readonly discountPercent: string }
  /** Acima do limite, mas dentro do que um aprovador pode liberar. */
  | {
      readonly kind: "requires_approval";
      readonly finalUnitPrice: string;
      readonly discountPercent: string;
      readonly ceilingPercent: string;
    }
  /** Recusado: acima até do teto máximo permitido por aprovação. */
  | { readonly kind: "rejected"; readonly reason: string; readonly ceilingPercent: string };

export interface DiscountRequest {
  readonly listUnitPrice: string;
  readonly requestedDiscountPercent: string;
  readonly sellerMaxDiscountPercent: string;
  readonly tableMaxDiscountPercent: string | null;
  /**
   * Teto absoluto que uma aprovação pode liberar. Acima disso nem gerente
   * aprova — evita que "pedir aprovação" vire caminho para desconto arbitrário.
   */
  readonly approvalMaxDiscountPercent: string;
}

/**
 * Valida o desconto e calcula o preço final.
 *
 * Retorna um resultado explícito em vez de lançar: a diferença entre "permitido"
 * e "precisa de aprovação" é fluxo de negócio normal, não erro.
 */
export function applyDiscount(request: DiscountRequest): DiscountOutcome {
  const listPrice = toDecimal(request.listUnitPrice);
  const requested = toDecimal(request.requestedDiscountPercent) ?? new Decimal(0);

  if (listPrice === null || listPrice.lessThanOrEqualTo(0)) {
    return {
      kind: "rejected",
      reason: "Preço de tabela indisponível para este produto.",
      ceilingPercent: "0",
    };
  }

  if (requested.lessThan(0)) {
    // Desconto negativo seria acréscimo disfarçado, aplicado sem passar por
    // nenhuma validação de preço.
    return {
      kind: "rejected",
      reason: "Desconto não pode ser negativo.",
      ceilingPercent: "0",
    };
  }

  if (requested.greaterThan(100)) {
    return {
      kind: "rejected",
      reason: "Desconto não pode ultrapassar 100%.",
      ceilingPercent: "100",
    };
  }

  const sellerCeiling = new Decimal(
    effectiveDiscountCeiling(
      request.tableMaxDiscountPercent,
      request.sellerMaxDiscountPercent,
    ),
  );

  // O teto de aprovação também respeita o limite da tabela: se a Omie diz que o
  // produto admite no máximo 8%, nem uma aprovação deve liberar 20%.
  const approvalCeiling = new Decimal(
    effectiveDiscountCeiling(
      request.tableMaxDiscountPercent,
      request.approvalMaxDiscountPercent,
    ),
  );

  const finalUnitPrice = listPrice
    .times(new Decimal(100).minus(requested))
    .dividedBy(100);

  if (requested.lessThanOrEqualTo(sellerCeiling)) {
    return {
      kind: "allowed",
      finalUnitPrice: finalUnitPrice.toDecimalPlaces(6).toString(),
      discountPercent: requested.toString(),
    };
  }

  if (requested.lessThanOrEqualTo(approvalCeiling)) {
    return {
      kind: "requires_approval",
      finalUnitPrice: finalUnitPrice.toDecimalPlaces(6).toString(),
      discountPercent: requested.toString(),
      ceilingPercent: sellerCeiling.toString(),
    };
  }

  return {
    kind: "rejected",
    reason: `Desconto acima do máximo permitido (${approvalCeiling.toString()}%).`,
    ceilingPercent: approvalCeiling.toString(),
  };
}

/** Total de uma linha, com arredondamento monetário explícito. */
export function lineTotal(unitPrice: string, quantity: string): string {
  const price = toDecimal(unitPrice);
  const qty = toDecimal(quantity);
  if (price === null || qty === null) return "0";
  // 2 casas, meio para cima — o arredondamento é decidido aqui, uma vez, e não
  // espalhado por cada tela.
  return price.times(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
}

export interface OrderTotalsInput {
  readonly lines: ReadonlyArray<{ readonly unitPrice: string; readonly quantity: string }>;
  readonly shipping?: string;
  readonly otherCosts?: string;
}

export interface OrderTotals {
  readonly subtotal: string;
  readonly shipping: string;
  readonly otherCosts: string;
  readonly total: string;
}

export function calculateTotals(input: OrderTotalsInput): OrderTotals {
  let subtotal = new Decimal(0);
  for (const line of input.lines) {
    subtotal = subtotal.plus(lineTotal(line.unitPrice, line.quantity));
  }

  const shipping = toDecimal(input.shipping ?? "0") ?? new Decimal(0);
  const otherCosts = toDecimal(input.otherCosts ?? "0") ?? new Decimal(0);

  return {
    subtotal: subtotal.toDecimalPlaces(2).toString(),
    shipping: shipping.toDecimalPlaces(2).toString(),
    otherCosts: otherCosts.toDecimalPlaces(2).toString(),
    total: subtotal
      .plus(shipping)
      .plus(otherCosts)
      .toDecimalPlaces(2)
      .toString(),
  };
}

import { Decimal } from "decimal.js";

/**
 * Cálculo do estoque disponível para venda (briefing §7).
 *
 * O briefing é explícito: "não invente a fórmula de estoque disponível" e "a
 * regra deve ser configurável porque cada empresa pode interpretar
 * disponibilidade comercial de forma diferente".
 *
 * Por isso este módulo **não decide** qual fórmula é certa — ele implementa as
 * fórmulas possíveis e aplica a que a organização configurou. Aritmética em
 * Decimal, nunca float: um erro de arredondamento aqui vira venda a mais ou a
 * menos.
 */

export type AvailableStockRule =
  /** Usa o `nDisponivel` que o próprio Omie calcula (docs/omie-api-mapping.md §4). */
  | "OMIE_CALCULATED"
  | "PHYSICAL"
  | "BALANCE"
  | "PHYSICAL_MINUS_RESERVED"
  | "BALANCE_MINUS_PENDING"
  | "CUSTOM";

/** Componentes crus vindos da Omie. `null` significa "não informado". */
export interface StockComponents {
  readonly physical: string | null;
  readonly reserved: string | null;
  /** Saída prevista — pedidos ainda não faturados. */
  readonly expectedOut: string | null;
  readonly expectedIn: string | null;
  /** `nDisponivel`, quando o serviço consultado o fornece. */
  readonly omieAvailable: string | null;
}

export interface AvailabilityConfig {
  readonly rule: AvailableStockRule;
  /** Margem de segurança subtraída do resultado. Nunca deixa o exibido negativo. */
  readonly safetyMargin: string;
}

export interface AvailabilityResult {
  /** Quantidade exibida ao vendedor, já com margem aplicada e piso em zero. */
  readonly displayed: string;
  /** Resultado da fórmula, antes da margem — útil para diagnóstico e auditoria. */
  readonly computed: string;
  /** `true` quando a fórmula não pôde ser aplicada por falta de dado. */
  readonly indeterminate: boolean;
  /** Qual regra produziu o valor, para a UI poder explicar o número. */
  readonly rule: AvailableStockRule;
}

function toDecimal(value: string | null): Decimal | null {
  if (value === null || value.trim() === "") return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

/**
 * Aplica a fórmula configurada.
 *
 * Devolve `null` quando falta um componente essencial. Tratar dado ausente como
 * zero seria pior que admitir a ignorância: exibiria "0 disponível" para um
 * produto que pode ter estoque, ou — no caso de `reserved` ausente — exibiria o
 * físico inteiro como vendável.
 */
function applyRule(
  rule: AvailableStockRule,
  components: StockComponents,
): Decimal | null {
  const physical = toDecimal(components.physical);
  const reserved = toDecimal(components.reserved);
  const expectedOut = toDecimal(components.expectedOut);
  const omieAvailable = toDecimal(components.omieAvailable);

  switch (rule) {
    case "OMIE_CALCULATED":
      return omieAvailable;

    case "PHYSICAL":
      return physical;

    case "BALANCE":
      // "Saldo" na Omie é o consolidado; quando o serviço consultado não o
      // fornece separadamente, o disponível calculado é o equivalente mais
      // próximo — e é melhor usá-lo do que inventar uma soma.
      return omieAvailable ?? physical;

    case "PHYSICAL_MINUS_RESERVED":
      if (physical === null || reserved === null) return null;
      return physical.minus(reserved);

    case "BALANCE_MINUS_PENDING": {
      const base = physical;
      if (base === null || expectedOut === null) return null;
      return base.minus(expectedOut);
    }

    case "CUSTOM":
      // Regra customizada ainda não tem implementação: em vez de silenciosamente
      // cair numa fórmula qualquer, declara-se indeterminada. Ver
      // docs/known-limitations.md.
      return null;
  }
}

export function calculateAvailability(
  components: StockComponents,
  config: AvailabilityConfig,
): AvailabilityResult {
  const computed = applyRule(config.rule, components);

  if (computed === null) {
    return {
      displayed: "0",
      computed: "0",
      indeterminate: true,
      rule: config.rule,
    };
  }

  const margin = toDecimal(config.safetyMargin) ?? new Decimal(0);

  // Piso em zero: disponível negativo não é informação útil para o vendedor e
  // sugeriria que dá para vender "menos que nada".
  const displayed = Decimal.max(0, computed.minus(margin));

  return {
    displayed: displayed.toString(),
    computed: computed.toString(),
    indeterminate: false,
    rule: config.rule,
  };
}

/**
 * Consolida várias posições (um produto em vários depósitos) num total.
 *
 * Considera apenas locais disponíveis para venda: contar um depósito de
 * remessa ou de terceiros no total vendável levaria a overselling direto.
 * Posições indeterminadas são excluídas do total e sinalizadas, em vez de
 * entrarem como zero.
 */
export function consolidateAvailability(
  positions: ReadonlyArray<{
    readonly components: StockComponents;
    readonly availableForSale: boolean;
  }>,
  config: AvailabilityConfig,
): { readonly total: string; readonly hasIndeterminate: boolean } {
  let total = new Decimal(0);
  let hasIndeterminate = false;

  for (const position of positions) {
    if (!position.availableForSale) continue;

    const result = calculateAvailability(position.components, config);
    if (result.indeterminate) {
      hasIndeterminate = true;
      continue;
    }
    total = total.plus(result.displayed);
  }

  return { total: total.toString(), hasIndeterminate };
}

/**
 * Idade do dado de estoque, para o indicador de "possivelmente desatualizado"
 * exigido pelo briefing §7.
 */
export function isStockStale(readAt: Date, maxAgeSeconds: number, now = new Date()): boolean {
  return (now.getTime() - readAt.getTime()) / 1000 > maxAgeSeconds;
}

export function stockAgeSeconds(readAt: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - readAt.getTime()) / 1000));
}

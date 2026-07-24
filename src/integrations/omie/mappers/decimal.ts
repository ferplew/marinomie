/**
 * Conversão de números da Omie para string decimal.
 *
 * A Omie devolve valores monetários e quantidades como `number` em JSON. Passar
 * esse `number` adiante e só convertê-lo no banco arriscaria perder precisão em
 * preço e quantidade. Convertemos na fronteira, uma única vez, para string —
 * que é o que o `Decimal` do Prisma aceita sem intermediário de ponto flutuante.
 */
export function toDecimalString(
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  // `toString()` de um number já é a representação decimal mais curta que
  // preserva o valor; não arredondamos aqui para não inventar precisão.
  return value.toString();
}

/** Converte string decimal de volta para número, apenas para exibição. */
export function decimalStringToNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

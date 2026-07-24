/**
 * Catálogo fixo de permissões granulares (docs/permissions.md §2).
 *
 * É a única fonte da verdade sobre quais permissões existem. O seed popula a
 * tabela `Permission` a partir daqui, e `PermissionKey` garante em tempo de
 * compilação que nenhum caso de uso exija uma permissão inexistente.
 */
export const PERMISSIONS = [
  "users.read",
  "users.create",
  "users.update",
  "users.disable",
  "products.read",
  "products.view_cost",
  "products.view_physical_stock",
  "products.view_reserved_stock",
  "customers.read_all",
  "customers.read_own",
  "customers.create",
  "customers.update",
  "quotes.create",
  "quotes.read_all",
  "quotes.read_own",
  "quotes.update",
  "quotes.cancel",
  "quotes.convert",
  "orders.create",
  "orders.read_all",
  "orders.read_own",
  "orders.update",
  "orders.cancel",
  "orders.create_on_behalf",
  "discounts.apply",
  "discounts.approve",
  "prices.override",
  "integrations.read",
  "integrations.configure",
  "integrations.sync",
  "integrations.retry",
  "audit.read",
  "reports.read",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_SET.has(value);
}

/**
 * Pares (permissão ampla, permissão restrita) usados para resolver escopo de
 * leitura. Se o usuário tem a ampla, vê tudo da organização; se tem só a
 * restrita, vê apenas os próprios registros.
 */
export const SCOPED_READ_PAIRS = {
  customers: { all: "customers.read_all", own: "customers.read_own" },
  quotes: { all: "quotes.read_all", own: "quotes.read_own" },
  orders: { all: "orders.read_all", own: "orders.read_own" },
} as const satisfies Record<string, { all: PermissionKey; own: PermissionKey }>;

export type ScopedResource = keyof typeof SCOPED_READ_PAIRS;

import type { PermissionKey } from "./catalog";
import { PERMISSIONS } from "./catalog";

/**
 * Perfis padrão criados pelo seed (docs/permissions.md §1).
 *
 * São um ponto de partida, não um limite: administradores podem compor papéis
 * customizados a partir do catálogo, e a autorização em runtime sempre lê as
 * permissões efetivas do banco — nunca deduz permissão a partir do nome do perfil.
 */
export const DEFAULT_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "GERENTE_COMERCIAL",
  "VENDEDOR",
  "CONSULTA",
] as const;

export type DefaultRoleName = (typeof DEFAULT_ROLES)[number];

const ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  "users.read",
  "users.create",
  "users.update",
  "users.disable",
  "products.read",
  "products.view_cost",
  "products.view_physical_stock",
  "products.view_reserved_stock",
  "customers.read_all",
  "customers.create",
  "customers.update",
  "quotes.create",
  "quotes.read_all",
  "quotes.update",
  "quotes.cancel",
  "quotes.convert",
  "orders.create",
  "orders.read_all",
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
];

const GERENTE_PERMISSIONS: readonly PermissionKey[] = [
  "products.read",
  "products.view_physical_stock",
  "products.view_reserved_stock",
  "customers.read_all",
  "customers.create",
  "customers.update",
  "quotes.create",
  "quotes.read_all",
  "quotes.update",
  "quotes.cancel",
  "quotes.convert",
  "orders.create",
  "orders.read_all",
  "orders.cancel",
  "discounts.apply",
  "discounts.approve",
  "reports.read",
];

const VENDEDOR_PERMISSIONS: readonly PermissionKey[] = [
  "products.read",
  "customers.read_own",
  "customers.create",
  "customers.update",
  "quotes.create",
  "quotes.read_own",
  "quotes.update",
  "quotes.cancel",
  "quotes.convert",
  "orders.create",
  "orders.read_own",
  "discounts.apply",
];

const CONSULTA_PERMISSIONS: readonly PermissionKey[] = [
  "products.read",
  "customers.read_own",
  "quotes.read_own",
  "orders.read_own",
];

export const DEFAULT_ROLE_PERMISSIONS: Record<
  DefaultRoleName,
  readonly PermissionKey[]
> = {
  // SUPER_ADMIN recebe o catálogo inteiro — inclusive permissões futuras,
  // porque a lista é derivada de PERMISSIONS em vez de escrita à mão.
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  GERENTE_COMERCIAL: GERENTE_PERMISSIONS,
  VENDEDOR: VENDEDOR_PERMISSIONS,
  CONSULTA: CONSULTA_PERMISSIONS,
};

export const ROLE_DESCRIPTIONS: Record<DefaultRoleName, string> = {
  SUPER_ADMIN: "Administra toda a plataforma e todas as organizações.",
  ADMIN: "Configura a organização, usuários, vendedores e a integração Omie.",
  GERENTE_COMERCIAL:
    "Acompanha a equipe, aprova descontos e visualiza clientes e pedidos da equipe.",
  VENDEDOR:
    "Consulta catálogo, estoque e preços permitidos; cria orçamentos e pedidos próprios.",
  CONSULTA: "Somente leitura de produtos, preços e estoques autorizados.",
};

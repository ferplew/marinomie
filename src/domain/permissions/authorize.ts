import { AppError } from "@/lib/errors";
import type { PermissionKey, ScopedResource } from "./catalog";
import { SCOPED_READ_PAIRS } from "./catalog";

/**
 * Núcleo puro de autorização (docs/permissions.md §4).
 *
 * Sem dependência de banco, sessão ou framework — de propósito: é o que permite
 * testar exaustivamente as regras e reutilizá-las em Server Actions, Route
 * Handlers e workers sem duplicar lógica.
 */

/** Identidade já resolvida no servidor. Nunca construída a partir do navegador. */
export interface ActorContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly permissions: ReadonlySet<PermissionKey>;
  /** SellerLink do usuário, quando existir. Ausente para admins sem vínculo. */
  readonly sellerLinkId: string | null;
  readonly active: boolean;
}

export function hasPermission(actor: ActorContext, permission: PermissionKey): boolean {
  if (!actor.active) return false;
  return actor.permissions.has(permission);
}

export function hasAnyPermission(
  actor: ActorContext,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.some((p) => hasPermission(actor, p));
}

export function hasAllPermissions(
  actor: ActorContext,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.every((p) => hasPermission(actor, p));
}

/**
 * Lança FORBIDDEN se o ator não tiver a permissão. Usado como guarda no início
 * de todo caso de uso — nunca como verificação apenas de UI.
 */
export function assertPermission(
  actor: ActorContext,
  permission: PermissionKey,
): void {
  if (!actor.active) {
    throw new AppError("FORBIDDEN", `Usuário inativo: ${actor.userId}`);
  }
  if (!actor.permissions.has(permission)) {
    throw new AppError(
      "FORBIDDEN",
      `Permissão ausente: ${permission} (usuário ${actor.userId})`,
    );
  }
}

/**
 * Escopo de leitura resolvido a partir das permissões.
 * - "all": vê todos os registros da organização.
 * - "own": vê apenas os registros do próprio vendedor.
 * - "none": não pode ler o recurso.
 */
export type ReadScope =
  | { kind: "all" }
  | { kind: "own"; sellerLinkId: string }
  | { kind: "none" };

/**
 * Resolve o escopo de leitura de um recurso. O resultado é aplicado como filtro
 * na camada de repositório (nunca como pós-filtro em memória), para que um bug
 * de UI não consiga vazar registros de outro vendedor.
 */
export function resolveReadScope(
  actor: ActorContext,
  resource: ScopedResource,
): ReadScope {
  if (!actor.active) return { kind: "none" };

  const pair = SCOPED_READ_PAIRS[resource];

  if (actor.permissions.has(pair.all)) return { kind: "all" };

  if (actor.permissions.has(pair.own)) {
    // Ter "read_own" sem vínculo de vendedor não pode virar acesso amplo:
    // sem SellerLink não há "próprio" a filtrar, então não há o que ler.
    if (!actor.sellerLinkId) return { kind: "none" };
    return { kind: "own", sellerLinkId: actor.sellerLinkId };
  }

  return { kind: "none" };
}

/** Versão que lança em vez de devolver "none". */
export function assertReadScope(
  actor: ActorContext,
  resource: ScopedResource,
): Exclude<ReadScope, { kind: "none" }> {
  const scope = resolveReadScope(actor, resource);
  if (scope.kind === "none") {
    throw new AppError(
      "FORBIDDEN",
      `Sem escopo de leitura para ${resource} (usuário ${actor.userId})`,
    );
  }
  return scope;
}

/**
 * Determina qual vendedor deve ser gravado num orçamento/pedido.
 *
 * O identificador de vendedor NUNCA vem do navegador (docs/security.md §3):
 * por padrão é o vínculo do próprio usuário autenticado. Criar em nome de outro
 * vendedor exige `orders.create_on_behalf` e é sempre auditado pelo chamador.
 */
export function resolveSellerForWrite(
  actor: ActorContext,
  requestedSellerLinkId?: string | null,
): { sellerLinkId: string; onBehalf: boolean } {
  const isOnBehalf =
    !!requestedSellerLinkId && requestedSellerLinkId !== actor.sellerLinkId;

  if (isOnBehalf) {
    assertPermission(actor, "orders.create_on_behalf");
    return { sellerLinkId: requestedSellerLinkId, onBehalf: true };
  }

  if (!actor.sellerLinkId) {
    throw new AppError(
      "FORBIDDEN",
      `Usuário ${actor.userId} não possui vendedor vinculado`,
      {
        userMessage:
          "Seu usuário ainda não está vinculado a um vendedor do Omie. Peça ao administrador para configurar o vínculo.",
      },
    );
  }

  return { sellerLinkId: actor.sellerLinkId, onBehalf: false };
}

/**
 * Campos de produto/estoque que só podem ser serializados com permissão
 * (docs/permissions.md §3). Devolve a lista de campos permitidos para o ator —
 * o backend remove os demais antes de responder, em vez de escondê-los na UI.
 */
export function visibleStockFields(actor: ActorContext): {
  physical: boolean;
  reserved: boolean;
  cost: boolean;
} {
  return {
    physical: hasPermission(actor, "products.view_physical_stock"),
    reserved: hasPermission(actor, "products.view_reserved_stock"),
    cost: hasPermission(actor, "products.view_cost"),
  };
}

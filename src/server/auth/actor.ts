import "server-only";
import { headers } from "next/headers";
import { forbidden, unauthorized } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import type { ActorContext } from "@/domain/permissions/authorize";
import { assertPermission, hasAnyPermission } from "@/domain/permissions/authorize";
import type { PermissionKey } from "@/domain/permissions/catalog";
import { isPermissionKey } from "@/domain/permissions/catalog";

/**
 * Resolve o ator autenticado a partir da sessão (docs/security.md §2).
 *
 * As permissões são lidas do banco a cada requisição — nunca de um claim no
 * token. Isso é o que garante que revogar um papel tem efeito imediato, em vez
 * de esperar a sessão expirar.
 *
 * `cache()` do React deduplica a consulta dentro de uma mesma requisição: várias
 * chamadas a `requirePermission` numa mesma render não geram N queries.
 */
export const getActor = cache(async (): Promise<ActorContext | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      organizationId: true,
      active: true,
      deletedAt: true,
      lockedUntil: true,
      sellerLink: { select: { id: true, active: true } },
      userRoles: {
        select: {
          role: {
            select: {
              rolePermissions: {
                select: { permission: { select: { key: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!user || user.deletedAt) return null;

  const permissions = new Set<PermissionKey>();
  for (const { role } of user.userRoles) {
    for (const { permission } of role.rolePermissions) {
      // Permissão gravada no banco que não existe mais no catálogo é ignorada
      // silenciosamente aqui, mas nunca vira acesso — só desaparece.
      if (isPermissionKey(permission.key)) permissions.add(permission.key);
    }
  }

  const locked = user.lockedUntil !== null && user.lockedUntil > new Date();

  return {
    userId: user.id,
    organizationId: user.organizationId,
    permissions,
    // Um vínculo de vendedor inativo não concede escopo "own".
    sellerLinkId: user.sellerLink?.active ? user.sellerLink.id : null,
    active: user.active && !locked,
  };
});

/**
 * Guardas de página/layout.
 *
 * Estas funções usam `unauthorized()` e `forbidden()` do Next, que produzem
 * respostas HTTP 401 e 403 de verdade e renderizam `app/unauthorized.tsx` /
 * `app/forbidden.tsx`. Uma falta de permissão não é erro interno — devolver 500
 * confundiria monitoramento e usuário.
 *
 * Para Server Actions e código de domínio, use `assertPermission` /
 * `assertReadScope` de `@/domain/permissions/authorize`, que lançam `AppError` e
 * podem ser convertidos em `ActionResult`.
 */

/** Ator autenticado obrigatório. Interrompe com 401 se não houver sessão. */
export async function requireActor(): Promise<ActorContext> {
  const actor = await getActor();
  if (!actor) unauthorized();
  if (!actor.active) {
    logger.warn(
      { userId: actor.userId },
      "Acesso negado: usuário inativo ou bloqueado",
    );
    forbidden();
  }
  return actor;
}

/**
 * Guarda padrão de toda página/layout autenticado (docs/permissions.md §4).
 * Nunca substituída por checagem apenas no frontend.
 */
export async function requirePermission(
  permission: PermissionKey,
): Promise<ActorContext> {
  const actor = await requireActor();
  try {
    assertPermission(actor, permission);
  } catch {
    logger.warn(
      { userId: actor.userId, permission },
      "Acesso negado: permissão ausente",
    );
    forbidden();
  }
  return actor;
}

/**
 * Exige ao menos uma das permissões. Usada quando um recurso é acessível por
 * escopo amplo OU restrito — ex.: a tela de clientes serve tanto quem tem
 * `customers.read_all` quanto quem tem apenas `customers.read_own`. O escopo
 * efetivo dos dados é resolvido depois, por `resolveReadScope`.
 */
export async function requireAnyPermission(
  permissions: readonly PermissionKey[],
): Promise<ActorContext> {
  const actor = await requireActor();
  if (!hasAnyPermission(actor, permissions)) {
    logger.warn(
      { userId: actor.userId, permissions },
      "Acesso negado: nenhuma das permissões presentes",
    );
    forbidden();
  }
  return actor;
}

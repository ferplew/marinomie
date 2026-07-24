import { AppError } from "@/lib/errors";
import type { ActorContext, ReadScope } from "@/domain/permissions/authorize";

/**
 * Isolamento multiempresa na camada de dados (docs/security.md §6).
 *
 * Toda query de negócio passa por aqui. O `organizationId` vem SEMPRE do ator
 * autenticado — nunca de parâmetro de rota, corpo de requisição ou payload de
 * job. Um `where` sem organização é um bug de segurança, não de lógica, então a
 * função falha alto em vez de aceitar valor vazio.
 */

export type OrgScopedWhere<T extends Record<string, unknown>> = T & {
  organizationId: string;
};

export function orgScope<T extends Record<string, unknown>>(
  actor: Pick<ActorContext, "organizationId">,
  where: T = {} as T,
): OrgScopedWhere<T> {
  const organizationId = actor.organizationId;

  if (!organizationId || typeof organizationId !== "string") {
    throw new AppError("FORBIDDEN", "Consulta sem organização definida");
  }

  // Se o chamador tentou passar outro organizationId no `where`, isso é uma
  // tentativa (mesmo que acidental) de cruzar a fronteira entre organizações.
  const provided = (where as Record<string, unknown>)["organizationId"];
  if (provided !== undefined && provided !== organizationId) {
    throw new AppError(
      "FORBIDDEN",
      `Tentativa de acessar organização ${String(provided)} a partir de ${organizationId}`,
    );
  }

  return { ...where, organizationId };
}

/**
 * Combina o escopo de organização com o escopo de vendedor (`read_own`),
 * produzindo o `where` final do Prisma. O filtro por vendedor é aplicado na
 * query, não depois de carregar os registros.
 */
export function scopedWhere<T extends Record<string, unknown>>(
  actor: ActorContext,
  scope: ReadScope,
  where: T = {} as T,
  sellerField = "sellerLinkId",
): OrgScopedWhere<T> {
  if (scope.kind === "none") {
    throw new AppError("FORBIDDEN", "Sem escopo de leitura para esta consulta");
  }

  const base = orgScope(actor, where);

  if (scope.kind === "own") {
    return { ...base, [sellerField]: scope.sellerLinkId } as OrgScopedWhere<T>;
  }

  return base;
}

/**
 * Verifica que um registro já carregado pertence à organização do ator.
 * Rede de proteção para caminhos que buscam por ID único (onde o Prisma não
 * aceita filtro composto), evitando IDOR entre organizações.
 */
export function assertBelongsToOrg(
  actor: Pick<ActorContext, "organizationId">,
  record: { organizationId: string } | null,
  entity = "registro",
): void {
  if (!record) {
    throw new AppError("NOT_FOUND", `${entity} não encontrado`);
  }
  if (record.organizationId !== actor.organizationId) {
    // Responde NOT_FOUND de propósito: revelar FORBIDDEN confirmaria que o ID
    // existe em outra organização.
    throw new AppError(
      "NOT_FOUND",
      `${entity} pertence a outra organização (${record.organizationId})`,
    );
  }
}

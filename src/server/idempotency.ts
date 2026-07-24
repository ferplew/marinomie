import "server-only";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

/**
 * Idempotência de operações críticas (briefing §16 e §33).
 *
 * A proteção real contra duplo clique é a **constraint única no banco**
 * (`organizationId + scope + key`), não o botão desabilitado na UI. Este módulo
 * faz o "insere e vê quem ganhou": quem consegue inserir executa a operação;
 * quem colide recebe o resultado da primeira execução.
 */

const DEFAULT_TTL_HOURS = 24;

export type IdempotencyOutcome<T> =
  /** Esta chamada ganhou a corrida e deve executar a operação. */
  | { readonly kind: "proceed"; readonly recordId: string }
  /** Já executada antes: devolve o resultado guardado, sem repetir nada. */
  | { readonly kind: "replay"; readonly result: T }
  /** Uma execução simultânea está em andamento. */
  | { readonly kind: "in_progress" };

export async function beginIdempotentOperation<T>(input: {
  readonly organizationId: string;
  readonly scope: string;
  readonly key: string;
  readonly ttlHours?: number;
}): Promise<IdempotencyOutcome<T>> {
  const expiresAt = new Date(
    Date.now() + (input.ttlHours ?? DEFAULT_TTL_HOURS) * 3_600_000,
  );

  try {
    const created = await prisma.idempotencyKey.create({
      data: {
        organizationId: input.organizationId,
        scope: input.scope,
        key: input.key,
        status: "IN_PROGRESS",
        expiresAt,
      },
      select: { id: true },
    });

    return { kind: "proceed", recordId: created.id };
  } catch (error) {
    // P2002 = violação de unicidade: outra chamada chegou primeiro.
    if (!isUniqueViolation(error)) throw error;

    const existing = await prisma.idempotencyKey.findUnique({
      where: {
        organizationId_scope_key: {
          organizationId: input.organizationId,
          scope: input.scope,
          key: input.key,
        },
      },
      select: { status: true, result: true },
    });

    if (existing?.status === "COMPLETED" && existing.result !== null) {
      return { kind: "replay", result: existing.result as T };
    }

    // Registro existe mas ainda não concluiu: a operação está em voo. Devolver
    // "em andamento" é mais honesto que executar de novo e arriscar duplicar.
    return { kind: "in_progress" };
  }
}

export async function completeIdempotentOperation(
  recordId: string,
  result: unknown,
  entity?: { readonly type: string; readonly id: string },
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id: recordId },
    data: {
      status: "COMPLETED",
      result: result as Prisma.InputJsonValue,
      ...(entity ? { entityType: entity.type, entityId: entity.id } : {}),
    },
  });
}

/**
 * Marca a operação como falha e libera a chave.
 *
 * Deletar em vez de marcar "FAILED" é intencional: uma falha de validação deve
 * permitir que o usuário corrija e tente de novo com a mesma chave. O que nunca
 * pode ser liberado é uma escrita de **resultado incerto** — nesse caso o
 * chamador deve deixar a chave como está e consultar a Omie antes de reenviar.
 */
export async function releaseIdempotentOperation(recordId: string): Promise<void> {
  try {
    await prisma.idempotencyKey.delete({ where: { id: recordId } });
  } catch (error) {
    logger.warn({ recordId, err: String(error) }, "Falha ao liberar chave de idempotência");
  }
}

/** Mantém a chave reservada, sinalizando que o resultado é desconhecido. */
export async function markIdempotentOperationUncertain(
  recordId: string,
  detail: string,
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id: recordId },
    data: {
      status: "UNCERTAIN",
      result: { detail } as Prisma.InputJsonValue,
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

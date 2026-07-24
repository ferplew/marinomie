import type { OmieClient, OmieCredentials } from "../client/omie-client";
import type { RequestPriority } from "../client/rate-limiter";

/**
 * Contexto que todo service recebe.
 *
 * `organizationId` e `credentials` vêm sempre juntos e resolvidos no servidor:
 * nenhum service aceita credencial solta, o que impede que uma chamada acabe
 * usando a credencial de outra organização por descuido.
 */
export interface OmieServiceContext {
  readonly client: OmieClient;
  readonly organizationId: string;
  readonly credentials: OmieCredentials;
  readonly priority?: RequestPriority;
  readonly correlationId?: string;
}

/** Monta os campos comuns de uma chamada a partir do contexto. */
export function callBase(context: OmieServiceContext): {
  organizationId: string;
  credentials: OmieCredentials;
  priority?: RequestPriority;
  correlationId?: string;
} {
  return {
    organizationId: context.organizationId,
    credentials: context.credentials,
    ...(context.priority ? { priority: context.priority } : {}),
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
  };
}

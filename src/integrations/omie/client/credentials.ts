import "server-only";
import { prisma } from "@/server/db";
import { decryptSecret, encryptSecret, generateWebhookToken, secretHint } from "@/server/crypto";
import { getEnv } from "@/env";
import { AppError } from "@/lib/errors";
import type { OmieCredentials } from "./omie-client";

/**
 * Resolução das credenciais Omie de uma organização.
 *
 * Ordem de precedência, e o motivo de cada passo:
 *
 * 1. **Banco** (`OmieCredential`, criptografado) — a fonte correta. Multiempresa
 *    exige credencial por organização, e variável de ambiente é global por
 *    natureza.
 * 2. **Variáveis de ambiente** — apenas fora de produção, como conveniência de
 *    desenvolvimento local. Em produção isso é recusado explicitamente: um
 *    ambiente multiempresa que caísse na credencial global usaria a conta Omie
 *    errada, o que é pior do que falhar.
 */
export async function resolveOmieCredentials(
  organizationId: string,
): Promise<OmieCredentials> {
  const stored = await prisma.omieCredential.findUnique({
    where: { organizationId },
    select: {
      appKeyEncrypted: true,
      appSecretEncrypted: true,
      active: true,
    },
  });

  if (stored) {
    if (!stored.active) {
      throw new AppError(
        "INTEGRATION_ERROR",
        `Integração pausada para a organização ${organizationId}`,
        {
          userMessage:
            "A integração com o Omie está pausada. Procure o administrador.",
        },
      );
    }

    return {
      appKey: decryptSecret(stored.appKeyEncrypted),
      appSecret: decryptSecret(stored.appSecretEncrypted),
    };
  }

  const env = getEnv();

  if (env.NODE_ENV === "production") {
    throw new AppError(
      "INTEGRATION_ERROR",
      `Organização ${organizationId} sem credencial Omie configurada`,
      {
        userMessage:
          "A integração com o Omie ainda não foi configurada. Procure o administrador.",
      },
    );
  }

  if (env.OMIE_APP_KEY && env.OMIE_APP_SECRET) {
    return { appKey: env.OMIE_APP_KEY, appSecret: env.OMIE_APP_SECRET };
  }

  if (env.OMIE_MOCK_MODE) {
    // O transporte mock ignora o valor, mas exige que não seja vazio — assim o
    // caminho de credencial é exercitado mesmo em modo mock.
    return { appKey: "mock-app-key", appSecret: "mock-app-secret" };
  }

  throw new AppError(
    "INTEGRATION_ERROR",
    `Organização ${organizationId} sem credencial Omie e sem OMIE_APP_KEY em ambiente de desenvolvimento`,
    {
      userMessage:
        "Nenhuma credencial do Omie configurada. Configure a integração ou ative OMIE_MOCK_MODE.",
    },
  );
}

export interface SaveCredentialInput {
  readonly organizationId: string;
  readonly appKey: string;
  readonly appSecret: string;
}

export interface SaveCredentialResult {
  readonly appKeyHint: string;
  readonly created: boolean;
}

/**
 * Grava as credenciais cifradas.
 *
 * `appKeyHint` guarda apenas os 4 últimos dígitos, para o administrador
 * reconhecer qual credencial está ativa sem que o valor completo saia do
 * servidor. O token do webhook é gerado na criação e **preservado** em
 * atualizações — regenerá-lo silenciosamente quebraria o webhook já configurado
 * no portal da Omie.
 */
export async function saveOmieCredentials(
  input: SaveCredentialInput,
): Promise<SaveCredentialResult> {
  const appKeyEncrypted = encryptSecret(input.appKey);
  const appSecretEncrypted = encryptSecret(input.appSecret);
  const appKeyHint = secretHint(input.appKey);

  const existing = await prisma.omieCredential.findUnique({
    where: { organizationId: input.organizationId },
    select: { id: true },
  });

  await prisma.omieCredential.upsert({
    where: { organizationId: input.organizationId },
    update: {
      appKeyEncrypted,
      appSecretEncrypted,
      appKeyHint,
      // Salvar credencial nova invalida o resultado do último teste.
      lastTestedAt: null,
      lastTestResult: null,
    },
    create: {
      organizationId: input.organizationId,
      appKeyEncrypted,
      appSecretEncrypted,
      appKeyHint,
      webhookSecretToken: generateWebhookToken(),
    },
  });

  return { appKeyHint, created: existing === null };
}

export async function recordConnectionTest(
  organizationId: string,
  result: { ok: boolean; detail: string },
): Promise<void> {
  await prisma.omieCredential.update({
    where: { organizationId },
    data: {
      lastTestedAt: new Date(),
      // Truncado: é um campo de exibição, não um log.
      lastTestResult: `${result.ok ? "OK" : "FALHA"}: ${result.detail}`.slice(0, 500),
    },
  });
}

export async function setIntegrationActive(
  organizationId: string,
  active: boolean,
): Promise<void> {
  await prisma.omieCredential.update({
    where: { organizationId },
    data: { active },
  });
}

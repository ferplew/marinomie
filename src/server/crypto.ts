import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "@/env";

/**
 * Criptografia simétrica das credenciais Omie em repouso (docs/security.md §4).
 *
 * AES-256-GCM: além de cifrar, autentica — um valor adulterado no banco falha na
 * verificação da tag em vez de decifrar para lixo silenciosamente.
 *
 * Formato do texto cifrado: `v1:<base64(iv || authTag || ciphertext)>`
 * O prefixo de versão existe para permitir rotação de algoritmo depois sem
 * precisar adivinhar como cada registro antigo foi gerado.
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, recomendado para GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const key = Buffer.from(getEnv().ENCRYPTION_KEY, "hex");
  if (key.length !== KEY_LENGTH) {
    // O schema de env já valida o formato; isto protege contra alteração futura.
    throw new Error("ENCRYPTION_KEY deve ter 32 bytes.");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    throw new Error("Não é possível cifrar um valor vazio.");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${VERSION}:${Buffer.concat([iv, authTag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const separator = payload.indexOf(":");
  if (separator === -1) {
    throw new Error("Texto cifrado em formato inválido.");
  }

  const version = payload.slice(0, separator);
  if (version !== VERSION) {
    throw new Error(`Versão de criptografia não suportada: ${version}`);
  }

  const raw = Buffer.from(payload.slice(separator + 1), "base64");
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Texto cifrado truncado.");
  }

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  // `final()` lança se a tag não confere — é aqui que adulteração é detectada.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Dica de exibição de um segredo: apenas os últimos 4 caracteres.
 * Usada no painel administrativo para o administrador reconhecer qual
 * credencial está configurada sem que o valor completo saia do servidor.
 */
export function secretHint(plaintext: string, visible = 4): string {
  return plaintext.length <= visible
    ? "*".repeat(plaintext.length)
    : plaintext.slice(-visible);
}

/**
 * Comparação de strings em tempo constante, para tokens (ex.: o segredo na URL
 * do webhook). Uma comparação com `===` vaza informação pelo tempo de resposta.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Token opaco para a URL de webhook da organização. */
export function generateWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

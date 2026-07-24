import { createAuthClient } from "better-auth/react";

/**
 * Client de autenticação usado apenas por Client Components.
 * Não carrega nenhum segredo: fala com /api/auth do próprio servidor.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;

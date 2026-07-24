import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

/**
 * Handlers criados por requisição, não no import.
 *
 * `toNextJsHandler(auth)` no topo do módulo resolveria a instância do Better
 * Auth durante o `next build` — que é justamente o que exigia as variáveis de
 * ambiente em tempo de build e quebrava o deploy.
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}

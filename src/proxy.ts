import { NextResponse, type NextRequest } from "next/server";

/**
 * Verificação otimista de sessão na borda (convenção `proxy` do Next 16, que
 * substituiu `middleware`).
 *
 * IMPORTANTE: isto NÃO é controle de acesso. O proxy apenas evita um flash de
 * tela protegida para quem claramente não tem cookie de sessão. A autorização
 * real acontece no servidor, em cada layout/rota, via `requireActor` e
 * `requirePermission` (docs/security.md §2) — que consultam banco e permissões
 * efetivas. Um cookie forjado passa por aqui e é barrado lá.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/ready",
  // O webhook autentica pelo token na própria URL, não por sessão.
  "/api/webhooks",
];

export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const hasSessionCookie =
    request.cookies.has("marinomie.session_token") ||
    request.cookies.has("__Secure-marinomie.session_token");

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Todas as rotas exceto assets estáticos do Next e arquivos com extensão.
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

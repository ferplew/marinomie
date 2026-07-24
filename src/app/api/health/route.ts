import { NextResponse } from "next/server";

/**
 * Liveness probe (docs/security.md §9).
 *
 * Intencionalmente não toca em banco, Redis ou Omie: responde se o processo
 * está vivo. Nenhuma versão de dependência, string de conexão ou detalhe
 * interno é exposto.
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

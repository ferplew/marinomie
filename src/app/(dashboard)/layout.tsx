import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";
import { hasAnyPermission } from "@/domain/permissions/authorize";
import { BottomNav, type NavItem } from "@/components/nav/bottom-nav";
import { SignOutButton } from "@/components/nav/sign-out-button";

/**
 * Shell da área do vendedor — mobile-first (briefing §22).
 *
 * A navegação é montada no servidor a partir das permissões efetivas: itens sem
 * permissão não são renderizados. Isso é conveniência de UX, não controle de
 * acesso — cada rota revalida a permissão por conta própria.
 *
 * `force-dynamic` é explícito: toda página aqui depende de sessão e banco por
 * requisição, nunca deve ser pré-renderizada em build. Reforça a proteção que
 * já existe via `headers()` dentro de `getActor`.
 */
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const items: NavItem[] = [
    { href: "/inicio", label: "Início", icon: "home" },
    ...(hasAnyPermission(actor, ["products.read"])
      ? ([{ href: "/produtos", label: "Produtos", icon: "package" }] as const)
      : []),
    ...(hasAnyPermission(actor, ["customers.read_all", "customers.read_own"])
      ? ([{ href: "/clientes", label: "Clientes", icon: "users" }] as const)
      : []),
    ...(hasAnyPermission(actor, ["quotes.read_all", "quotes.read_own"])
      ? ([{ href: "/orcamentos", label: "Orçamentos", icon: "file" }] as const)
      : []),
    ...(hasAnyPermission(actor, ["orders.read_all", "orders.read_own"])
      ? ([{ href: "/pedidos", label: "Pedidos", icon: "cart" }] as const)
      : []),
    ...(hasAnyPermission(actor, ["discounts.approve"])
      ? ([{ href: "/aprovacoes", label: "Aprovações", icon: "check" }] as const)
      : []),
  ];

  const isAdmin = hasAnyPermission(actor, ["integrations.read", "users.read"]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background px-4">
        <span className="font-semibold tracking-tight">marinomie</span>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <a href="/admin" className="text-sm text-primary">
              Admin
            </a>
          )}
          <SignOutButton />
        </div>
      </header>

      {/* pb-20 reserva o espaço da barra inferior fixa. */}
      <main className="flex-1 px-4 pb-20 pt-4">{children}</main>

      <BottomNav items={items} />
    </div>
  );
}

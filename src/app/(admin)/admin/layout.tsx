import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";
import { hasAnyPermission, hasPermission } from "@/domain/permissions/authorize";

/**
 * Shell do painel administrativo.
 *
 * O layout já barra quem não tem nenhuma permissão administrativa, mas isso é
 * apenas a primeira camada: cada página administrativa exige a sua própria
 * permissão específica via `requirePermission` (docs/permissions.md §4).
 *
 * `force-dynamic` explícito pelo mesmo motivo do shell do vendedor: nada aqui
 * pode ser pré-renderizado em build.
 */
export const dynamic = "force-dynamic";
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const canSeeAdmin = hasAnyPermission(actor, [
    "users.read",
    "integrations.read",
    "audit.read",
  ]);
  if (!canSeeAdmin) redirect("/inicio");

  // `as const` mantém os href como literais, exigido por `typedRoutes`.
  const links = (
    [
      { href: "/admin", label: "Visão geral", show: true },
      {
        href: "/admin/usuarios",
        label: "Usuários",
        show: hasPermission(actor, "users.read"),
      },
      {
        href: "/admin/vendedores",
        label: "Vendedores",
        show: hasPermission(actor, "users.read"),
      },
      {
        href: "/admin/integracoes",
        label: "Integrações",
        show: hasPermission(actor, "integrations.read"),
      },
      {
        href: "/admin/sincronizacoes",
        label: "Sincronizações",
        show: hasPermission(actor, "integrations.read"),
      },
      {
        href: "/admin/webhooks",
        label: "Webhooks",
        show: hasPermission(actor, "integrations.read"),
      },
      {
        href: "/admin/auditoria",
        label: "Auditoria",
        show: hasPermission(actor, "audit.read"),
      },
    ] as const
  ).filter((link) => link.show);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="font-semibold tracking-tight">Administração</span>
          <Link href="/inicio" className="text-sm text-primary">
            Voltar ao app
          </Link>
        </div>
        <nav aria-label="Navegação administrativa" className="overflow-x-auto px-4 pb-2">
          <ul className="flex gap-4 whitespace-nowrap">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-muted-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}

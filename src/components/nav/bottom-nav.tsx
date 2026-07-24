"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type NavIcon = "home" | "package" | "users" | "file" | "cart";

/**
 * `href` reusa o tipo do próprio `Link` para respeitar `typedRoutes`: uma rota
 * inexistente vira erro de compilação em vez de link quebrado em produção.
 */
export type NavHref = React.ComponentProps<typeof Link>["href"];

export interface NavItem {
  href: NavHref;
  label: string;
  icon: NavIcon;
}

/** Ícones inline: evitam uma dependência extra e mantêm o bundle pequeno. */
const ICON_PATHS: Record<NavIcon, string> = {
  home: "M3 10.5 12 3l9 7.5M5.25 9.75V21h13.5V9.75",
  package: "M3.75 7.5 12 3l8.25 4.5v9L12 21l-8.25-4.5v-9ZM12 12l8.25-4.5M12 12v9M12 12 3.75 7.5",
  users:
    "M15 19.5a6 6 0 0 0-12 0M9 11.25a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM21 19.5a5.25 5.25 0 0 0-4.5-5.2M16.5 11.1a3.75 3.75 0 0 0 0-7.2",
  file: "M14.25 3v5.25H19.5M14.25 3H6.75v18h10.5V8.25L14.25 3Z",
  cart: "M3 3h2.25l2.4 12h9.9l2.1-8.25H6M9.75 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm8.25 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z",
};

/**
 * Barra de navegação inferior — o padrão esperado num app usado a maior parte
 * do tempo em celular, com uma mão (briefing §22).
 */
export function BottomNav({ items }: { items: NavItem[] }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex items-stretch justify-around">
        {items.map((item) => {
          const href = String(item.href);
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5"
                >
                  <path d={ICON_PATHS[item.icon]} />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

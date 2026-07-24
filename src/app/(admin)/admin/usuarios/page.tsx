import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { Card, CardContent, EmptyState } from "@/components/ui/card";

export const metadata: Metadata = { title: "Usuários · marinomie" };

/**
 * Listagem de usuários da organização.
 *
 * `requirePermission` roda antes de qualquer consulta: sem `users.read` a
 * página lança FORBIDDEN em vez de renderizar e esconder dados.
 */
export default async function AdminUsersPage(): Promise<React.JSX.Element> {
  const actor = await requirePermission("users.read");

  const users = await prisma.user.findMany({
    where: orgScope(actor, { deletedAt: null }),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      lockedUntil: true,
      lastLoginAt: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });

  const now = new Date();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Usuários</h1>

      {users.length === 0 ? (
        <EmptyState
          title="Nenhum usuário"
          description="Nenhum usuário cadastrado nesta organização."
        />
      ) : (
        <ul className="space-y-2">
          {users.map((user) => {
            const locked = user.lockedUntil !== null && user.lockedUntil > now;
            return (
              <li key={user.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{user.name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {user.email}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {user.userRoles.map((ur) => ur.role.name).join(", ") ||
                            "sem perfil atribuído"}
                        </p>
                      </div>
                      <span
                        className={
                          user.active && !locked
                            ? "shrink-0 text-xs text-[color:var(--color-success)]"
                            : "shrink-0 text-xs text-destructive"
                        }
                      >
                        {locked ? "bloqueado" : user.active ? "ativo" : "inativo"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Criar, editar e desativar usuários pela interface entra junto com o
        gerenciamento completo de permissões. Hoje os usuários são criados pelo
        seed ou diretamente no banco.
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { hasPermission } from "@/domain/permissions/authorize";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { SyncTriggers } from "./sync-triggers";

export const metadata: Metadata = { title: "Sincronizações · marinomie" };

/**
 * Painel de sincronizações (briefing §30).
 *
 * Mostra o histórico do Postgres, não o estado da fila no Redis: a fila tem
 * retenção curta e some depois do processamento, enquanto o administrador
 * precisa ver o que aconteceu ontem.
 */
export default async function SyncPanelPage(): Promise<React.JSX.Element> {
  const actor = await requirePermission("integrations.read");

  const [jobs, counts] = await Promise.all([
    prisma.syncJob.findMany({
      where: orgScope(actor),
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        queue: true,
        entityType: true,
        status: true,
        attempts: true,
        totalFetched: true,
        totalChanged: true,
        cursor: true,
        error: true,
        triggeredBy: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
    prisma.syncJob.groupBy({
      by: ["status"],
      where: orgScope(actor),
      _count: true,
    }),
  ]);

  const byStatus = new Map(counts.map((c) => [c.status, c._count]));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Sincronizações</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Na fila" value={byStatus.get("QUEUED") ?? 0} />
        <StatCard label="Executando" value={byStatus.get("RUNNING") ?? 0} />
        <StatCard label="Falhas" value={byStatus.get("FAILED") ?? 0} tone="error" />
        <StatCard
          label="Dead-letter"
          value={byStatus.get("DEAD_LETTER") ?? 0}
          tone="error"
        />
      </div>

      {hasPermission(actor, "integrations.sync") && <SyncTriggers />}

      <Card>
        <CardHeader>
          <CardTitle>Execuções recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.length === 0 ? (
            <EmptyState
              title="Nenhuma sincronização"
              description="Dispare uma sincronização para ver o histórico aqui."
            />
          ) : (
            jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-[var(--radius)] border border-border p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{job.queue}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.entityType} · origem {job.triggeredBy ?? "—"} ·{" "}
                      {job.createdAt.toLocaleString("pt-BR")}
                    </p>
                    {job.error && (
                      <p className="mt-1 text-xs text-destructive">{job.error}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <p className={statusClass(job.status)}>{job.status}</p>
                    <p className="text-muted-foreground">
                      {job.totalFetched} lidos · {job.totalChanged} alterados
                    </p>
                    {job.cursor !== null && (
                      <p className="text-muted-foreground">página {job.cursor}</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "error";
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            tone === "error" && value > 0
              ? "text-2xl font-semibold text-destructive"
              : "text-2xl font-semibold"
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function statusClass(status: string): string {
  if (status === "COMPLETED") return "text-[color:var(--color-success)]";
  if (status === "FAILED" || status === "DEAD_LETTER") return "text-destructive";
  if (status === "RUNNING") return "text-[color:var(--color-warning)]";
  return "text-muted-foreground";
}

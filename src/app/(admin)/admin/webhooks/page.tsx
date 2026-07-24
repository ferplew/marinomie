import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { orgScope } from "@/server/scope";
import { getEnv } from "@/env";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { WebhookUrlPanel } from "./webhook-url-panel";

export const metadata: Metadata = { title: "Webhooks · marinomie" };

/**
 * Painel de webhooks (briefing §30).
 *
 * Mostra a URL a cadastrar no portal da Omie e os eventos recebidos, incluindo
 * duplicados e os que ainda não têm handler específico — que são justamente os
 * que revelam quais tópicos a Omie realmente envia
 * (docs/known-limitations.md §1, item 1).
 */
export default async function WebhooksPage(): Promise<React.JSX.Element> {
  const actor = await requirePermission("integrations.read");

  const [credential, events, counts, topics] = await Promise.all([
    prisma.omieCredential.findUnique({
      where: { organizationId: actor.organizationId },
      select: { webhookSecretToken: true },
    }),
    prisma.webhookEvent.findMany({
      where: orgScope(actor),
      orderBy: { receivedAt: "desc" },
      take: 30,
      select: {
        id: true,
        topic: true,
        status: true,
        receivedAt: true,
        processedAt: true,
        attempts: true,
        lastError: true,
        sourceIp: true,
      },
    }),
    prisma.webhookEvent.groupBy({
      by: ["status"],
      where: orgScope(actor),
      _count: true,
    }),
    // Tópicos observados: é a lista que a documentação pública não fornece.
    prisma.webhookEvent.groupBy({
      by: ["topic"],
      where: orgScope(actor),
      _count: true,
    }),
  ]);

  const byStatus = new Map(counts.map((c) => [c.status, c._count]));
  const baseUrl = getEnv().APP_URL;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Webhooks</h1>

      <WebhookUrlPanel
        url={
          credential
            ? `${baseUrl}/api/webhooks/omie/${actor.organizationId}/${credential.webhookSecretToken}`
            : null
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Recebidos" value={byStatus.get("RECEIVED") ?? 0} />
        <StatCard label="Processados" value={byStatus.get("PROCESSED") ?? 0} />
        <StatCard label="Duplicados" value={byStatus.get("DUPLICATE") ?? 0} />
        <StatCard label="Falhas" value={byStatus.get("FAILED") ?? 0} />
      </div>

      {topics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tópicos observados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {topics.map((topic) => (
              <p key={topic.topic ?? "sem-topico"}>
                <code>{topic.topic ?? "(sem tópico no payload)"}</code> ·{" "}
                {topic._count} evento(s)
              </p>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">
              A Omie não publica a lista de tópicos. Esta é a lista real,
              construída a partir do que chegou — use-a para priorizar handlers.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Eventos recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <EmptyState
              title="Nenhum evento recebido"
              description="Cadastre a URL acima no portal do desenvolvedor Omie para começar a receber."
            />
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="rounded-[var(--radius)] border border-border p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {event.topic ?? "(sem tópico)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.receivedAt.toLocaleString("pt-BR")}
                      {event.sourceIp ? ` · ${event.sourceIp}` : ""}
                      {event.attempts > 1 ? ` · ${event.attempts} tentativas` : ""}
                    </p>
                    {event.lastError && (
                      <p className="mt-1 text-xs text-destructive">
                        {event.lastError}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs ${statusClass(event.status)}`}>
                    {event.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function statusClass(status: string): string {
  if (status === "PROCESSED") return "text-[color:var(--color-success)]";
  if (status === "FAILED") return "text-destructive";
  if (status === "UNHANDLED") return "text-[color:var(--color-warning)]";
  return "text-muted-foreground";
}

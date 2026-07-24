/**
 * Estado de sincronização em linguagem de negócio (briefing §17).
 *
 * O briefing é explícito sobre o que exibir: "sincronizado", "aguardando
 * envio", "processando", "falha na sincronização", "dados possivelmente
 * desatualizados", "conflito" — e "não exiba stack traces". Por isso este
 * componente traduz o enum técnico em algo que o vendedor entende e pode agir.
 */
const LABELS: Record<string, { text: string; tone: "ok" | "warn" | "error" | "muted" }> = {
  SYNCED: { text: "sincronizado", tone: "ok" },
  LOCAL_ONLY: { text: "só neste app", tone: "muted" },
  PENDING: { text: "aguardando envio", tone: "warn" },
  PROCESSING: { text: "processando", tone: "warn" },
  FAILED: { text: "falha no envio", tone: "error" },
  CONFLICT: { text: "precisa de revisão", tone: "error" },
  STALE: { text: "possivelmente desatualizado", tone: "warn" },
};

const TONE_CLASS: Record<string, string> = {
  ok: "text-[color:var(--color-success)]",
  warn: "text-[color:var(--color-warning)]",
  error: "text-destructive",
  muted: "text-muted-foreground",
};

export function SyncStatusBadge({ status }: { status: string }): React.JSX.Element {
  const label = LABELS[status] ?? { text: "desconhecido", tone: "muted" as const };

  return (
    <span
      className={`shrink-0 text-xs ${TONE_CLASS[label.tone] ?? TONE_CLASS["muted"]}`}
    >
      {label.text}
    </span>
  );
}

/**
 * Indicador de última sincronização.
 *
 * Exigência explícita do briefing (§7 e critério de aceite §36): "o horário da
 * última atualização estar visível". O vendedor precisa saber se está olhando
 * um número de agora ou de meia hora atrás — e "nunca sincronizado" é uma
 * informação tão importante quanto uma data.
 */
export function LastSyncBadge({
  lastSyncAt,
  label,
  emptyLabel,
  stale = false,
}: {
  lastSyncAt: Date | null;
  label: string;
  emptyLabel: string;
  stale?: boolean;
}): React.JSX.Element {
  if (lastSyncAt === null) {
    return (
      <p className="text-xs text-muted-foreground">
        <span aria-hidden="true">○</span> {emptyLabel}
      </p>
    );
  }

  return (
    <p
      className={
        stale
          ? "text-xs text-[color:var(--color-warning)]"
          : "text-xs text-muted-foreground"
      }
    >
      <span aria-hidden="true">{stale ? "⚠" : "●"}</span> {label} em{" "}
      <time dateTime={lastSyncAt.toISOString()}>
        {lastSyncAt.toLocaleString("pt-BR")}
      </time>
      {stale && " — pode estar desatualizado"}
    </p>
  );
}

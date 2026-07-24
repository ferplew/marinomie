"use client";

import { useState, useTransition } from "react";
import { toggleFavoriteAction } from "./actions";

export function FavoriteButton({
  productId,
  initialFavorited,
}: {
  productId: string;
  initialFavorited: boolean;
}): React.JSX.Element {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();

  function handleClick(): void {
    // Otimismo local: o servidor é a verdade e reverte se falhar.
    const next = !favorited;
    setFavorited(next);

    startTransition(async () => {
      const result = await toggleFavoriteAction(productId);
      if (!result.ok) setFavorited(!next);
      else setFavorited(result.data.favorited);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      className="shrink-0 rounded-[var(--radius)] border border-border px-3 py-2 text-sm disabled:opacity-50"
    >
      <span aria-hidden="true">{favorited ? "★" : "☆"}</span>
    </button>
  );
}

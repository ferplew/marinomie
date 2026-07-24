import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Primitiva de botão no estilo shadcn/ui.
 *
 * `pending` desabilita o botão e mostra estado de processamento — é a primeira
 * das quatro camadas de proteção contra duplo clique gerando pedido duplicado
 * (docs/synchronization-strategy.md §6). As outras três (idempotency key, lock
 * distribuído e constraint única) vivem no backend, porque esta sozinha não
 * protege nada.
 */
const variants = {
  primary:
    "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50",
  secondary:
    "bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50",
  ghost: "hover:bg-secondary text-foreground disabled:opacity-50",
  destructive:
    "bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50",
} as const;

const sizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  // Alvo de toque confortável em celular — o uso principal da plataforma.
  lg: "h-12 px-6 text-base",
} as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  pending?: boolean;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  pending = false,
  disabled,
  children,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium transition-opacity",
        "disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || pending}
      aria-busy={pending}
      {...props}
    >
      {pending ? "Processando…" : children}
    </button>
  );
}

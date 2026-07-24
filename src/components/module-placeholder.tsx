import { EmptyState } from "@/components/ui/card";

/**
 * Placeholder de módulo comercial ainda não implementado.
 *
 * Existe para que o shell de navegação seja real e navegável na Fase 3 sem
 * exibir dados falsos. Cada tela declara exatamente o que falta e em que fase
 * do roadmap entra — nenhuma delas finge estar pronta.
 */
export function ModulePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <EmptyState title={`Módulo previsto para a ${phase}`} description={description} />
      <p className="text-xs text-muted-foreground">
        Consulte docs/development-roadmap.md para o plano completo de entrega.
      </p>
    </div>
  );
}

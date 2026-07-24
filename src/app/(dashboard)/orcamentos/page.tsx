import type { Metadata } from "next";
import { requireAnyPermission } from "@/server/auth/actor";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Orçamentos · marinomie" };

export default async function Page(): Promise<React.JSX.Element> {
  // A permissão já é exigida agora, para que a rota nunca fique aberta por
  // esquecimento quando o módulo for implementado.
  await requireAnyPermission(["quotes.read_all", "quotes.read_own"]);

  return (
    <ModulePlaceholder
      title="Orçamentos"
      phase="Fase 5"
      description="Fluxo rápido de venda, salvamento local em rascunho e envio ao Omie com etapa 00, mais conversão em pedido."
    />
  );
}

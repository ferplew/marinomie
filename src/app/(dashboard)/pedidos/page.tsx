import type { Metadata } from "next";
import { requireAnyPermission } from "@/server/auth/actor";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Pedidos · marinomie" };

export default async function Page(): Promise<React.JSX.Element> {
  // A permissão já é exigida agora, para que a rota nunca fique aberta por
  // esquecimento quando o módulo for implementado.
  await requireAnyPermission(["orders.read_all", "orders.read_own"]);

  return (
    <ModulePlaceholder
      title="Pedidos"
      phase="Fase 5"
      description="Criação de pedido com proteção contra duplicidade, acompanhamento de etapa e status de sincronização."
    />
  );
}

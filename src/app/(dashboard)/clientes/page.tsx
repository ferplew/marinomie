import type { Metadata } from "next";
import { requireAnyPermission } from "@/server/auth/actor";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Clientes · marinomie" };

export default async function Page(): Promise<React.JSX.Element> {
  // A permissão já é exigida agora, para que a rota nunca fique aberta por
  // esquecimento quando o módulo for implementado.
  await requireAnyPermission(["customers.read_all", "customers.read_own"]);

  return (
    <ModulePlaceholder
      title="Clientes"
      phase="Fase 5"
      description="Busca por nome, documento e código, cadastro com validação de CPF/CNPJ e verificação de duplicidade antes de enviar ao Omie."
    />
  );
}

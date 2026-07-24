import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/actor";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Produtos · marinomie" };

export default async function Page(): Promise<React.JSX.Element> {
  // A permissão já é exigida agora, para que a rota nunca fique aberta por
  // esquecimento quando o módulo for implementado.
  await requirePermission("products.read");

  return (
    <ModulePlaceholder
      title="Produtos"
      phase="Fase 5"
      description="Catálogo com busca por SKU e descrição, detalhe do produto, preço conforme tabela de preço e estoque disponível. Depende do client de integração da Fase 4."
    />
  );
}

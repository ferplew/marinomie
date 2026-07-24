import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/server/auth/actor";
import { CustomerForm } from "./customer-form";

export const metadata: Metadata = { title: "Novo cliente · marinomie" };

export default async function NewCustomerPage(): Promise<React.JSX.Element> {
  await requirePermission("customers.create");

  // A chave de idempotência é gerada no servidor, uma vez por carregamento da
  // tela. Reenviar o mesmo formulário reusa a chave e resolve para o mesmo
  // cliente, em vez de criar dois.
  const idempotencyKey = randomUUID();

  return (
    <div className="space-y-4">
      <Link href="/clientes" className="text-sm text-primary">
        ← Clientes
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Novo cliente</h1>
      <CustomerForm idempotencyKey={idempotencyKey} />
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar · marinomie" };
// Verifica sessão a cada requisição; nunca pré-renderizar em build.
export const dynamic = "force-dynamic";

export default async function LoginPage(): Promise<React.JSX.Element> {
  // Quem já está autenticado não precisa ver o formulário.
  const actor = await getActor();
  if (actor) redirect("/inicio");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">marinomie</h1>
        <p className="text-sm text-muted-foreground">
          Plataforma comercial integrada ao Omie
        </p>
      </header>

      <LoginForm />

      <p className="text-center text-xs text-muted-foreground">
        O acesso é criado pelo administrador da sua empresa.
      </p>
    </main>
  );
}

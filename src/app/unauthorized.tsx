import Link from "next/link";

/** Renderizada por `unauthorized()` com status HTTP 401. */
export default function Unauthorized(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Sessão encerrada</h1>
      <p className="text-sm text-muted-foreground">
        Sua sessão expirou ou não foi encontrada. Entre novamente para continuar.
      </p>
      <Link href="/login" className="text-sm text-primary underline">
        Ir para o login
      </Link>
    </main>
  );
}

import Link from "next/link";

export default function NotFound(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="text-sm text-muted-foreground">
        O endereço acessado não existe ou você não tem acesso a ele.
      </p>
      <Link href="/" className="text-sm text-primary underline">
        Voltar ao início
      </Link>
    </main>
  );
}

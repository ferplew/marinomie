import Link from "next/link";

/**
 * Renderizada por `forbidden()` com status HTTP 403.
 *
 * Não diz qual permissão faltou: isso revelaria a estrutura de autorização a
 * quem não deveria conhecê-la. O detalhe fica no log do servidor.
 */
export default function Forbidden(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Acesso não permitido</h1>
      <p className="text-sm text-muted-foreground">
        Você não tem permissão para acessar esta área. Se acredita que deveria
        ter, procure o administrador da sua empresa.
      </p>
      <Link href="/inicio" className="text-sm text-primary underline">
        Voltar ao início
      </Link>
    </main>
  );
}

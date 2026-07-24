import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";

// Depende de sessão a cada requisição; nunca pré-renderizar em build.
export const dynamic = "force-dynamic";

export default async function RootPage(): Promise<never> {
  const actor = await getActor();
  redirect(actor ? "/inicio" : "/login");
}

import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";

export default async function RootPage(): Promise<never> {
  const actor = await getActor();
  redirect(actor ? "/inicio" : "/login");
}

import { redirect } from "next/navigation";
import { getAuth, type AuthContext } from "@/lib/auth";

export async function requirePageAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

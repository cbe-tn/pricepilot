import { redirect } from "next/navigation";
import { PURCHASING_PATH, getAuth, isPurchasingOnly, type AuthContext } from "@/lib/auth";

/** Pages are closed to Acheteur accounts unless they opt in with `allowPurchasing`. */
export async function requirePageAuth(opts?: { allowPurchasing?: boolean }): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (isPurchasingOnly(auth.user.role) && !opts?.allowPurchasing) redirect(PURCHASING_PATH);
  return auth;
}

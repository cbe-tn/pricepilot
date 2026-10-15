import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { LoginForm } from "@/components/ClientWidgets";
import { AuthFrame } from "@/components/AuthFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connexion" };

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth) redirect("/dashboard");
  return (
    <AuthFrame title="Bon retour" subtitle="Connectez-vous à CBE PricePilot">
      <LoginForm />
      <p className="mt-4 text-center text-sm text-[#4d6a72]">
        Pas encore de compte ?{" "}
        <Link href="/register" className="font-semibold text-[#0b4a56]">
          Créer un espace
        </Link>
      </p>
      <p className="mt-2 text-center text-sm">
        <Link href="/forgot-password" className="text-[#1b6f9a]">
          Mot de passe oublié ?
        </Link>
      </p>
    </AuthFrame>
  );
}

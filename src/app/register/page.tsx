import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { RegisterForm } from "@/components/ClientWidgets";
import { AuthFrame } from "@/components/AuthFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Créer un espace" };

export default async function RegisterPage() {
  const auth = await getAuth();
  if (auth) redirect("/dashboard");
  return (
    <AuthFrame title="Créez votre espace" subtitle="Compte propriétaire · devise par défaut : dinar (TND)">
      <RegisterForm />
      <p className="mt-4 text-center text-sm text-[#4d6a72]">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-semibold text-[#0b4a56]">
          Se connecter
        </Link>
      </p>
    </AuthFrame>
  );
}

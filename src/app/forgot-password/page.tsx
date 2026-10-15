import Link from "next/link";
import { ForgotForm } from "@/components/ClientWidgets";
import { AuthFrame } from "@/components/AuthFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mot de passe oublié" };

export default function ForgotPage() {
  return (
    <AuthFrame title="Réinitialiser le mot de passe" subtitle="Un lien valable une heure va être créé">
      <ForgotForm />
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-[#0b4a56]">
          Retour à la connexion
        </Link>
      </p>
    </AuthFrame>
  );
}

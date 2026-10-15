import { ResetForm } from "@/components/ClientWidgets";
import { AuthFrame } from "@/components/AuthFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau mot de passe" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const sp = await searchParams;
  const token = sp.token ?? "";
  return (
    <AuthFrame title="Choisissez un nouveau mot de passe" subtitle="Ce lien expire au bout d'une heure">
      {token ? <ResetForm token={token} /> : <p className="text-sm text-[#c53d3d]">Lien de réinitialisation invalide ou incomplet.</p>}
    </AuthFrame>
  );
}

import { createProductAction } from "@/lib/actions";
import { ProductForm } from "@/components/ClientWidgets";
import { PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { n } from "@/lib/money";

export const metadata = { title: "Ajouter un produit" };

export default async function NewProductPage() {
  const auth = await requirePageAuth();
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Ajouter un produit"
        subtitle="Commencez par l'identité (référence, code-barres, modèle), puis le prix d'achat. PricePilot calcule le bénéfice TVA comprise et récupère automatiquement les prix concurrents."
      />
      <ProductForm
        action={createProductAction}
        defaults={{ vatPct: n(auth.workspace.defaultVatRate) * 100, minMarginPct: n(auth.workspace.defaultMinMargin) * 100 }}
      />
    </div>
  );
}

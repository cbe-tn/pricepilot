import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitors, products } from "@/db/schema";
import { completeOnboardingAction } from "@/lib/actions";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { n } from "@/lib/money";

export const metadata = { title: "Démarrage" };

export default async function OnboardingPage() {
  const auth = await requirePageAuth();
  const productCount = (await db.select().from(products).where(eq(products.workspaceId, auth.workspace.id))).length;
  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop);
  const step = auth.workspace.onboardingStep;

  const steps = [
    "Configurer la boutique et la marge par défaut",
    "Ajouter (ou importer) vos produits",
    "Saisir les prix d'achat",
    "Choisir les concurrents suivis",
    "Laisser la recherche automatique trouver les prix concurrents",
    "Vérifier et enregistrer une recommandation de prix",
    "Activer les notifications",
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Configuration guidée" subtitle="Sept étapes courtes, dans l'ordre que vous voulez — rien n'est bloquant." />
      <ol className="mb-6 space-y-2">
        {steps.map((s, i) => (
          <li key={s} className={`rounded-xl px-4 py-3 text-sm ${i < step ? "bg-[#e5f6ee]" : i === step ? "bg-[#fff4cc]" : "bg-white border border-[#d7e3e6]"}`}>
            <span className="mr-2 font-semibold">{i + 1}.</span>
            {s}
          </li>
        ))}
      </ol>
      <Card>
        <form action={completeOnboardingAction} className="space-y-4">
          <Field label="Nom de la boutique">
            <Input name="name" defaultValue={auth.workspace.name} />
          </Field>
          <Field label="Marge minimale par défaut %">
            <Input name="defaultMinMargin" type="number" step="0.1" defaultValue={n(auth.workspace.defaultMinMargin) * 100} />
          </Field>
          <p className="text-sm text-[#4d6a72]">
            Produits au catalogue : {productCount}. Concurrents activés : {comps.filter((c) => c.enabled).length}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/products/new" className="h-10 rounded-lg border border-[#d7e3e6] px-4 text-sm leading-10">
              Ajouter un produit
            </Link>
            <Link href="/competitors" className="h-10 rounded-lg border border-[#d7e3e6] px-4 text-sm leading-10">
              Choisir les concurrents
            </Link>
            <Link href="/benchmarking" className="h-10 rounded-lg border border-[#d7e3e6] px-4 text-sm leading-10">
              Voir le benchmark
            </Link>
            <Link href="/recommendations" className="h-10 rounded-lg border border-[#d7e3e6] px-4 text-sm leading-10">
              Voir les recommandations
            </Link>
            <Link href="/settings" className="h-10 rounded-lg border border-[#d7e3e6] px-4 text-sm leading-10">
              Notifications
            </Link>
          </div>
          <input type="hidden" name="step" value="7" />
          <button className="h-10 rounded-lg bg-[#d4a017] px-4 text-sm font-semibold text-[#3b2a00]">Terminer la configuration</button>
        </form>
      </Card>
    </div>
  );
}

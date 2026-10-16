import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { marketingCampaigns } from "@/db/schema";
import { ProductPicker } from "@/components/marketing/ProductPicker";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { loadPosterProducts } from "@/lib/marketing";
import { deleteCampaignAction, duplicateCampaignAction } from "@/lib/marketing-actions";
import { formatWhen } from "@/lib/money";

export const metadata = { title: "AI Marketing Studio" };

const LANG = { fr: "Français", ar: "Arabe", bi: "Bilingue" } as Record<string, string>;

export default async function MarketingPage() {
  const auth = await requirePageAuth();
  const [products, campaigns] = await Promise.all([
    loadPosterProducts(auth.workspace.id),
    db.select().from(marketingCampaigns).where(eq(marketingCampaigns.workspaceId, auth.workspace.id)).orderBy(desc(marketingCampaigns.updatedAt)),
  ]);
  const names = new Map(products.map((p) => [p.id, p.name]));

  return (
    <div>
      <PageHeader
        title="AI Marketing Studio"
        subtitle="Affiches publicitaires 1080 × 1080 à partir des vrais produits du catalogue : prix numedia.tn, stock et benchmark concurrents vérifiés avant chaque export."
      />

      <h2 className="mb-2 font-semibold">Meilleurs produits à promouvoir</h2>
      <ProductPicker products={products} />

      <h2 className="mb-2 mt-8 font-semibold">Historique des campagnes ({campaigns.length})</h2>
      {campaigns.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="pp-table pp-compact">
            <thead>
              <tr>
                <th>Campagne</th>
                <th>Produits</th>
                <th>Langue</th>
                <th>Statut</th>
                <th>Créée</th>
                <th>Modifiée</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const design = c.design as { lang?: string };
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/marketing/${c.id}`} className="font-medium text-[#0b4a56]">
                        {c.name}
                      </Link>
                    </td>
                    <td className="max-w-[360px] text-xs">{c.productIds.map((id) => names.get(id) ?? "produit supprimé").join(" + ")}</td>
                    <td>{LANG[design.lang ?? "fr"] ?? "Français"}</td>
                    <td>
                      <Badge tone={c.status === "validated" ? "ok" : "warn"}>{c.status === "validated" ? "Validée" : "Brouillon"}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-xs">{formatWhen(c.createdAt)}</td>
                    <td className="whitespace-nowrap text-xs">{formatWhen(c.updatedAt)}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link href={`/marketing/${c.id}`} className="mr-3 text-xs text-[#0b4a56] underline">
                        Ouvrir
                      </Link>
                      <form action={duplicateCampaignAction} className="inline">
                        <input type="hidden" name="id" value={c.id} />
                        <button className="mr-3 text-xs text-[#0b4a56] underline">Dupliquer</button>
                      </form>
                      <form action={deleteCampaignAction} className="inline">
                        <input type="hidden" name="id" value={c.id} />
                        <button className="text-xs text-[#b42323] underline">Supprimer</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <p className="text-sm text-[#6b858c]">Aucune campagne pour le moment : sélectionnez des produits ci-dessus pour créer votre première affiche.</p>
      )}
    </div>
  );
}

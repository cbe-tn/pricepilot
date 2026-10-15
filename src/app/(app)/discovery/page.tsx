import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitors, discoveredListings } from "@/db/schema";
import { DiscoveryButtons } from "@/components/ClientWidgets";
import { Badge, DemoChip, EmptyState, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatTnd, relativeTime } from "@/lib/money";
import { fr } from "@/lib/labels";

export const metadata = { title: "Nouveaux produits" };

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const auth = await requirePageAuth();
  const sp = await searchParams;
  let rows = await db
    .select()
    .from(discoveredListings)
    .where(eq(discoveredListings.workspaceId, auth.workspace.id))
    .orderBy(desc(discoveredListings.firstSeenAt));
  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop);
  if (sp.competitor) rows = rows.filter((r) => r.competitorId === sp.competitor);
  if (sp.brand) rows = rows.filter((r) => (r.brand ?? "") === sp.brand);
  if (sp.category) rows = rows.filter((r) => (r.category ?? "") === sp.category);
  if (sp.status) rows = rows.filter((r) => r.status === sp.status);

  return (
    <div>
      <PageHeader
        title="Nouveaux produits chez les concurrents"
        subtitle="Offres concurrentes vues pour la première fois, séparées des réapparitions."
      />
      <form className="mb-4 grid gap-2 md:grid-cols-5">
        <select name="competitor" defaultValue={sp.competitor ?? ""} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">
          <option value="">Tous les concurrents</option>
          {comps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input name="brand" placeholder="Marque" defaultValue={sp.brand ?? ""} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm" />
        <input name="category" placeholder="Catégorie" defaultValue={sp.category ?? ""} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm" />
        <select name="status" defaultValue={sp.status ?? ""} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">
          <option value="">Tous les statuts</option>
          <option value="new">Nouveau</option>
          <option value="watchlist">À surveiller</option>
          <option value="ignored">Ignoré</option>
          <option value="added">Ajouté</option>
        </select>
        <button className="h-10 rounded-lg bg-[#0b4a56] text-sm text-white">Filtrer</button>
      </form>
      {rows.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="pp-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="text-sm text-[#6b858c]">
                    {r.brand} · {r.manufacturerRef} · {comps.find((c) => c.id === r.competitorId)?.name}
                  </p>
                </div>
                {r.isDemo ? <DemoChip /> : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <Badge tone="teal">{formatTnd(r.priceTnd)}</Badge>
                <Badge>{r.category}</Badge>
                <Badge tone={r.rediscovery ? "warn" : "ok"}>{r.rediscovery ? "Réapparition" : "Première apparition"}</Badge>
                <Badge tone={r.alreadyInCatalog ? "info" : "slate"}>{r.alreadyInCatalog ? "Dans le catalogue" : "Hors catalogue"}</Badge>
                <Badge>{r.status === "new" ? "Nouveau" : fr(r.status)}</Badge>
              </div>
              <p className="mt-2 text-xs text-[#6b858c]">
                Vu pour la première fois {relativeTime(r.firstSeenAt)} · identification {r.identificationConfidence} %
              </p>
              {r.url ? (
                <a href={r.url} className="mt-1 inline-block text-xs underline" target="_blank" rel="noreferrer">
                  Voir la source
                </a>
              ) : null}
              <div className="mt-3">
                <DiscoveryButtons id={r.id} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Aucune nouveauté" body="Lorsqu'un concurrent publie un produit pour la première fois, il apparaîtra ici." />
      )}
    </div>
  );
}

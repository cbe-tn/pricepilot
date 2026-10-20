import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, products } from "@/db/schema";
import { OfferReview, ScrollPanel } from "@/components/ClientWidgets";
import { Badge, Card, DemoChip, EmptyState, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatTnd, n, relativeTime, signedTnd } from "@/lib/money";
import { marketStats, positionLabel } from "@/lib/pricing";
import { buildBenchmarkMatrix } from "@/lib/benchmark";
import { BenchmarkTable, benchmarkLegend, coverageOf as coverage } from "@/components/BenchmarkTable";
import { fr } from "@/lib/labels";
import { isSelectedCompetitor } from "@/lib/connectors";
import { isExclusive, isUnverifiedExclusive } from "@/lib/exclusives";

export const metadata = { title: "Benchmark des prix" };

export default async function BenchmarkingPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; vide?: string; vue?: string }>;
}) {
  const auth = await requirePageAuth();
  const { sort = "cheap", q = "", vide, vue: vueParam } = await searchParams;
  // "concurrents" = only products a competitor sells · "exclusifs" = products only we sell.
  const vue = vueParam ?? (vide === "0" ? "concurrents" : "");
  const query = q.trim().toLowerCase();
  const catalog = await db.select().from(products).where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop && isSelectedCompetitor(c));
  const selectedCompetitorIds = new Set(comps.map((c) => c.id));
  const offers = (await db.select().from(competitorOffers).where(eq(competitorOffers.workspaceId, auth.workspace.id))).filter((o) => o.userReview !== "reject" && selectedCompetitorIds.has(o.competitorId));

  const matrix = await buildBenchmarkMatrix(auth.workspace.id);
  // Competitors carrying most of our products come first; products found nowhere go last.
  const compCount = new Map(matrix.competitors.map((c) => [c.id, matrix.rows.filter((r) => r.cells[c.id]).length]));
  const matrixComps = matrix.competitors
    .filter((c) => c.enabled || (compCount.get(c.id) ?? 0) > 0)
    .sort((a, b) => (compCount.get(b.id) ?? 0) - (compCount.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const matchesQuery = (p: { name: string; manufacturerRef: string | null; model: string | null; brand: string | null; category: string | null }) =>
    !query || [p.name, p.manufacturerRef, p.model, p.brand, p.category].some((v) => v?.toLowerCase().includes(query));
  const matrixRows = matrix.rows
    .filter((r) => matchesQuery(r.product) && (vue === "concurrents" ? coverage(r) > 0 : vue === "exclusifs" ? isExclusive(r) : true))
    .sort((a, b) => coverage(b) - coverage(a));
  const pricedCount = matrix.rows.filter((r) => coverage(r) > 0).length;
  const exclusiveCount = matrix.rows.filter(isExclusive).length;
  const unsearchedCount = matrix.rows.filter((r) => r.product.ownStatus === "found" && !r.product.lastMatchedAt).length;
  const unverifiedCount = matrix.rows.filter(isUnverifiedExclusive).length;

  const rows = offers.filter((o) => catalog.some((x) => x.id === o.productId && matchesQuery(x))).map((o) => {
    const p = catalog.find((x) => x.id === o.productId);
    const c = comps.find((x) => x.id === o.competitorId);
    const related = offers.filter((x) => x.productId === o.productId);
    const stats = marketStats(
      related.map((x) => ({
        priceTnd: n(x.priceTnd),
        availability: x.availability,
        matchClass: x.matchClass,
        excludedFromBenchmark: x.excludedFromBenchmark,
        condition: x.condition,
      })),
    );
    return {
      o,
      p,
      c,
      vsCost: p ? n(o.priceTnd) - (n(p.purchasePrice) + n(p.shippingCost) + n(p.importCost) + n(p.otherCosts)) : 0,
      vsSell: p ? n(o.priceTnd) - n(p.actualSellingPrice) : 0,
      position: positionLabel(n(o.priceTnd), stats),
    };
  });

  rows.sort((a, b) => {
    if (sort === "expensive") return n(b.o.priceTnd) - n(a.o.priceTnd);
    if (sort === "avail") return a.o.availability.localeCompare(b.o.availability);
    if (sort === "recent") return +new Date(b.o.lastCheckedAt) - +new Date(a.o.lastCheckedAt);
    return n(a.o.priceTnd) - n(b.o.priceTnd);
  });

  return (
    <div>
      <PageHeader
        title="Benchmark des prix"
        subtitle="Toutes les offres comparables réunies. Les correspondances exactes et fortes alimentent les recommandations ; les possibles ou non vérifiées attendent votre confirmation."
        actions={
          <form className="flex flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Réf, désignation, marque…"
              className="h-10 w-56 rounded-lg border border-[#d7e3e6] px-3 text-sm"
            />
            <select name="vue" defaultValue={vue} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm" title="Produits affichés dans la matrice">
              <option value="">Tous les produits</option>
              <option value="concurrents">Vendus par un concurrent</option>
              <option value="exclusifs">Exclusifs numedia.tn (aucun concurrent)</option>
            </select>
            <select name="sort" defaultValue={sort} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm" title="Tri de la liste des offres">
              <option value="cheap">Offre la moins chère</option>
              <option value="expensive">La plus chère</option>
              <option value="avail">Disponibilité</option>
              <option value="recent">Mise à jour la plus récente</option>
            </select>
            <button className="h-10 rounded-lg bg-[#0b4a56] px-4 text-sm text-white">Appliquer</button>
          </form>
        }
      />
      {matrix.rows.length ? (
        <div className="mb-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Matrice de benchmark</h2>
              <p className="text-xs text-[#6b858c]">{benchmarkLegend}</p>
            </div>
            <div className="flex gap-2">
              <a href="/api/benchmark?vue=exclusifs" className="h-10 rounded-lg border border-[#0b4a56] px-4 text-sm leading-10 text-[#0b4a56]" title="Produits en ligne sur notre site que les concurrents suivis ne vendent pas">
                Exporter exclusifs ({exclusiveCount.toLocaleString("fr-FR")})
              </a>
              <a href="/api/benchmark" className="h-10 rounded-lg bg-[#0b4a56] px-4 text-sm leading-10 text-white">
                Exporter Excel
              </a>
            </div>
          </div>
          <ScrollPanel
            toolbar={
              <span className="text-xs text-[#4d6a72]">
                <strong>{matrixRows.length.toLocaleString("fr-FR")}</strong> produits affichés · {pricedCount.toLocaleString("fr-FR")} avec au moins un prix
                concurrent
                {" "}· {exclusiveCount.toLocaleString("fr-FR")} exclusifs numedia.tn
                {vue === "exclusifs" && unverifiedCount ? <> · {unverifiedCount.toLocaleString("fr-FR")} sans référence non trouvés ailleurs (à vérifier, dans l&apos;export)</> : null}
                {vue === "exclusifs" && unsearchedCount ? <> · {unsearchedCount.toLocaleString("fr-FR")} pas encore recherchés chez les concurrents</> : null}
                {query ? <> · recherche « {q} »</> : null}
              </span>
            }
          >
            <BenchmarkTable rows={matrixRows} comps={matrixComps} compCount={compCount} ownShop={matrix.ownShop} showOwn={Boolean(matrix.ownShop)} />
          </ScrollPanel>
        </div>
      ) : null}
      <h2 className="mb-2 font-semibold">Toutes les offres ({rows.length.toLocaleString("fr-FR")})</h2>
      {rows.length ? (
        <ScrollPanel maxHeight="60vh">
          <table className="pp-table pp-compact">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Concurrent</th>
                <th>Prix</th>
                <th>Disponibilité</th>
                <th>Vérifié</th>
                <th>Écart vs coût</th>
                <th>Écart vs notre prix</th>
                <th>Position</th>
                <th>Correspondance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, p, c, vsCost, vsSell, position }) => (
                <tr key={o.id}>
                  <td>
                    {p ? (
                      <Link href={`/products/${p.id}`} className="font-medium text-[#0b4a56]">
                        {p.name}
                      </Link>
                    ) : (
                      o.title
                    )}
                    <div className="text-xs text-[#6b858c]">{p?.model}</div>
                  </td>
                  <td>
                    {c?.name}
                    {o.url ? (
                      <div>
                        <a href={o.url} className="text-xs underline" target="_blank" rel="noreferrer">
                          URL
                        </a>
                      </div>
                    ) : null}
                    {o.isDemo ? <DemoChip /> : null}
                  </td>
                  <td className="tabular-nums">{formatTnd(o.priceTnd)}</td>
                  <td>
                    <Badge tone={o.availability === "in_stock" ? "ok" : "warn"}>{fr(o.availability)}</Badge>
                  </td>
                  <td>{relativeTime(o.lastCheckedAt)}</td>
                  <td className="tabular-nums">{signedTnd(vsCost)}</td>
                  <td className="tabular-nums">{signedTnd(vsSell)}</td>
                  <td>{position}</td>
                  <td>
                    <Badge tone={o.matchClass === "exact" ? "ok" : o.matchClass === "strong" ? "teal" : "warn"}>
                      {fr(o.matchClass)} {o.matchConfidence} %
                    </Badge>
                    <div className="max-w-[200px] text-[11px] text-[#6b858c]">{o.matchReason}</div>
                  </td>
                  <td>{p ? <OfferReview offerId={o.id} productId={p.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollPanel>
      ) : (
        <EmptyState title="Aucune offre pour le moment" body="Ajoutez ou importez des produits : leurs offres concurrentes sont recherchées automatiquement par référence et apparaîtront ici." />
      )}
    </div>
  );
}

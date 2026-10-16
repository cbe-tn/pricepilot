import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, discoveredListings, priceObservations, products, supplierQuotes, suppliers } from "@/db/schema";
import { PrintButton } from "@/components/PrintButton";
import { requirePageAuth } from "@/lib/page-auth";
import { formatPctPoints, formatTnd, formatWhen, n } from "@/lib/money";
import { costFromProduct, recommendPrice, taxFromWorkspace } from "@/lib/pricing";
import { fr } from "@/lib/labels";
import { isSelectedCompetitor } from "@/lib/connectors";

export const metadata = { title: "Rapport imprimable" };

const REPORT_TITLES: Record<string, string> = {
  comparison: "Comparaison des prix concurrents",
  profitability: "Rentabilité des produits",
  recommendations: "Recommandations de prix",
  "below-margin": "Produits sous la marge cible",
  discovery: "Nouveaux produits découverts",
  changes: "Changements de prix concurrents",
  suppliers: "Comparaison des coûts fournisseurs",
  trends: "Tendances historiques du marché",
  inventory: "Stock et inventaire",
};

export default async function PrintReportPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const auth = await requirePageAuth();
  const { type = "profitability" } = await searchParams;
  const catalog = await db.select().from(products).where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop && isSelectedCompetitor(c));
  const selectedCompetitorIds = new Set(comps.map((c) => c.id));
  const offers = (await db.select().from(competitorOffers).where(eq(competitorOffers.workspaceId, auth.workspace.id))).filter((o) => selectedCompetitorIds.has(o.competitorId));
  const discoveries = await db.select().from(discoveredListings).where(eq(discoveredListings.workspaceId, auth.workspace.id));
  const observations = (await db
    .select()
    .from(priceObservations)
    .where(eq(priceObservations.workspaceId, auth.workspace.id))
    .orderBy(desc(priceObservations.observedAt))
    .limit(80)).filter((o) => o.competitorId != null && selectedCompetitorIds.has(o.competitorId));
  const quotes = await db.select().from(supplierQuotes).where(eq(supplierQuotes.workspaceId, auth.workspace.id));
  const sups = await db.select().from(suppliers).where(eq(suppliers.workspaceId, auth.workspace.id));
  const tax = taxFromWorkspace(auth.workspace);
  const generated = new Date();

  const productRows = catalog.map((p) => {
    const rec = recommendPrice({
      cost: costFromProduct(p),
      tax: { ...tax, vatRate: n(p.vatRate) || tax.vatRate },
      minMargin: n(p.minProfitMargin),
      currentSellingTtc: n(p.actualSellingPrice),
      targetSellingTtc: n(p.targetSellingPrice),
      offers: offers
        .filter((o) => o.productId === p.id)
        .map((o) => ({
          priceTnd: n(o.priceTnd),
          availability: o.availability,
          matchClass: o.matchClass,
          excludedFromBenchmark: o.excludedFromBenchmark,
          condition: o.condition,
        })),
      strategy: p.savedStrategy ?? "competitive",
    });
    return { p, rec };
  });

  const lines: Array<{ item: string; detail: string; tnd: string }> = [];
  if (type === "discovery") {
    for (const d of discoveries) {
      lines.push({ item: d.title, detail: `${d.brand ?? ""}`, tnd: formatTnd(d.priceTnd) });
    }
  } else if (type === "changes") {
    for (const o of observations.filter((x) => x.eventType !== "unchanged")) {
      lines.push({
        item: catalog.find((p) => p.id === o.productId)?.name ?? "—",
        detail: `${fr(o.eventType)} · ${comps.find((c) => c.id === o.competitorId)?.name ?? ""}`,
        tnd: `${formatTnd(o.previousPriceTnd)} → ${formatTnd(o.priceTnd)}`,
      });
    }
  } else if (type === "suppliers") {
    for (const q of quotes) {
      lines.push({
        item: q.productName ?? "—",
        detail: sups.find((s) => s.id === q.supplierId)?.name ?? "",
        tnd: formatTnd(q.quotedPrice),
      });
    }
  } else if (type === "inventory") {
    for (const p of catalog) {
      lines.push({ item: p.name, detail: `${fr(p.stockStatus)} · ${p.stockQty} unités`, tnd: formatTnd(n(p.purchasePrice) * p.stockQty) });
    }
  } else {
    for (const { p, rec } of productRows) {
      if (type === "below-margin" && rec.breakdown.grossMargin >= n(p.minProfitMargin)) continue;
      lines.push({
        item: p.name,
        detail: `Vente ${formatTnd(p.actualSellingPrice)} · recommandé ${formatTnd(rec.recommendedTtc)} · marge ${formatPctPoints(rec.breakdown.grossMargin)}`,
        tnd: formatTnd(rec.breakdown.grossProfit),
      });
    }
  }

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 print:p-0">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <header className="border-b border-[#d7e3e6] pb-4">
        <p className="text-xs uppercase tracking-widest text-[#6b858c]">CBE PricePilot</p>
        <h1 className="text-2xl font-semibold">{REPORT_TITLES[type] ?? "Rapport"}</h1>
        <p className="text-sm text-[#6b858c]">
          {auth.workspace.name} · généré le {formatWhen(generated)} · prix concurrents au dernier relevé.
        </p>
      </header>
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-[#6b858c]">
            <th className="py-2">Élément</th>
            <th>Détail</th>
            <th>DT</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-[#eef3f5]">
              <td className="py-2">{l.item}</td>
              <td>{l.detail}</td>
              <td className="tabular-nums">{l.tnd}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { and, desc, eq, isNull } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { competitorOffers, competitors, discoveredListings, priceObservations, products, supplierQuotes, suppliers } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { n } from "@/lib/money";
import { costFromProduct, recommendPrice, taxFromWorkspace } from "@/lib/pricing";
import { fr } from "@/lib/labels";
import { isSelectedCompetitor } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response("Non autorisé", { status: 401 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "profitability";
  const format = url.searchParams.get("format") ?? "csv";
  const generatedAt = new Date().toISOString();

  const catalog = await db.select().from(products).where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop && isSelectedCompetitor(c));
  const selectedCompetitorIds = new Set(comps.map((c) => c.id));
  const offers = (await db.select().from(competitorOffers).where(eq(competitorOffers.workspaceId, auth.workspace.id))).filter((o) => selectedCompetitorIds.has(o.competitorId));
  const tax = taxFromWorkspace(auth.workspace);

  let rows: Record<string, unknown>[] = [];
  if (type === "discovery") {
    const d = await db.select().from(discoveredListings).where(eq(discoveredListings.workspaceId, auth.workspace.id));
    rows = d.map((x) => ({ "Désignation": x.title, Marque: x.brand, "Prix DT": n(x.priceTnd), "Vu le": x.firstSeenAt, "Généré le": generatedAt }));
  } else if (type === "changes") {
    const obs = (await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.workspaceId, auth.workspace.id))
      .orderBy(desc(priceObservations.observedAt))
      .limit(200)).filter((o) => o.competitorId != null && selectedCompetitorIds.has(o.competitorId));
    rows = obs
      .filter((o) => o.eventType !== "unchanged")
      .map((o) => ({
        Produit: catalog.find((p) => p.id === o.productId)?.name,
        Concurrent: comps.find((c) => c.id === o.competitorId)?.name,
        "Événement": fr(o.eventType),
        "Ancien prix": n(o.previousPriceTnd),
        "Nouveau prix": n(o.priceTnd),
        "Relevé le": o.observedAt,
        "Généré le": generatedAt,
      }));
  } else if (type === "suppliers") {
    const quotes = await db.select().from(supplierQuotes).where(eq(supplierQuotes.workspaceId, auth.workspace.id));
    const sups = await db.select().from(suppliers).where(eq(suppliers.workspaceId, auth.workspace.id));
    rows = quotes.map((q) => ({
      Fournisseur: sups.find((s) => s.id === q.supplierId)?.name,
      Produit: q.productName,
      "Prix proposé": n(q.quotedPrice),
      "Qté min.": q.moq,
      "Généré le": generatedAt,
    }));
  } else if (type === "inventory") {
    rows = catalog.map((p) => ({ "Désignation": p.name, "Réf": p.manufacturerRef, SKU: p.sku, "Qté": p.stockQty, Statut: fr(p.stockStatus), "Valeur au coût HT": n(p.purchasePrice) * p.stockQty, "Généré le": generatedAt }));
  } else {
    rows = catalog
      .map((p) => {
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
        if (type === "below-margin" && rec.breakdown.grossMargin >= n(p.minProfitMargin)) return null;
        return {
          "Désignation": p.name,
          "Réf": p.manufacturerRef,
          SKU: p.sku,
          "Prix de vente TTC": n(p.actualSellingPrice),
          "Prix recommandé TTC": rec.recommendedTtc,
          "Bénéfice": rec.breakdown.grossProfit,
          "Marge %": Math.round(rec.breakdown.grossMargin * 1000) / 10,
          "Concurrent le moins cher": rec.market.lowest,
          "Généré le": generatedAt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Rapport");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="pricepilot-${type}.xlsx"`,
      },
    });
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pricepilot-${type}.csv"`,
    },
  });
}

import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, discoveredListings, priceObservations, products } from "@/db/schema";
import type { AuthContext } from "@/lib/auth";
import { fr } from "@/lib/labels";
import { formatPctPoints, formatTnd, n, relativeTime } from "@/lib/money";
import {
  analyzePrice,
  costFromProduct,
  marketStats,
  recommendPrice,
  taxFromWorkspace,
} from "@/lib/pricing";

export type AssistantMessage = { role: "user" | "assistant"; content: string };

export async function answerAssistant(auth: AuthContext, question: string): Promise<string> {
  // Questions are matched without accents, in French or English.
  const raw = question.toLowerCase().trim();
  const q = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const catalog = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const offers = await db
    .select({
      offer: competitorOffers,
      competitorName: competitors.name,
    })
    .from(competitorOffers)
    .innerJoin(competitors, eq(competitorOffers.competitorId, competitors.id))
    .where(eq(competitorOffers.workspaceId, auth.workspace.id));

  const tax = taxFromWorkspace(auth.workspace);
  const facts: string[] = [];
  facts.push(`Devise de l'espace : ${auth.workspace.defaultCurrency}. Les montants proviennent des prix relevés et enregistrés.`);
  const demoCount = catalog.filter((p) => p.isDemo).length;
  if (demoCount) facts.push(`${demoCount} produit(s) sur ${catalog.length} sont des données de démonstration.`);

  const withMarket = catalog.map((p) => {
    const pOffers = offers.filter((o) => o.offer.productId === p.id).map((o) => o.offer);
    const stats = marketStats(
      pOffers.map((o) => ({
        priceTnd: n(o.priceTnd),
        availability: o.availability,
        matchClass: o.matchClass,
        excludedFromBenchmark: o.excludedFromBenchmark,
        condition: o.condition,
      })),
    );
    const cost = costFromProduct(p);
    const selling = n(p.actualSellingPrice);
    const analysis = analyzePrice(selling, cost, { ...tax, vatRate: n(p.vatRate) || tax.vatRate });
    return { p, pOffers, stats, analysis, selling };
  });

  const mentionsProduct = (p: (typeof catalog)[number]) =>
    raw.includes(p.name.toLowerCase()) || Boolean(p.sku && raw.includes(p.sku.toLowerCase())) || Boolean(p.manufacturerRef && raw.includes(p.manufacturerRef.toLowerCase()));

  if (!q) {
    return "Posez une question sur votre catalogue, par exemple : quels produits dois-je repositionner aujourd'hui ?";
  }

  if (/repositionn|reprice|undercut|trop cher|too high|baisser (mon |mes |le )?prix|lower (my )?price|moins cher que moi/.test(q)) {
    const hits = withMarket.filter((x) => x.stats.lowest != null && x.selling > x.stats.lowest + 1 && x.pOffers.some((o) => o.availability === "in_stock"));
    if (!hits.length) return cite("Aucun produit n'a actuellement de concurrent comparable, en stock, moins cher que votre prix de vente.", facts);
    return cite(
      hits
        .slice(0, 8)
        .map((x) => {
          const cheapest = x.pOffers.filter((o) => !o.excludedFromBenchmark).sort((a, b) => n(a.priceTnd) - n(b.priceTnd))[0];
          const last = cheapest ? relativeTime(cheapest.lastCheckedAt) : "n/d";
          const where = cheapest ? offers.find((o) => o.offer.id === cheapest.id)?.competitorName : null;
          return `• ${x.p.name}${x.p.manufacturerRef ? ` (${x.p.manufacturerRef})` : ""} — vous vendez ${formatTnd(x.selling)} ; le moins cher est à ${formatTnd(x.stats.lowest)}${where ? ` chez ${where}` : ""}, vérifié ${last}${cheapest?.isDemo ? " [démo]" : ""}.`;
        })
        .join("\n"),
      facts,
    );
  }

  if (/sous.*marge|marge minimale|marge min|below.*margin|minimum margin|trop faible|too thin|pas rentable|non rentable|unprofit|a perte/.test(q)) {
    const hits = withMarket.filter((x) => x.analysis.grossMargin < n(x.p.minProfitMargin) || x.analysis.grossProfit < 0);
    if (!hits.length) return cite("Aucun produit n'est actuellement sous sa marge minimale configurée.", facts);
    return cite(
      hits
        .map(
          (x) =>
            `• ${x.p.name} — marge brute ${formatPctPoints(x.analysis.grossMargin)} pour un plancher de ${formatPctPoints(n(x.p.minProfitMargin))}, bénéfice ${formatTnd(x.analysis.grossProfit)} à ${formatTnd(x.selling)}. Coût de revient ${formatTnd(x.analysis.totalAcquisitionCost)}.`,
        )
        .join("\n"),
      facts,
    );
  }

  if (/rupture|out of stock|oos|moins cher.*stock|cheapest.*stock/.test(q)) {
    const hits = withMarket.filter((x) => {
      const cheapest = [...x.pOffers].sort((a, b) => n(a.priceTnd) - n(b.priceTnd))[0];
      return cheapest && cheapest.availability === "out_of_stock";
    });
    if (!hits.length) return cite("Aucun produit n'a son offre concurrente la moins chère en rupture de stock.", facts);
    return cite(
      hits
        .map((x) => {
          const cheapest = [...x.pOffers].sort((a, b) => n(a.priceTnd) - n(b.priceTnd))[0];
          const name = offers.find((o) => o.offer.id === cheapest.id)?.competitorName;
          return `• ${x.p.name} — l'offre la moins chère (${formatTnd(cheapest.priceTnd)} chez ${name}) est en rupture (vérifié ${relativeTime(cheapest.lastCheckedAt)}) : bonne occasion de tenir votre prix.`;
        })
        .join("\n"),
      facts,
    );
  }

  if (/nouveau(x)? produit|nouveaute|nouvellement|new(ly)? listed|discovery|new product/.test(q)) {
    const rows = await db
      .select()
      .from(discoveredListings)
      .where(eq(discoveredListings.workspaceId, auth.workspace.id))
      .orderBy(desc(discoveredListings.firstSeenAt))
      .limit(12);
    if (!rows.length) return cite("Aucun nouveau produit concurrent n'a encore été enregistré.", facts);
    return cite(
      rows
        .map(
          (r) =>
            `• ${r.title} — ${r.brand ?? "marque inconnue"}, ${formatTnd(r.priceTnd)}, vu pour la première fois ${relativeTime(r.firstSeenAt)}, statut ${r.status === "new" ? "nouveau" : fr(r.status)}${r.isDemo ? " [démo]" : ""}${r.alreadyInCatalog ? " (déjà au catalogue)" : ""}.`,
        )
        .join("\n"),
      facts,
    );
  }

  if (/5 ?%|baiss.*prix|reduire.*prix|reduce.*price|que se passerait|what would happen|simul/.test(q)) {
    const nameMatch = catalog.find(mentionsProduct);
    const target = nameMatch ?? withMarket.sort((a, b) => n(b.p.actualSellingPrice) - n(a.p.actualSellingPrice))[0]?.p;
    if (!target) return cite("Aucun produit disponible pour la simulation.", facts);
    const current = n(target.actualSellingPrice);
    const next = current * 0.95;
    const before = analyzePrice(current, costFromProduct(target), { ...tax, vatRate: n(target.vatRate) || tax.vatRate });
    const after = analyzePrice(next, costFromProduct(target), { ...tax, vatRate: n(target.vatRate) || tax.vatRate });
    return cite(
      `Simulation sur ${target.name}${target.manufacturerRef ? ` (${target.manufacturerRef})` : ""}.\nActuel ${formatTnd(current)} → bénéfice ${formatTnd(before.grossProfit)} (${formatPctPoints(before.grossMargin)}).\nAprès −5 % ${formatTnd(next)} → bénéfice ${formatTnd(after.grossProfit)} (${formatPctPoints(after.grossMargin)}).\nC'est une estimation à partir des coûts enregistrés ; aucun prix n'est modifié sur votre boutique en ligne.`,
      facts.concat(after.assumptions),
    );
  }

  if (/plus fort.*marge|meilleure marge|potentiel de marge|plus rentable|strongest.*margin|best margin|highest profit/.test(q)) {
    const hits = [...withMarket].sort((a, b) => b.analysis.grossMargin - a.analysis.grossMargin).slice(0, 8);
    return cite(
      hits
        .map((x) => `• ${x.p.name} — marge ${formatPctPoints(x.analysis.grossMargin)}, bénéfice ${formatTnd(x.analysis.grossProfit)} à ${formatTnd(x.selling)}.`)
        .join("\n"),
      facts,
    );
  }

  if (/cette semaine|changement|evolution|resume|marche|this week|market change|biggest change|summary/.test(q)) {
    const since = new Date(Date.now() - 7 * 86400000);
    const obs = await db
      .select()
      .from(priceObservations)
      .where(and(eq(priceObservations.workspaceId, auth.workspace.id), gte(priceObservations.observedAt, since)))
      .orderBy(desc(priceObservations.observedAt))
      .limit(200);
    const meaningful = obs.filter((o) => o.eventType !== "unchanged");
    const down = meaningful.filter((o) => o.eventType === "decrease").length;
    const up = meaningful.filter((o) => o.eventType === "increase").length;
    const sample = meaningful.slice(0, 8);
    const nameOf = (id: string | null) => catalog.find((p) => p.id === id)?.name ?? "—";
    return cite(
      `7 derniers jours : ${meaningful.length} changements de prix significatifs (${down} baisses, ${up} hausses).\n` +
        (sample.length
          ? sample
              .map((o) => `• ${nameOf(o.productId)} — ${fr(o.eventType).toLowerCase()} ${formatTnd(o.previousPriceTnd)} → ${formatTnd(o.priceTnd)}, ${relativeTime(o.observedAt)}${o.isDemo ? " [démo]" : ""}.`)
              .join("\n")
          : "Aucun mouvement de prix enregistré."),
      facts,
    );
  }

  if (/recommand|optimal|quel prix|a quel prix|recommend|what price/.test(q)) {
    const nameMatch = catalog.find(mentionsProduct);
    const target = nameMatch ?? catalog[0];
    if (!target) return cite("Ajoutez d'abord un produit : je pourrai alors recommander un prix à partir des offres relevées.", facts);
    const rec = recommendPrice({
      cost: costFromProduct(target),
      tax: { ...tax, vatRate: n(target.vatRate) || tax.vatRate },
      minMargin: n(target.minProfitMargin),
      currentSellingTtc: n(target.actualSellingPrice),
      targetSellingTtc: n(target.targetSellingPrice),
      offers: offers
        .filter((o) => o.offer.productId === target.id)
        .map((o) => ({
          priceTnd: n(o.offer.priceTnd),
          availability: o.offer.availability,
          matchClass: o.offer.matchClass,
          excludedFromBenchmark: o.offer.excludedFromBenchmark,
          condition: o.offer.condition,
        })),
      strategy: target.savedStrategy ?? "competitive",
    });
    return cite(
      `${target.name} : prix recommandé ${formatTnd(rec.recommendedTtc)} (stratégie ${fr(rec.strategy).toLowerCase()}). Bénéfice attendu ${formatTnd(rec.breakdown.grossProfit)} / marge ${formatPctPoints(rec.breakdown.grossMargin)}. Confiance ${rec.confidence} %. ${rec.explanation}`,
      facts.concat(rec.breakdown.assumptions),
    );
  }

  const mentioned = catalog.filter(mentionsProduct).slice(0, 5);
  if (mentioned.length) {
    return cite(
      mentioned
        .map((p) => {
          const row = withMarket.find((x) => x.p.id === p.id)!;
          return `• ${p.name} — vente ${formatTnd(row.selling)}, coût de revient ${formatTnd(row.analysis.totalAcquisitionCost)}, marge ${formatPctPoints(row.analysis.grossMargin)}, ${row.stats.comparableCount} offre(s) comparable(s), la moins chère à ${row.stats.lowest != null ? formatTnd(row.stats.lowest) : "n/d"}.`;
        })
        .join("\n"),
      facts,
    );
  }

  return cite(
    `Je réponds uniquement à partir de votre catalogue et des prix relevés (${catalog.length} produits, ${offers.length} offres). Essayez : « Quels produits dois-je repositionner aujourd'hui ? », « Quels produits sont sous ma marge minimale ? », « Montre les nouveaux produits » ou « Résume les changements du marché cette semaine ». Je n'invente jamais un prix absent de la base.`,
    facts,
  );
}

function cite(body: string, facts: string[]): string {
  return `${body}\n\n—\nSources et précautions :\n${facts.map((f) => `• ${f}`).join("\n")}\n• Les chiffres proviennent des relevés enregistrés en base ; vérifiez la date du relevé avant de décider.`;
}

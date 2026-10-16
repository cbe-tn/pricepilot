import Link from "next/link";
import { and, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, discoveredListings, notifications, priceObservations, products } from "@/db/schema";
import { ActivityArea, DistributionChart, ProfitBars, TrendChart } from "@/components/Charts";
import { Badge, Card, EmptyState, PageHeader, Stat, Tooltip } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatDay, formatTnd, n, relativeTime } from "@/lib/money";
import { analyzePrice, costFromProduct, marketStats, taxFromWorkspace } from "@/lib/pricing";
import { isSelectedCompetitor } from "@/lib/connectors";

export const metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  const auth = await requirePageAuth();
  const ws = auth.workspace.id;
  const since24h = new Date(Date.now() - 24 * 3600000);
  const since14 = new Date(Date.now() - 14 * 86400000);

  const catalog = await db.select().from(products).where(and(eq(products.workspaceId, ws), isNull(products.archivedAt)));
  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, ws))).filter((c) => !c.isOwnShop && isSelectedCompetitor(c));
  const selectedCompetitorIds = new Set(comps.map((c) => c.id));
  const offers = (await db.select().from(competitorOffers).where(eq(competitorOffers.workspaceId, ws))).filter((o) => selectedCompetitorIds.has(o.competitorId));
  const recentChanges = (await db
    .select()
    .from(priceObservations)
    .where(and(eq(priceObservations.workspaceId, ws), gte(priceObservations.observedAt, since24h), ne(priceObservations.eventType, "unchanged"))))
    .filter((o) => o.competitorId != null && selectedCompetitorIds.has(o.competitorId));
  const discoveries = await db
    .select()
    .from(discoveredListings)
    .where(and(eq(discoveredListings.workspaceId, ws), eq(discoveredListings.status, "new")));
  const alerts = await db
    .select()
    .from(notifications)
    .where(eq(notifications.workspaceId, ws))
    .orderBy(desc(notifications.createdAt))
    .limit(8);
  const obs14 = (await db
    .select()
    .from(priceObservations)
    .where(and(eq(priceObservations.workspaceId, ws), gte(priceObservations.observedAt, since14))))
    .filter((o) => o.competitorId != null && selectedCompetitorIds.has(o.competitorId));

  const tax = taxFromWorkspace(auth.workspace);
  const analyzed = catalog.map((p) => {
    const pOffers = offers.filter((o) => o.productId === p.id);
    const stats = marketStats(
      pOffers.map((o) => ({
        priceTnd: n(o.priceTnd),
        availability: o.availability,
        matchClass: o.matchClass,
        excludedFromBenchmark: o.excludedFromBenchmark,
        condition: o.condition,
      })),
    );
    const analysis = analyzePrice(n(p.actualSellingPrice), costFromProduct(p), { ...tax, vatRate: n(p.vatRate) || tax.vatRate });
    const opportunity = stats.lowest != null && n(p.actualSellingPrice) > stats.lowest && pOffers.some((o) => o.availability === "in_stock");
    return { p, stats, analysis, opportunity };
  });

  const lowProfit = analyzed.filter((a) => a.analysis.grossProfit <= 0 || a.analysis.grossMargin < n(a.p.minProfitMargin));
  const opportunities = analyzed.filter((a) => a.opportunity);
  const avgMarket = analyzed.map((a) => a.stats.average).filter((v): v is number => v != null);
  const avgCompPrice = avgMarket.length ? avgMarket.reduce((s, v) => s + v, 0) / avgMarket.length : 0;
  const diffs = analyzed.filter((a) => a.stats.average != null).map((a) => n(a.p.actualSellingPrice) - (a.stats.average as number));
  const avgDiff = diffs.length ? diffs.reduce((s, v) => s + v, 0) / diffs.length : 0;
  const estProfit = analyzed.reduce((s, a) => s + a.analysis.grossProfit * Math.max(a.p.stockQty, 0), 0);

  const trendMap = new Map<string, Record<string, number | string>>();
  for (const o of obs14) {
    const day = formatDay(o.observedAt);
    const comp = comps.find((c) => c.id === o.competitorId)?.name ?? "Marché";
    const rec = trendMap.get(day) ?? { date: day };
    const prev = typeof rec[comp] === "number" ? (rec[comp] as number) : 0;
    rec[comp] = prev ? (prev + n(o.priceTnd)) / 2 : n(o.priceTnd);
    trendMap.set(day, rec);
  }
  const trendData = [...trendMap.values()].slice(-10);

  const profitBars = analyzed.slice(0, 8).map((a) => ({
    name: (a.p.sku || a.p.name).slice(0, 14),
    profit: Math.round(a.analysis.grossProfit),
    cost: Math.round(a.analysis.totalAcquisitionCost),
    market: Math.round(a.stats.average ?? 0),
  }));

  const buckets = ["<0", "0-5%", "5-10%", "10-20%", "20%+"];
  const dist = buckets.map((bucket) => ({ bucket, count: 0 }));
  for (const a of analyzed) {
    const d = a.stats.lowest == null || !n(a.p.actualSellingPrice) ? null : (n(a.p.actualSellingPrice) - a.stats.lowest) / a.stats.lowest;
    let i = 0;
    if (d == null) continue;
    if (d < 0) i = 0;
    else if (d < 0.05) i = 1;
    else if (d < 0.1) i = 2;
    else if (d < 0.2) i = 3;
    else i = 4;
    dist[i].count += 1;
  }

  const activityMap = new Map<string, { date: string; changes: number; discoveries: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = formatDay(new Date(Date.now() - i * 86400000));
    activityMap.set(d, { date: d, changes: 0, discoveries: 0 });
  }
  for (const o of obs14) {
    const d = formatDay(o.observedAt);
    const rec = activityMap.get(d);
    if (rec && o.eventType !== "unchanged") rec.changes += 1;
  }
  for (const d of discoveries) {
    const day = formatDay(d.firstSeenAt);
    const rec = activityMap.get(day);
    if (rec) rec.discoveries += 1;
  }

  const empty = catalog.length === 0;
  const checklist = [
    { done: true, label: "Espace créé", href: "/settings" },
    { done: catalog.length > 0, label: "Ajouter un premier produit", href: "/products/new" },
    { done: catalog.some((p) => n(p.purchasePrice) > 0), label: "Saisir un prix d'achat", href: "/products" },
    { done: comps.some((c) => c.enabled), label: "Choisir les concurrents suivis", href: "/competitors" },
    { done: offers.length > 0, label: "Obtenir les premiers prix concurrents", href: "/benchmarking" },
    { done: catalog.some((p) => n(p.targetSellingPrice) > 0), label: "Enregistrer une recommandation de prix", href: "/recommendations" },
    { done: auth.settings.inAppNotifications, label: "Activer les notifications", href: "/settings" },
  ];

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        subtitle={`${auth.workspace.name} · chiffres calculés à partir de votre catalogue et des prix concurrents relevés en direct.`}
        actions={
          <>
            <Link href="/products/new" className="inline-flex h-10 items-center rounded-lg bg-[#0b4a56] px-4 text-sm font-medium text-white">
              Ajouter un produit
            </Link>
            <Link href="/benchmarking" className="inline-flex h-10 items-center rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm font-medium text-[#0b4a56]">
              Comparer les prix
            </Link>
          </>
        }
      />

      {empty ? (
        <EmptyState
          title="Votre catalogue est vide"
          body="Ajoutez ou importez vos produits avec leur référence fabricant et leur prix d'achat : les prix de Mytek, SpaceNet, Tunisianet, Zoom, Graiet, Batam, Alarabia et Electro Hadj Kacem sont ensuite récupérés automatiquement."
          action={
            <Link href="/onboarding" className="inline-flex h-10 items-center rounded-lg bg-[#d4a017] px-4 text-sm font-semibold text-[#3b2a00]">
              Démarrer la configuration guidée
            </Link>
          }
        />
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Produits suivis" value={catalog.length} hint={`${catalog.filter((p) => p.actualSellingPrice != null).length} avec un prix de vente`} />
        <Stat label="Concurrents surveillés" value={comps.filter((c) => c.enabled).length} hint={`${comps.length} sources configurées`} />
        <Stat label="Changements de prix (24 h)" value={recentChanges.length} hint="Variations significatives uniquement" tone={recentChanges.length ? "warn" : undefined} />
        <Stat label="Nouveaux produits concurrents" value={discoveries.length} hint="Pas encore dans votre catalogue" />
        <Stat label="Bénéfice faible / négatif" value={lowProfit.length} tone={lowProfit.length ? "bad" : "ok"} hint="Par rapport à votre marge minimale" />
        <Stat
          label="Opportunités de prix"
          value={opportunities.length}
          tone={opportunities.length ? "warn" : "ok"}
          hint="Concurrent moins cher et en stock"
        />
        <Stat
          label={
            <>
              Prix moyen concurrents <Tooltip text="Moyenne des prix marché comparables de chaque produit, en DT TTC." />
            </>
          }
          value={formatTnd(avgCompPrice)}
        />
        <Stat label="Écart de prix moyen" value={formatTnd(avgDiff)} hint="Votre prix de vente moins la moyenne du marché" />
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-3">
        <Stat label="Bénéfice estimé du stock" value={formatTnd(estProfit)} hint="Bénéfice brut × unités en stock (pas une prévision de trésorerie)" />
        <Card className="lg:col-span-2">
          <p className="text-sm font-semibold">Pour bien démarrer</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checklist.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="flex items-center gap-2 text-sm">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${c.done ? "bg-[#e5f6ee] text-[#0c8a62]" : "bg-[#eef3f5] text-[#6b858c]"}`}>
                    {c.done ? "✓" : "•"}
                  </span>
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Évolution des prix concurrents</h2>
          </div>
          {trendData.length ? <TrendChart data={trendData} /> : <p className="text-sm text-[#6b858c]">Pas encore assez d’historique.</p>}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Coût d’achat, marché et bénéfice</h2>
          {profitBars.length ? <ProfitBars data={profitBars} /> : <p className="text-sm text-[#6b858c]">Ajoutez des produits pour afficher ce graphique.</p>}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">
            Écart avec le concurrent le moins cher <Tooltip text="De combien votre prix de vente dépasse l'offre comparable la moins chère." />
          </h2>
          <DistributionChart data={dist} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Changements de prix et nouveaux produits</h2>
          <ActivityArea data={[...activityMap.values()]} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Alertes récentes</h2>
            <Link href="/notifications" className="text-sm text-[#0b4a56]">
              Tout voir
            </Link>
          </div>
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link href={a.href ?? "/notifications"} className="block rounded-lg p-2 hover:bg-[#f4f8f9]">
                  <p className="text-sm font-medium">
                    {a.title} {!a.readAt ? <Badge tone="gold">Non lue</Badge> : null}
                  </p>
                  <p className="text-xs text-[#6b858c]">
                    {relativeTime(a.createdAt)} · {a.body}
                  </p>
                </Link>
              </li>
            ))}
            {!alerts.length ? <p className="text-sm text-[#6b858c]">Aucune alerte pour le moment.</p> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">À surveiller</h2>
          <ul className="space-y-2">
            {lowProfit.slice(0, 6).map((a) => (
              <li key={a.p.id} className="flex items-center justify-between text-sm">
                <Link href={`/products/${a.p.id}`} className="font-medium text-[#0b4a56]">
                  {a.p.name}
                </Link>
                <span className="tabular-nums text-[#c53d3d]">{formatTnd(a.analysis.grossProfit)}</span>
              </li>
            ))}
            {!lowProfit.length ? <p className="text-sm text-[#0c8a62]">Tous les produits suivis respectent la marge minimale.</p> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

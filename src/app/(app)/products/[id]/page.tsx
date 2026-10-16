import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, priceObservations, products } from "@/db/schema";
import { HistoryChart } from "@/components/Charts";
import { ManualOfferForm, OfferReview, ReferenceSearch, SaveStrategyForm, ScrollPanel, Simulator } from "@/components/ClientWidgets";
import { Badge, Card, DemoChip, PageHeader } from "@/components/ui";
import { archiveProductAction, deleteProductAction, duplicateProductAction, restoreProductAction } from "@/lib/actions";
import { requirePageAuth } from "@/lib/page-auth";
import { formatDay, formatPctPoints, formatTnd, formatWhen, n, relativeTime, signedTnd } from "@/lib/money";
import { fr } from "@/lib/labels";
import { analyzePrice, costFromProduct, marketStats, recommendPrice, taxFromWorkspace } from "@/lib/pricing";
import { isSelectedCompetitor } from "@/lib/connectors";

export const metadata = { title: "Fiche produit" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAuth();
  const { id } = await params;
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!p) notFound();

  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop && isSelectedCompetitor(c));
  const selectedCompetitorIds = new Set(comps.map((c) => c.id));
  const offers = (await db
    .select()
    .from(competitorOffers)
    .where(and(eq(competitorOffers.workspaceId, auth.workspace.id), eq(competitorOffers.productId, id)))).filter((o) => o.userReview !== "reject" && selectedCompetitorIds.has(o.competitorId));
  const obs = (await db
    .select()
    .from(priceObservations)
    .where(and(eq(priceObservations.workspaceId, auth.workspace.id), eq(priceObservations.productId, id)))
    .orderBy(desc(priceObservations.observedAt))
    .limit(400)).filter((o) => o.competitorId != null && selectedCompetitorIds.has(o.competitorId));

  const tax = taxFromWorkspace(auth.workspace, p.vatRate);
  const cost = costFromProduct(p);
  const analysis = analyzePrice(n(p.actualSellingPrice), cost, tax);
  const snapshots = offers.map((o) => ({
    priceTnd: n(o.priceTnd),
    availability: o.availability,
    matchClass: o.matchClass,
    excludedFromBenchmark: o.excludedFromBenchmark,
    condition: o.condition,
  }));
  const market = marketStats(snapshots);
  const strategies = (["competitive", "balanced", "premium"] as const).map((strategy) => {
    const rec = recommendPrice({
      cost,
      tax,
      minMargin: n(p.minProfitMargin),
      currentSellingTtc: n(p.actualSellingPrice),
      targetSellingTtc: n(p.targetSellingPrice),
      offers: snapshots,
      strategy,
      advantages: { warranty: Boolean(p.warranty), inStockWhileOthersOut: p.stockQty > 0 && offers.some((o) => o.availability === "out_of_stock") },
    });
    return rec;
  });

  const chartMap = new Map<string, Record<string, string | number>>();
  for (const o of [...obs].reverse()) {
    const day = formatDay(o.observedAt);
    const rec = chartMap.get(day) ?? { date: day, purchase: analysis.totalAcquisitionCost, selling: n(p.actualSellingPrice) };
    const cname = comps.find((c) => c.id === o.competitorId)?.name ?? "Offre";
    rec[cname] = n(o.priceTnd);
    chartMap.set(day, rec);
  }
  const recPrice = strategies.find((s) => s.strategy === (p.savedStrategy ?? "competitive"))?.recommendedTtc ?? 0;
  const chartData: Array<{ date: string; purchase?: number; selling?: number; recommended?: number; [k: string]: string | number | undefined }> = [
    ...chartMap.values(),
  ].map((r) => {
    const date = String(r.date);
    const row: { date: string; purchase?: number; selling?: number; recommended?: number; [k: string]: string | number | undefined } = {
      date,
      recommended: recPrice,
    };
    for (const [k, v] of Object.entries(r)) {
      row[k] = v;
    }
    return row;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.name}
        subtitle={`${p.brand ?? ""} ${p.model ?? ""} · Réf. ${p.manufacturerRef ?? "—"} · SKU ${p.sku ?? "—"}`}
        actions={
          <>
            {p.isDemo ? <DemoChip /> : null}
            <Link href={`/products/${p.id}/edit`} className="inline-flex h-10 items-center rounded-lg bg-[#0b4a56] px-4 text-sm text-white">
              Modifier
            </Link>
            <form action={duplicateProductAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className="h-10 rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm">Dupliquer</button>
            </form>
            {p.archivedAt ? (
              <form action={restoreProductAction}>
                <input type="hidden" name="id" value={p.id} />
                <button className="h-10 rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm">Restaurer</button>
              </form>
            ) : (
              <form action={archiveProductAction}>
                <input type="hidden" name="id" value={p.id} />
                <button className="h-10 rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm">Archiver</button>
              </form>
            )}
            {auth.user.role !== "staff" ? (
              <form action={deleteProductAction}>
                <input type="hidden" name="id" value={p.id} />
                <button className="h-10 rounded-lg px-4 text-sm text-[#c53d3d]">Supprimer</button>
              </form>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <K k="Prix d'achat HT" v={formatTnd(p.purchasePrice)} />
        <K k="Coût de revient total" v={formatTnd(analysis.totalAcquisitionCost)} />
        <K k="Prix de vente TTC" v={formatTnd(p.actualSellingPrice)} />
        <K k="Bénéfice brut / unité" v={formatTnd(analysis.grossProfit)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <h2 className="font-semibold">Offres concurrentes ({offers.length})</h2>
          <p className="mb-3 text-sm text-[#4d6a72]">Les correspondances reposent sur la référence, le code-barres et les caractéristiques — jamais sur le nom seul. Confirmez ou rejetez les cas incertains.</p>
          <ScrollPanel maxHeight="60vh">
            <table className="pp-table pp-compact pp-sticky-col">
              <thead>
                <tr>
                  <th>Concurrent</th>
                  <th className="text-right">Prix</th>
                  <th>Dispo.</th>
                  <th>Correspondance</th>
                  <th className="text-right" title="Prix concurrent moins notre coût de revient">
                    vs coût
                  </th>
                  <th className="text-right" title="Prix concurrent moins notre prix de vente">
                    vs notre prix
                  </th>
                  <th className="text-right" title="Variation depuis le relevé précédent">
                    Tendance
                  </th>
                  <th>Vérifié / action</th>
                </tr>
              </thead>
              <tbody>
                {offers
                  .slice()
                  .sort((a, b) => n(a.priceTnd) - n(b.priceTnd))
                  .map((o) => {
                    const c = comps.find((x) => x.id === o.competitorId);
                    const hist = obs.filter((x) => x.offerId === o.id);
                    const prev = hist[1] ? n(hist[1].priceTnd) : n(o.priceTnd);
                    const delta = n(o.priceTnd) - prev;
                    return (
                      <tr key={o.id}>
                        <td className="max-w-[150px]">
                          <div className="truncate font-medium" title={o.title ?? c?.name}>
                            {c?.name}
                          </div>
                          {o.url ? (
                            <a href={o.url} className="text-[11px] text-[#1b6f9a] underline" target="_blank" rel="noreferrer">
                              Voir l’offre
                            </a>
                          ) : null}
                          {o.isDemo ? (
                            <div>
                              <DemoChip />
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatTnd(o.priceTnd)}</td>
                        <td>
                          <Badge tone={o.availability === "in_stock" ? "ok" : o.availability === "out_of_stock" ? "bad" : "warn"}>{fr(o.availability)}</Badge>
                        </td>
                        <td>
                          <Badge tone={o.matchClass === "exact" ? "ok" : o.matchClass === "strong" ? "teal" : "warn"}>
                            {fr(o.matchClass)} {o.matchConfidence} %
                          </Badge>
                          <div className="line-clamp-2 max-w-[240px] text-[11px] text-[#6b858c]" title={o.matchReason ?? undefined}>
                            {o.matchReason}
                          </div>
                          {o.excludedFromBenchmark ? <Badge tone="bad">Exclue</Badge> : null}
                        </td>
                        <td className="whitespace-nowrap text-right tabular-nums">{signedTnd(n(o.priceTnd) - analysis.totalAcquisitionCost)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{signedTnd(n(o.priceTnd) - n(p.actualSellingPrice))}</td>
                        <td className={`whitespace-nowrap text-right tabular-nums ${delta < 0 ? "text-[#0c8a62]" : delta > 0 ? "text-[#c53d3d]" : ""}`}>
                          {delta === 0 ? "—" : signedTnd(delta)}
                        </td>
                        <td>
                          <div className="text-[11px] text-[#6b858c]">{relativeTime(o.lastCheckedAt)}</div>
                          <OfferReview offerId={o.id} productId={p.id} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </ScrollPanel>
          <p className="mt-4 rounded-lg bg-[#f4f8f9] p-3 text-xs text-[#4d6a72]">
            Les offres concurrentes sont trouvées automatiquement à partir de la référence du produit
            {p.manufacturerRef ? <> (<span className="font-mono">{p.manufacturerRef}</span>)</> : null} et leurs prix sont revérifiés à
            chaque passage de la surveillance.{" "}
            {p.lastMatchedAt ? `Dernière recherche automatique : ${relativeTime(p.lastMatchedAt)}.` : "Recherche automatique en attente — les résultats apparaîtront ici d'ici quelques minutes."}
          </p>
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Recherche manuelle (facultatif)</h3>
            <ReferenceSearch productId={p.id} defaultReference={p.manufacturerRef || p.model || p.name} />
          </div>
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">URL manuelle / prix relevé</h3>
            <ManualOfferForm productId={p.id} competitors={comps.map((c) => ({ id: c.id, name: c.name }))} />
          </div>
        </Card>
        <Card>
          <h2 className="font-semibold">Recommandation</h2>
          <p className="mt-1 text-sm text-[#4d6a72]">{strategies.find((s) => s.strategy === (p.savedStrategy ?? "competitive"))?.explanation}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <Row k="Plus bas comparable" v={market.lowest != null ? formatTnd(market.lowest) : "—"} />
            <Row k="Médiane" v={market.median != null ? formatTnd(market.median) : "—"} />
            <Row k="Moyenne" v={market.average != null ? formatTnd(market.average) : "—"} />
            <Row k="Plus haut" v={market.highest != null ? formatTnd(market.highest) : "—"} />
            <Row k="Seuil de rentabilité TTC" v={formatTnd(strategies[1]?.breakEvenTtc)} />
            <Row k="Minimum acceptable TTC" v={formatTnd(strategies[1]?.minAcceptableTtc)} />
            <Row k="Marge attendue" v={formatPctPoints(analysis.grossMargin)} />
          </dl>
          <div className="mt-4">
            <SaveStrategyForm
              productId={p.id}
              initial={p.savedStrategy ?? "competitive"}
              strategies={strategies.map((s) => ({
                key: s.strategy,
                price: s.recommendedTtc,
                profit: s.breakdown.grossProfit,
                margin: s.breakdown.grossMargin,
                flagged: s.flaggedLoss || s.policyViolation,
              }))}
            />
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Historique des prix</h2>
          {chartData.length ? <HistoryChart data={chartData} /> : <p className="text-sm text-[#6b858c]">Aucun relevé pour le moment.</p>}
        <div className="pp-table-wrap mt-4">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Événement</th>
                <th>Avant</th>
                <th>Après</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {obs
                .filter((o) => o.eventType !== "unchanged")
                .slice(0, 12)
                .map((o) => (
                  <tr key={o.id}>
                    <td>{formatWhen(o.observedAt)}</td>
                    <td>{fr(o.eventType)}</td>
                    <td>{formatTnd(o.previousPriceTnd)}</td>
                    <td>{formatTnd(o.priceTnd)}</td>
                    <td>
                      {comps.find((c) => c.id === o.competitorId)?.name}
                      {o.isDemo ? " · démo" : ""}
                      {o.checkFailed ? " · vérification échouée" : ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Simulator cost={cost} tax={tax} minMargin={n(p.minProfitMargin)} current={n(p.actualSellingPrice) || n(p.targetSellingPrice)} market={market} />

      <Card>
        <h2 className="font-semibold">Hypothèses de calcul</h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-[#4d6a72]">
          {analysis.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {p.specifications && Object.keys(p.specifications).length ? (
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(p.specifications).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-[#f4f8f9] p-2 text-sm">
                <span className="text-[#6b858c]">{k}: </span>
                {v}
              </div>
            ))}
          </dl>
        ) : null}
      </Card>
    </div>
  );
}

function K({ k, v }: { k: string; v: string }) {
  return (
    <div className="pp-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-[#6b858c]">{k}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{v}</p>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[#6b858c]">{k}</dt>
      <dd className="tabular-nums font-medium">{v}</dd>
    </div>
  );
}

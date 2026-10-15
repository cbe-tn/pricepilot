import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitors, priceObservations, products } from "@/db/schema";
import { ActivityArea } from "@/components/Charts";
import { Badge, Card, DemoChip, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatDay, formatTnd, formatWhen, signedPct } from "@/lib/money";
import { n } from "@/lib/money";
import { fr } from "@/lib/labels";

export const metadata = { title: "Historique des prix" };

export default async function HistoryPage() {
  const auth = await requirePageAuth();
  const obs = await db
    .select()
    .from(priceObservations)
    .where(eq(priceObservations.workspaceId, auth.workspace.id))
    .orderBy(desc(priceObservations.observedAt))
    .limit(250);
  const catalog = await db.select().from(products).where(eq(products.workspaceId, auth.workspace.id));
  const comps = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop);

  const activityMap = new Map<string, { date: string; changes: number; discoveries: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = formatDay(new Date(Date.now() - i * 86400000));
    activityMap.set(d, { date: d, changes: 0, discoveries: 0 });
  }
  for (const o of obs) {
    const d = formatDay(o.observedAt);
    const rec = activityMap.get(d);
    if (rec && o.eventType !== "unchanged") rec.changes += 1;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Historique et détection des changements de prix"
        subtitle="Les vérifications sans changement ne déclenchent pas d'alerte. Une vérification échouée est marquée « à vérifier » et n'est jamais interprétée comme une suppression."
      />
      <Card>
        <h2 className="mb-3 font-semibold">Activité (14 jours)</h2>
        <ActivityArea data={[...activityMap.values()]} />
      </Card>
      <div className="pp-table-wrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Produit</th>
              <th>Source</th>
              <th>Événement</th>
              <th>Avant</th>
              <th>Après</th>
              <th>Variation</th>
            </tr>
          </thead>
          <tbody>
            {obs
              .filter((o) => o.eventType !== "unchanged")
              .map((o) => {
                const p = catalog.find((x) => x.id === o.productId);
                const prev = n(o.previousPriceTnd);
                const next = n(o.priceTnd);
                const pct = prev ? (next - prev) / prev : 0;
                return (
                  <tr key={o.id}>
                    <td>{formatWhen(o.observedAt)}</td>
                    <td>
                      {p ? (
                        <Link href={`/products/${p.id}`} className="text-[#0b4a56]">
                          {p.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {comps.find((c) => c.id === o.competitorId)?.name}
                      {o.isDemo ? (
                        <div>
                          <DemoChip />
                        </div>
                      ) : null}
                      {o.checkFailed ? <Badge tone="warn">à vérifier</Badge> : null}
                    </td>
                    <td>
                      <Badge tone={o.eventType === "decrease" ? "ok" : o.eventType === "increase" ? "bad" : "info"}>{fr(o.eventType)}</Badge>
                    </td>
                    <td className="tabular-nums">{formatTnd(o.previousPriceTnd)}</td>
                    <td className="tabular-nums">{formatTnd(o.priceTnd)}</td>
                    <td className="tabular-nums">{signedPct(pct)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

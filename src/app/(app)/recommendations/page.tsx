import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, products } from "@/db/schema";
import { Badge, Card, DemoChip, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatPctPoints, formatTnd, n } from "@/lib/money";
import { costFromProduct, recommendPrice, taxFromWorkspace } from "@/lib/pricing";
import { fr } from "@/lib/labels";

export const metadata = { title: "Recommandations" };

export default async function RecommendationsPage() {
  const auth = await requirePageAuth();
  const catalog = await db.select().from(products).where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const offers = await db.select().from(competitorOffers).where(eq(competitorOffers.workspaceId, auth.workspace.id));
  const tax = taxFromWorkspace(auth.workspace);

  const rows = catalog.map((p) => {
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

  return (
    <div>
      <PageHeader
        title="Recommandations de prix"
        subtitle="À quel prix vendre pour rester compétitif sans sacrifier votre marge ? Les stratégies ne descendent jamais sous votre prix plancher."
      />
      <div className="grid gap-3">
        {rows.map(({ p, rec }) => (
          <Card key={p.id} className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/products/${p.id}`} className="text-lg font-semibold text-[#0b4a56]">
                  {p.name}
                </Link>
                {p.isDemo ? <DemoChip /> : null}
                {rec.flaggedLoss || rec.policyViolation ? <Badge tone="bad">Hors politique / perte</Badge> : <Badge tone="ok">Conforme à la politique</Badge>}
                <Badge>{fr(rec.strategy)}</Badge>
              </div>
              <p className="mt-2 text-sm text-[#4d6a72]">{rec.explanation}</p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  Actuel {formatTnd(p.actualSellingPrice)}
                  <div className="text-xs text-[#6b858c]">Votre prix TTC</div>
                </div>
                <div>
                  Recommandé {formatTnd(rec.recommendedTtc)}
                  <div className="text-xs text-[#6b858c]">Confiance {rec.confidence} %</div>
                </div>
                <div>
                  Bénéfice {formatTnd(rec.breakdown.grossProfit)} · {formatPctPoints(rec.breakdown.grossMargin)}
                  <div className="text-xs text-[#6b858c]">Après TVA et coûts variables</div>
                </div>
              </dl>
            </div>
            <Link href={`/products/${p.id}`} className="h-10 self-start rounded-lg bg-[#d4a017] px-4 text-sm font-semibold leading-10 text-[#3b2a00]">
              Voir la recommandation
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}

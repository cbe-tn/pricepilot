// Product × competitor price matrix, mirroring the manual "STOCK / Spacenet / Mytek / Tunisianet" sheet:
// purchase TTC, our selling price and margin, then each competitor's price and the margin it implies.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, products, workspaces, type Competitor, type Product } from "@/db/schema";
import { n, round3 } from "@/lib/money";
import { costFromProduct, recommendPrice, taxFromWorkspace } from "@/lib/pricing";
import type { MatchClass } from "@/lib/matching";

export type BenchmarkCell = {
  priceTnd: number;
  /** Margin over our purchase TTC if we sold at this price: (price − cost) / price. */
  marginPct: number | null;
  availability: string;
  url: string | null;
  matchClass: string;
  isDemo: boolean;
  stale: boolean;
  seller: string | null;
  /** Listing title on the competitor site. */
  title: string;
};

export type BenchmarkRow = {
  product: Product;
  purchaseHt: number;
  purchaseTtc: number;
  ourPrice: number | null;
  ourMarginPct: number | null;
  ourMarginTnd: number | null;
  cells: Record<string, BenchmarkCell | undefined>;
  cheapest: { competitorId: string; priceTnd: number } | null;
  /** Our price minus the cheapest competitor (negative = we are cheaper). */
  gapToCheapest: number | null;
  /**
   * Competitive recommendation: 1 DT under the cheapest in-stock competitor, never below the minimum
   * margin. "floor" = the cheapest cannot be beaten profitably, so the price stops at the minimum.
   */
  recommendation: { priceTnd: number; marginPct: number | null; kind: "beat" | "floor"; reference: number } | null;
};

export type BenchmarkMatrix = { competitors: Competitor[]; rows: BenchmarkRow[]; ownShop: Competitor | null };

function margin(price: number, cost: number): number | null {
  return price > 0 ? (price - cost) / price : null;
}

export async function buildBenchmarkMatrix(workspaceId: string, opts?: { includeDemo?: boolean; category?: string }): Promise<BenchmarkMatrix> {
  const all = (await db.select().from(competitors).where(eq(competitors.workspaceId, workspaceId))).sort((a, b) => a.name.localeCompare(b.name));
  // Our own web shop is indexed like a competitor but never benchmarked against.
  const comps = all.filter((c) => !c.isOwnShop);
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const catalog = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, workspaceId), isNull(products.archivedAt), opts?.category ? eq(products.category, opts.category) : undefined));
  const offers = await db
    .select()
    .from(competitorOffers)
    .where(and(eq(competitorOffers.workspaceId, workspaceId), eq(competitorOffers.excludedFromBenchmark, false)));

  const rows = catalog
    .filter((p) => opts?.includeDemo || !p.isDemo)
    .map((p): BenchmarkRow => {
      const purchaseHt = n(p.purchasePrice) * (n(p.exchangeRate) || 1) + n(p.shippingCost) + n(p.importCost) + n(p.otherCosts);
      const purchaseTtc = round3(purchaseHt * (1 + n(p.vatRate)));
      const ourPrice = p.actualSellingPrice != null ? n(p.actualSellingPrice) : null;
      const cells: BenchmarkRow["cells"] = {};
      for (const c of comps) {
        // Lowest comparable price per competitor; in-stock offers win over out-of-stock ones.
        const mine = offers
          .filter((o) => o.productId === p.id && o.competitorId === c.id && (opts?.includeDemo || !o.isDemo))
          .sort((a, b) => Number(a.availability === "out_of_stock") - Number(b.availability === "out_of_stock") || n(a.priceTnd) - n(b.priceTnd));
        const o = mine[0];
        if (!o) continue;
        cells[c.id] = {
          priceTnd: n(o.priceTnd),
          marginPct: margin(n(o.priceTnd), purchaseTtc),
          availability: o.availability,
          url: o.url,
          matchClass: o.matchClass,
          isDemo: o.isDemo,
          stale: o.stale,
          seller: o.sellerName,
          title: o.title,
        };
      }
      // Recommend from exactly the prices shown in the row (one per competitor), so "cheapest" and
      // "prix conseillé" always agree. Matches the user rejected are already excluded from the matrix.
      const shown = Object.values(cells).filter((c): c is BenchmarkCell => Boolean(c));
      const rec = recommendPrice({
        cost: costFromProduct(p),
        tax: taxFromWorkspace(ws, p.vatRate),
        minMargin: n(p.minProfitMargin),
        currentSellingTtc: ourPrice ?? 0,
        targetSellingTtc: p.targetSellingPrice != null ? n(p.targetSellingPrice) : null,
        offers: shown.map((c) => ({
          priceTnd: c.priceTnd,
          availability: c.availability,
          matchClass: "exact" as MatchClass,
          excludedFromBenchmark: false,
          condition: "new",
        })),
        strategy: "competitive",
      });
      const recReference = rec.market.lowestInStock ?? rec.market.lowest;
      const recommendation =
        recReference != null && n(p.purchasePrice) > 0
          ? { priceTnd: rec.recommendedTtc, marginPct: margin(rec.recommendedTtc, purchaseTtc), kind: rec.policyViolation ? ("floor" as const) : ("beat" as const), reference: recReference }
          : null;
      const priced = Object.entries(cells).filter((e): e is [string, BenchmarkCell] => Boolean(e[1]) && e[1]!.availability !== "out_of_stock");
      const low = priced.sort((a, b) => a[1].priceTnd - b[1].priceTnd)[0];
      return {
        product: p,
        purchaseHt: round3(purchaseHt),
        purchaseTtc,
        ourPrice,
        ourMarginPct: ourPrice != null ? margin(ourPrice, purchaseTtc) : null,
        ourMarginTnd: ourPrice != null ? round3(ourPrice - purchaseTtc) : null,
        cells,
        cheapest: low ? { competitorId: low[0], priceTnd: low[1].priceTnd } : null,
        gapToCheapest: low && ourPrice != null ? round3(ourPrice - low[1].priceTnd) : null,
        recommendation,
      };
    })
    .sort((a, b) => (a.product.category ?? "").localeCompare(b.product.category ?? "") || a.product.name.localeCompare(b.product.name));

  return { competitors: comps, rows, ownShop: all.find((c) => c.isOwnShop) ?? null };
}

// Server side of the Marketing Studio: catalogue facts for posters and official product photos.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, type Product } from "@/db/schema";
import { buildBenchmarkMatrix, type BenchmarkRow } from "@/lib/benchmark";
import { fetchWithTimeout, isAllowedByRobots } from "@/lib/extract";
import { n } from "@/lib/money";
import type { PosterProduct } from "@/lib/poster";

function toPosterProduct(r: BenchmarkRow, compNames: Map<string, string>): PosterProduct {
  const p = r.product;
  return {
    id: p.id,
    name: p.name,
    ref: p.manufacturerRef ?? p.model ?? null,
    category: p.category,
    stockQty: p.stockQty,
    ownStatus: p.ownStatus,
    ownUrl: p.ownUrl,
    ownPrice: p.ownPriceTnd != null ? n(p.ownPriceTnd) : null,
    ownCheckedAt: p.ownCheckedAt ? p.ownCheckedAt.toISOString() : null,
    costTtc: n(p.purchasePrice) > 0 ? r.purchaseTtc : 0,
    minMargin: n(p.minProfitMargin),
    hasPhoto: p.ownStatus === "found" && Boolean(p.ownUrl),
    competitors: Object.entries(r.cells).flatMap(([id, c]) =>
      c && !c.isDemo
        ? [{ name: compNames.get(id) ?? "?", price: c.priceTnd, availability: c.availability, url: c.url, checkedAt: c.checkedAt.toISOString(), matchClass: c.matchClass }]
        : [],
    ),
  };
}

/** Catalogue facts for every active product (or only `ids`, in that order). */
export async function loadPosterProducts(workspaceId: string, ids?: string[]): Promise<PosterProduct[]> {
  const matrix = await buildBenchmarkMatrix(workspaceId);
  const names = new Map(matrix.competitors.map((c) => [c.id, c.name]));
  const all = matrix.rows.map((r) => toPosterProduct(r, names));
  if (!ids) return all;
  const byId = new Map(all.map((p) => [p.id, p]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

const OG_IMAGE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i;

/**
 * Official photo of a product: the image our own web shop publishes for it (og:image of the confirmed
 * listing). Found once, then kept in products.image_url.
 */
export async function officialPhotoUrl(product: Product): Promise<string | null> {
  if (product.imageUrl) return product.imageUrl;
  if (product.ownStatus !== "found" || !product.ownUrl) return null;
  if (!(await isAllowedByRobots(product.ownUrl))) return null;
  try {
    const res = await fetchWithTimeout(product.ownUrl);
    if (!res.ok) return null;
    const m = (await res.text()).match(OG_IMAGE);
    const raw = m?.[1] ?? m?.[2];
    if (!raw) return null;
    const url = new URL(raw.replace(/&amp;/g, "&"), product.ownUrl).toString();
    // The shop's generic logo is not a product photo.
    if (/\/logo\.[a-z]+$/i.test(url)) return null;
    await db.update(products).set({ imageUrl: url }).where(and(eq(products.id, product.id), eq(products.workspaceId, product.workspaceId)));
    return url;
  } catch {
    return null;
  }
}

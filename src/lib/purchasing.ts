// Supplier price comparison: every quote is grouped by article (catalogue product when its reference,
// SKU or barcode is known, otherwise the normalised supplier reference), keeping the latest price of
// each supplier. All quotes are stored HT, so suppliers compare on the same basis.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products, supplierQuotes, suppliers, type Product } from "@/db/schema";
import { deriveIdentity } from "@/lib/identity";
import { normalizeBarcode, normalizeRef } from "@/lib/matching";
import { n } from "@/lib/money";

export type SupplierPrice = { quoteId: string; price: number; quotedAt: Date; qty: number | null; supplierRef: string | null };

export type ComparisonRow = {
  key: string;
  ref: string;
  name: string;
  productId: string | null;
  /** Our current purchase price in the catalogue (HT), for the saving column. */
  currentPurchase: number | null;
  prices: Record<string, SupplierPrice>;
  bestSupplierId: string;
  bestPrice: number;
  /** Second-best price among the other suppliers (null when only one supplier quotes the article). */
  secondPrice: number | null;
};

export type Comparison = {
  suppliers: Array<{ id: string; name: string }>;
  rows: ComparisonRow[];
};

/** A usable comparison key: a code with a digit, not a bare small number ("3EN1" style tokens excluded upstream). */
function usableKey(k: string): boolean {
  return k.length >= 4 && /\d/.test(k) && (/[A-Z]/.test(k) || k.length >= 6);
}

/**
 * Catalogue lookup by normalised manufacturer reference, SKU, barcode and model (from the model field
 * or read from the product name), so a supplier line giving only "Canon Pixma G3410" still matches.
 */
export function productIndex(catalog: Product[]): Map<string, Product> {
  const idx = new Map<string, Product>();
  for (const p of catalog) {
    if (p.archivedAt) continue;
    const keys = [normalizeRef(p.manufacturerRef), normalizeRef(p.sku), normalizeBarcode(p.barcode), normalizeRef(p.model), normalizeRef(deriveIdentity(p.name).reference)];
    for (const k of keys) if (usableKey(k) && !idx.has(k)) idx.set(k, p);
  }
  return idx;
}

/**
 * Keys under which a supplier line is compared: its own reference and the model read from its
 * designation. Suppliers that print the part number (0727C067) and those that only name the model
 * (MG2541S) meet through lines carrying both.
 */
export function lineKeys(ref: string | null | undefined, name: string | null | undefined): string[] {
  const keys = [normalizeRef(ref), normalizeRef(name ? deriveIdentity(name).reference : null)];
  return [...new Set(keys.filter(usableKey))];
}

/** Main reference shown for a supplier line. */
export function lineReference(ref: string | null | undefined, name: string | null | undefined): string {
  return lineKeys(ref, name)[0] ?? "";
}

export function matchProduct(idx: Map<string, Product>, ref: string | null | undefined, name: string | null | undefined): Product | null {
  for (const k of lineKeys(ref, name)) {
    const p = idx.get(k);
    if (p) return p;
  }
  return null;
}

function nameKey(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function buildSupplierComparison(workspaceId: string): Promise<Comparison> {
  const [sups, quotes, catalog] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.workspaceId, workspaceId)),
    db.select().from(supplierQuotes).where(eq(supplierQuotes.workspaceId, workspaceId)),
    db.select().from(products).where(eq(products.workspaceId, workspaceId)),
  ]);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const idx = productIndex(catalog);
  const now = Date.now();
  const live = quotes.filter((q) => !(q.expiresAt && q.expiresAt.getTime() < now) && n(q.quotedPrice) > 0);

  // Union-find over quotes: two quotes are the same article when they share a key
  // (catalogue product, supplier reference or model read from the designation).
  const parent = live.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  const lineProducts = live.map((q) => (q.productId && byId.get(q.productId)) || matchProduct(idx, q.productRef, q.productName));
  live.forEach((q, i) => {
    const keys = lineKeys(q.productRef, q.productName);
    if (lineProducts[i]) keys.push(`p:${lineProducts[i]!.id}`);
    if (!keys.length && q.productName) keys.push(`n:${nameKey(q.productName)}`);
    for (const k of keys) {
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });

  const groups = new Map<number, ComparisonRow>();
  live.forEach((q, i) => {
    const root = find(i);
    const product = lineProducts[i];
    let row = groups.get(root);
    if (!row) {
      row = { key: q.id, ref: "", name: "", productId: null, currentPurchase: null, prices: {}, bestSupplierId: "", bestPrice: 0, secondPrice: null };
      groups.set(root, row);
    }
    if (product && !row.productId) {
      row.productId = product.id;
      row.name = product.name;
      row.ref = product.manufacturerRef || row.ref;
      row.currentPurchase = n(product.purchasePrice) > 0 ? n(product.purchasePrice) : null;
    }
    if (!row.ref) row.ref = q.productRef || lineReference(q.productRef, q.productName);
    if (!row.name && q.productName) row.name = q.productName;
    const prev = row.prices[q.supplierId];
    // Latest quote of each supplier wins (a newer price list replaces the older one).
    if (!prev || q.quotedAt > prev.quotedAt) {
      row.prices[q.supplierId] = { quoteId: q.id, price: n(q.quotedPrice), quotedAt: q.quotedAt, qty: q.availability && /^\d+$/.test(q.availability) ? Number(q.availability) : null, supplierRef: q.productRef };
    }
  });

  const rows = [...groups.values()].map((row) => {
    const sorted = Object.entries(row.prices).sort((a, b) => a[1].price - b[1].price);
    row.bestSupplierId = sorted[0][0];
    row.bestPrice = sorted[0][1].price;
    row.secondPrice = sorted[1]?.[1].price ?? null;
    return row;
  });
  rows.sort((a, b) => Object.keys(b.prices).length - Object.keys(a.prices).length || a.name.localeCompare(b.name, "fr"));

  // Only suppliers that quote something, in name order.
  const quoting = new Set(rows.flatMap((r) => Object.keys(r.prices)));
  return {
    suppliers: sups.filter((s) => quoting.has(s.id)).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    rows,
  };
}

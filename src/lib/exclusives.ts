import type { BenchmarkRow } from "@/lib/benchmark";

const hasReference = (r: BenchmarkRow) => Boolean(r.product.manufacturerRef?.trim() || r.product.barcode?.trim());

/** Online on our web shop, already searched on competitor sites, and no selected competitor carries it. */
function notFoundElsewhere(r: BenchmarkRow): boolean {
  return r.product.ownStatus === "found" && r.product.lastMatchedAt != null && !Object.values(r.cells).some(Boolean);
}

/**
 * Products only we sell. A reference (or barcode) is required: without one the competitor search
 * has nothing reliable to match on, so "not found" says little — those go to {@link isUnverifiedExclusive}.
 */
export function isExclusive(r: BenchmarkRow): boolean {
  return notFoundElsewhere(r) && hasReference(r);
}

/** Not found at any competitor, but without a reference: to check by hand. */
export function isUnverifiedExclusive(r: BenchmarkRow): boolean {
  return notFoundElsewhere(r) && !hasReference(r);
}

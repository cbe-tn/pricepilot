// Saves a supplier price list into the comparator: one import row plus one quote per line, matched to our
// catalogue by reference. Shared by the manual upload (purchasing page) and the e-mail inbox.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, supplierPriceImports, supplierQuotes, suppliers } from "@/db/schema";
import { moneyStr, n, round3 } from "@/lib/money";
import { matchProduct, productIndex } from "@/lib/purchasing";
import type { ParsedLine } from "@/lib/supplier-columns";
import { vatRateFor } from "@/lib/tax";

export type ImportInput = {
  workspaceId: string;
  /** null for automatic imports (e-mail). */
  userId: string | null;
  supplierId: string;
  fileName: string;
  basis: "ht" | "ttc";
  /** yyyy-mm-dd or undefined. */
  validUntil?: string;
  lines: ParsedLine[];
};

export async function supplierByName(workspaceId: string, name: string): Promise<string> {
  const existing = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.workspaceId, workspaceId), sql`lower(${suppliers.name}) = lower(${name})`))
    .limit(1);
  return existing[0]?.id ?? (await db.insert(suppliers).values({ workspaceId, name }).returning({ id: suppliers.id }))[0].id;
}

export async function importSupplierLines(input: ImportInput): Promise<{ importId: string; count: number; matched: number }> {
  const catalog = await db.select().from(products).where(eq(products.workspaceId, input.workspaceId));
  const idx = productIndex(catalog);
  const expiresAt = input.validUntil ? new Date(`${input.validUntil}T23:59:59`) : null;

  const [imp] = await db
    .insert(supplierPriceImports)
    .values({ workspaceId: input.workspaceId, supplierId: input.supplierId, fileName: input.fileName, priceBasis: input.basis, rowCount: input.lines.length, uploadedBy: input.userId })
    .returning();

  let matched = 0;
  const values = input.lines.map((line) => {
    const product = matchProduct(idx, line.ref, line.name);
    if (product) matched++;
    // Quotes are compared HT: TTC lists are converted with the article's VAT (7 % IT, 19 % otherwise).
    const vat = product ? n(product.vatRate) : vatRateFor({ name: line.name });
    const priceHt = input.basis === "ttc" ? round3(line.price / (1 + vat)) : line.price;
    return {
      workspaceId: input.workspaceId,
      supplierId: input.supplierId,
      importId: imp.id,
      productId: product?.id ?? null,
      productRef: line.ref || null,
      productName: line.name || null,
      quotedPrice: moneyStr(priceHt),
      // Quantity available from the supplier, when the list gives one.
      availability: line.qty !== null && line.qty >= 0 ? String(line.qty) : "in_stock",
      expiresAt,
    };
  });
  for (let i = 0; i < values.length; i += 500) {
    await db.insert(supplierQuotes).values(values.slice(i, i + 500));
  }
  return { importId: imp.id, count: values.length, matched };
}

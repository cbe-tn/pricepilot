"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, supplierPriceImports, supplierQuotes, suppliers } from "@/db/schema";
import { getAuth, writeAudit } from "@/lib/auth";
import { moneyStr, n, round3 } from "@/lib/money";
import { matchProduct, productIndex } from "@/lib/purchasing";
import { vatRateFor } from "@/lib/tax";

// Open to every role, including Acheteur.
async function mustAuth() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

const importSchema = z.object({
  supplierId: z.string().uuid().optional(),
  newSupplierName: z.string().trim().max(120).optional(),
  fileName: z.string().trim().min(1).max(255),
  basis: z.enum(["ht", "ttc"]),
  validUntil: z.string().optional(),
  lines: z
    .array(
      z.object({
        ref: z.string().max(120),
        name: z.string().max(500),
        price: z.number().positive().max(10_000_000),
        qty: z.number().int().nullable(),
      }),
    )
    .min(1)
    .max(10_000),
});

export type SaveImportInput = z.infer<typeof importSchema>;

export async function saveSupplierImportAction(input: SaveImportInput): Promise<{ ok: true; count: number; matched: number } | { error: string }> {
  const auth = await mustAuth();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: "Données invalides : vérifiez les colonnes choisies." };
  const data = parsed.data;
  const ws = auth.workspace.id;

  let supplierId = data.supplierId;
  if (supplierId) {
    const own = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.workspaceId, ws))).limit(1);
    if (!own.length) return { error: "Fournisseur introuvable." };
  } else {
    const name = data.newSupplierName?.trim();
    if (!name) return { error: "Choisissez ou saisissez le fournisseur." };
    const existing = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.workspaceId, ws), sql`lower(${suppliers.name}) = lower(${name})`))
      .limit(1);
    supplierId = existing[0]?.id ?? (await db.insert(suppliers).values({ workspaceId: ws, name }).returning({ id: suppliers.id }))[0].id;
  }

  const catalog = await db.select().from(products).where(eq(products.workspaceId, ws));
  const idx = productIndex(catalog);
  const expiresAt = data.validUntil ? new Date(`${data.validUntil}T23:59:59`) : null;

  const [imp] = await db
    .insert(supplierPriceImports)
    .values({ workspaceId: ws, supplierId, fileName: data.fileName, priceBasis: data.basis, rowCount: data.lines.length, uploadedBy: auth.user.id })
    .returning();

  let matched = 0;
  const values = data.lines.map((line) => {
    const product = matchProduct(idx, line.ref, line.name);
    if (product) matched++;
    // Quotes are compared HT: TTC lists are converted with the article's VAT (7 % IT, 19 % otherwise).
    const vat = product ? n(product.vatRate) : vatRateFor({ name: line.name });
    const priceHt = data.basis === "ttc" ? round3(line.price / (1 + vat)) : line.price;
    return {
      workspaceId: ws,
      supplierId: supplierId!,
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
  await writeAudit(auth, "import_supplier_prices", "supplier_price_import", imp.id, { fileName: data.fileName, rows: values.length, matched });
  revalidatePath("/purchasing");
  revalidatePath("/suppliers");
  return { ok: true, count: values.length, matched };
}

export async function deleteSupplierImportAction(formData: FormData) {
  const auth = await mustAuth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(supplierPriceImports).where(and(eq(supplierPriceImports.id, id), eq(supplierPriceImports.workspaceId, auth.workspace.id)));
  await writeAudit(auth, "delete_supplier_import", "supplier_price_import", id);
  revalidatePath("/purchasing");
  revalidatePath("/suppliers");
}

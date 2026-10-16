// Import every public Numedia product page into the workspace product catalogue.
// Usage: DATABASE_URL=... bun scripts/import-numedia-catalog.ts
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { competitorCatalog, competitors, products, workspaces, type Product } from "@/db/schema";
import { compactText } from "@/lib/extract";
import { moneyStr, n } from "@/lib/money";
import { ownShopFor } from "@/lib/catalog";
import { vatRateFor } from "@/lib/tax";

const [workspace] = await db.select().from(workspaces).limit(1);
if (!workspace) throw new Error("Aucun espace de travail");

const ownShop = await ownShopFor(workspace.id);
if (!ownShop) throw new Error("Aucun site Numedia configuré comme boutique propre");

const listings = await db
  .select({
    url: competitorCatalog.url,
    title: competitorCatalog.slugTitle,
    imageUrl: competitorCatalog.imageUrl,
  })
  .from(competitorCatalog)
  .where(eq(competitorCatalog.competitorId, ownShop.id));

const activeProducts = await db
  .select()
  .from(products)
  .where(and(eq(products.workspaceId, workspace.id), isNull(products.archivedAt)));
const productsByUrl = new Map(activeProducts.filter((p) => p.ownUrl).map((p) => [p.ownUrl!, p]));
const productsByName = new Map<string, Product[]>();
for (const product of activeProducts) {
  const key = compactText(product.name);
  productsByName.set(key, [...(productsByName.get(key) ?? []), product]);
}
const titleCounts = new Map<string, number>();
for (const listing of listings) {
  const key = compactText(listing.title);
  titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
}

const inserted: Array<typeof products.$inferInsert> = [];
let linked = 0;
let alreadyLinked = 0;
let skipped = 0;
const now = new Date();

for (const listing of listings) {
  const title = listing.title.trim();
  const key = compactText(title);
  if (!title || !key) {
    skipped += 1;
    continue;
  }

  const existing = productsByUrl.get(listing.url)
    ?? (titleCounts.get(key) === 1 && productsByName.get(key)?.length === 1 ? productsByName.get(key)![0] : undefined);
  if (existing) {
    if (existing.ownUrl === listing.url && existing.ownStatus === "found") {
      alreadyLinked += 1;
      continue;
    }
    await db
      .update(products)
      .set({
        ownUrl: listing.url,
        ownTitle: title,
        ownPriceTnd: null,
        ownAvailability: null,
        ownStatus: "found",
        ownCheckedAt: null,
        updatedAt: now,
      })
      .where(eq(products.id, existing.id));
    productsByUrl.set(listing.url, existing);
    linked += 1;
    continue;
  }

  const product: typeof products.$inferInsert = {
    workspaceId: workspace.id,
    name: title,
    imageUrl: listing.imageUrl,
    purchasePrice: moneyStr(0),
    purchaseCurrency: "TND",
    exchangeRate: moneyStr(1),
    vatRate: moneyStr(vatRateFor({ name: title })),
    minProfitMargin: moneyStr(n(workspace.defaultMinMargin)),
    stockQty: 0,
    stockStatus: "out_of_stock",
    monitoringStatus: "active",
    ownUrl: listing.url,
    ownTitle: title,
    ownStatus: "found",
    ownCheckedAt: null,
    lastMatchedAt: now,
    isDemo: false,
  };
  if (listing.imageUrl) product.imageUrl = listing.imageUrl;
  inserted.push(product);
  linked += 1;
}

for (let offset = 0; offset < inserted.length; offset += 250) {
  const batch = inserted.slice(offset, offset + 250);
  const rows = await db.insert(products).values(batch).returning({ id: products.id, name: products.name, ownUrl: products.ownUrl });
  for (const row of rows) {
    if (row.ownUrl) productsByUrl.set(row.ownUrl, row as Product);
    const key = compactText(row.name);
    productsByName.set(key, [...(productsByName.get(key) ?? []), row as Product]);
  }
  console.log(`  articles ajoutés : ${Math.min(offset + rows.length, inserted.length)}/${inserted.length}`);
}

console.log(
  "Import Numedia terminé :",
  JSON.stringify({
    websiteListings: listings.length,
    newProducts: inserted.length,
    existingProductsLinked: linked - inserted.length,
    alreadyLinked,
    skipped,
  }),
);
await pool.end();

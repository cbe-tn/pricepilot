import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { getAuth, isPurchasingOnly } from "@/lib/auth";
import { productsToWorkbook, toCsv } from "@/lib/csv";
import { n } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth || isPurchasingOnly(auth.user.role)) return new Response("Non autorisé", { status: 401 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  const rows = await db.select().from(products).where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const stamp = new Date().toISOString();
  if (format === "xlsx") {
    const buf = productsToWorkbook(rows, { sheetName: "Produits" });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="pricepilot-products-${stamp}.xlsx"`,
      },
    });
  }
  const csv = toCsv(
    rows.map((p) => ({
      "Désignation": p.name,
      Marque: p.brand,
      SKU: p.sku,
      "Réf": p.manufacturerRef,
      "Code a barres": p.barcode,
      "Catégorie": p.category,
      "Prix Achat HT": n(p.purchasePrice),
      "Prix de vente TTC": n(p.actualSellingPrice),
      "Qté": p.stockQty,
      "Généré le": stamp,
    })),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pricepilot-products-${stamp}.csv"`,
    },
  });
}

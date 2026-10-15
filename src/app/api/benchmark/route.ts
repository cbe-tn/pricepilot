import * as XLSX from "xlsx";
import { getAuth } from "@/lib/auth";
import { buildBenchmarkMatrix } from "@/lib/benchmark";
import { fr } from "@/lib/labels";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v == null ? "" : Math.round(v * 1000) / 10);

// Excel export in the layout of the manual benchmark sheet: one sheet per category,
// purchase price, our price/margin, then price + margin % per competitor.
export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response("Non autorisé", { status: 401 });
  const includeDemo = new URL(req.url).searchParams.get("demo") === "1";
  const { competitors, rows } = await buildBenchmarkMatrix(auth.workspace.id, { includeDemo });

  const wb = XLSX.utils.book_new();
  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.product.category || "Sans catégorie";
    byCategory.set(key, [...(byCategory.get(key) ?? []), r]);
  }

  for (const [category, list] of byCategory) {
    const data = list.map((r) => {
      const line: Record<string, string | number> = {
        Réf: r.product.manufacturerRef ?? "",
        Désignation: r.product.name,
        Qté: r.product.stockQty,
        "Prix Achat HT": r.purchaseHt,
        "Prix Achat TTC": r.purchaseTtc,
        "Notre prix TTC": r.ourPrice ?? "",
        "Notre marge %": pct(r.ourMarginPct),
        "Marge DT": r.ourMarginTnd ?? "",
      };
      for (const c of competitors) {
        const cell = r.cells[c.id];
        line[`${c.name} PDV TTC`] = cell ? cell.priceTnd : "";
        line[`${c.name} %`] = cell ? pct(cell.marginPct) : "";
        line[`${c.name} stock`] = cell ? fr(cell.availability) : "";
      }
      const cheapest = r.cheapest ? competitors.find((c) => c.id === r.cheapest!.competitorId)?.name : "";
      line["Moins cher"] = r.cheapest ? `${cheapest} ${r.cheapest.priceTnd.toFixed(3)}` : "";
      line["Écart vs moins cher"] = r.gapToCheapest ?? "";
      line["Prix conseillé TTC"] = r.recommendation?.priceTnd ?? "";
      line["Marge conseillée %"] = pct(r.recommendation?.marginPct ?? null);
      for (const c of competitors) line[`${c.name} lien`] = r.cells[c.id]?.url ?? "";
      return line;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = Object.keys(data[0] ?? {}).map((k) => ({ wch: k === "Désignation" ? 60 : k.endsWith("lien") ? 40 : Math.max(10, k.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, category.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  }
  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ info: "Aucun produit pour le moment" }]), "Benchmark");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="benchmark-${stamp}.xlsx"`,
    },
  });
}

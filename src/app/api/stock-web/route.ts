import * as XLSX from "xlsx";
import { getAuth } from "@/lib/auth";
import { buildBenchmarkMatrix } from "@/lib/benchmark";
import { fr } from "@/lib/labels";
import { n } from "@/lib/money";

export const dynamic = "force-dynamic";

const pct = (v: number | null | undefined) => (v == null ? "" : Math.round(v * 1000) / 10);
const OWN_STATUS: Record<string, string> = { found: "En ligne", review: "À vérifier", missing: "À insérer" };

// Stock vs web export: our listing (or "À insérer"), recommended price, then every competitor's price
// with the link to its article.
export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response("Non autorisé", { status: 401 });
  const all = new URL(req.url).searchParams.get("tous") === "1";
  const { competitors, rows } = await buildBenchmarkMatrix(auth.workspace.id);
  const list = rows.filter((r) => all || r.product.stockQty > 0);

  const data = list.map((r) => {
    const p = r.product;
    const line: Record<string, string | number> = {
      Réf: p.manufacturerRef ?? "",
      Désignation: p.name,
      Catégorie: p.category ?? "",
      Qté: p.stockQty,
      "Prix Achat HT": r.purchaseHt,
      "Prix Achat TTC": r.purchaseTtc,
      "Notre prix TTC": r.ourPrice ?? "",
      "Notre marge %": pct(r.ourMarginPct),
      "Notre site": OWN_STATUS[p.ownStatus ?? ""] ?? "Recherche en cours",
      "Notre site prix": p.ownPriceTnd != null ? n(p.ownPriceTnd) : "",
      "Prix conseillé TTC": r.recommendation?.priceTnd ?? "",
      "Marge conseillée %": pct(r.recommendation?.marginPct),
      "Règle prix conseillé": r.recommendation ? (r.recommendation.kind === "beat" ? "1 DT sous le moins cher en stock" : "Plancher marge minimale") : "",
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
    line["Notre site lien"] = p.ownUrl ?? "";
    for (const c of competitors) line[`${c.name} lien`] = r.cells[c.id]?.url ?? "";
    return line;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ info: "Aucun article en stock" }]);
  ws["!cols"] = Object.keys(data[0] ?? {}).map((k) => ({ wch: k === "Désignation" ? 60 : k.endsWith("lien") ? 40 : Math.max(10, k.length + 2) }));
  // Make every link clickable in Excel.
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let R = 1; R <= range.e.r; R++)
    for (let C = 0; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && typeof cell.v === "string" && /^https?:\/\//.test(cell.v)) cell.l = { Target: cell.v };
    }
  XLSX.utils.book_append_sheet(wb, ws, all ? "Catalogue" : "Stock");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock-site-web-${stamp}.xlsx"`,
    },
  });
}

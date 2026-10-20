import * as XLSX from "xlsx";
import { getAuth } from "@/lib/auth";
import { buildSupplierComparison } from "@/lib/purchasing";

export const dynamic = "force-dynamic";

// Excel export of the supplier comparison: one line per article, HT price per supplier, best supplier.
export async function GET() {
  const auth = await getAuth();
  if (!auth) return new Response("Non autorisé", { status: 401 });
  const { suppliers, rows } = await buildSupplierComparison(auth.workspace.id);
  const data = rows.map((r) => {
    const line: Record<string, string | number> = { Réf: r.ref, Désignation: r.name };
    for (const s of suppliers) line[`${s.name} HT`] = r.prices[s.id]?.price ?? "";
    line["Moins cher"] = suppliers.find((s) => s.id === r.bestSupplierId)?.name ?? "";
    line["Meilleur prix HT"] = r.bestPrice;
    line["Économie vs 2e"] = r.secondPrice === null ? "" : Math.round((r.secondPrice - r.bestPrice) * 1000) / 1000;
    line["Prix d'achat actuel HT"] = r.currentPurchase ?? "";
    return line;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ info: "Aucun prix fournisseur importé pour le moment" }]);
  ws["!cols"] = Object.keys(data[0] ?? {}).map((k) => ({ wch: k === "Désignation" ? 60 : Math.max(12, k.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "Comparatif fournisseurs");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="comparatif-fournisseurs-${stamp}.xlsx"`,
    },
  });
}

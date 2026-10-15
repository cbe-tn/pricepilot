import Link from "next/link";
import { ImportForm, ScrollPanel } from "@/components/ClientWidgets";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { BenchmarkTable, benchmarkLegend, coverageOf } from "@/components/BenchmarkTable";
import { requirePageAuth } from "@/lib/page-auth";
import { buildBenchmarkMatrix } from "@/lib/benchmark";

export const metadata = { title: "Stock & site web" };

type Search = { q?: string; site?: string; tous?: string; conc?: string };

export default async function StockWebPage({ searchParams }: { searchParams: Promise<Search> }) {
  const auth = await requirePageAuth();
  const sp = await searchParams;
  const { q = "", site = "", conc = "" } = sp;
  const allProducts = sp.tous === "1";
  const query = q.trim().toLowerCase();

  const matrix = await buildBenchmarkMatrix(auth.workspace.id);
  const stock = matrix.rows.filter((r) => allProducts || r.product.stockQty > 0);

  const compCount = new Map(matrix.competitors.map((c) => [c.id, stock.filter((r) => r.cells[c.id]).length]));
  const comps = matrix.competitors
    .filter((c) => c.enabled || (compCount.get(c.id) ?? 0) > 0)
    .sort((a, b) => (compCount.get(b.id) ?? 0) - (compCount.get(a.id) ?? 0) || a.name.localeCompare(b.name));

  const statusOf = (r: (typeof stock)[number]) => r.product.ownStatus ?? "pending";
  const rows = stock
    .filter((r) => !query || [r.product.name, r.product.manufacturerRef, r.product.model, r.product.brand, r.product.category].some((v) => v?.toLowerCase().includes(query)))
    .filter((r) => !site || statusOf(r) === site)
    .filter((r) => {
      if (conc === "avec") return coverageOf(r) > 0;
      if (conc === "sans") return coverageOf(r) === 0;
      if (conc === "moins") return r.gapToCheapest != null && r.gapToCheapest > 0;
      return true;
    })
    // Products that need action first: missing from our site, then where a competitor is cheaper.
    .sort(
      (a, b) =>
        Number(statusOf(b) === "missing") - Number(statusOf(a) === "missing") ||
        coverageOf(b) - coverageOf(a) ||
        (b.gapToCheapest ?? -Infinity) - (a.gapToCheapest ?? -Infinity),
    );

  const kpi = {
    total: stock.length,
    found: stock.filter((r) => statusOf(r) === "found").length,
    review: stock.filter((r) => statusOf(r) === "review").length,
    missing: stock.filter((r) => statusOf(r) === "missing").length,
    pending: stock.filter((r) => statusOf(r) === "pending").length,
    dearer: stock.filter((r) => r.gapToCheapest != null && r.gapToCheapest > 0).length,
  };
  const link = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { q, site, conc, tous: allProducts ? "1" : "", ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/stock-web${p.size ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Stock & site web"
        subtitle={`Vos articles en stock face aux concurrents : présence sur ${matrix.ownShop?.domain ?? "votre site"}, prix de chaque boutique avec le lien vers l'article, et prix conseillé (1 DT sous le moins cher, marge minimale respectée).`}
        actions={
          <a href={`/api/stock-web${allProducts ? "?tous=1" : ""}`} className="h-10 rounded-lg bg-[#0b4a56] px-4 text-sm leading-10 text-white">
            Exporter Excel
          </a>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ["Articles", kpi.total, "", "#0b4a56"],
            ["En ligne sur notre site", kpi.found, "found", "#0c6b4d"],
            ["À insérer sur notre site", kpi.missing, "missing", "#b42323"],
            ["À vérifier", kpi.review, "review", "#8a6100"],
            ["Recherche en cours", kpi.pending, "pending", "#6b858c"],
          ] as const
        ).map(([label, value, key, color]) => (
          <Link
            key={label}
            href={link({ site: site === key ? "" : key })}
            className={`rounded-xl border bg-white p-3 hover:border-[#0b4a56] ${site === key && key ? "border-[#0b4a56] ring-2 ring-[#0b4a56]/20" : "border-[#d7e3e6]"}`}
          >
            <div className="text-[11px] text-[#6b858c]">{label}</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color }}>
              {value.toLocaleString("fr-FR")}
            </div>
          </Link>
        ))}
        <Link
          href={link({ conc: conc === "moins" ? "" : "moins" })}
          className={`rounded-xl border bg-white p-3 hover:border-[#0b4a56] ${conc === "moins" ? "border-[#0b4a56] ring-2 ring-[#0b4a56]/20" : "border-[#d7e3e6]"}`}
        >
          <div className="text-[11px] text-[#6b858c]">Un concurrent moins cher</div>
          <div className="text-2xl font-bold tabular-nums text-[#b42323]">{kpi.dearer.toLocaleString("fr-FR")}</div>
        </Link>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Importer la liste du stock</h2>
            <p className="text-xs text-[#6b858c]">
              Excel ou CSV avec Réf, Désignation, Qté (et Prix achat si vous l’avez). Les articles déjà connus sont mis à jour par leur référence, sans doublon.
            </p>
          </div>
          <ImportForm />
        </div>
      </Card>

      {!matrix.ownShop ? (
        <p className="mb-3 rounded-lg bg-[#fff4d6] p-3 text-sm text-[#8a6100]">
          Aucun site propre configuré : la colonne « Notre site » restera vide. Ajoutez votre site dans Concurrents (case « notre site »).
        </p>
      ) : null}

      {stock.length ? (
        <ScrollPanel
          maxHeight="68vh"
          toolbar={
            <form className="flex flex-wrap items-center gap-2" action="/stock-web">
              <input name="q" defaultValue={q} placeholder="Réf, désignation, marque…" className="h-8 w-52 rounded-lg border border-[#d7e3e6] px-2 text-xs" />
              <select name="site" defaultValue={site} className="h-8 rounded-lg border border-[#d7e3e6] px-2 text-xs" title="Présence sur notre site">
                <option value="">Notre site : tous</option>
                <option value="found">En ligne</option>
                <option value="missing">À insérer</option>
                <option value="review">À vérifier</option>
                <option value="pending">Recherche en cours</option>
              </select>
              <select name="conc" defaultValue={conc} className="h-8 rounded-lg border border-[#d7e3e6] px-2 text-xs" title="Concurrents">
                <option value="">Concurrents : tous</option>
                <option value="avec">Vendu par un concurrent</option>
                <option value="sans">Vendu par aucun concurrent</option>
                <option value="moins">Un concurrent moins cher</option>
              </select>
              <label className="flex h-8 items-center gap-1 rounded-lg border border-[#d7e3e6] bg-white px-2 text-xs">
                <input type="checkbox" name="tous" value="1" defaultChecked={allProducts} /> Tout le catalogue
              </label>
              <button className="h-8 rounded-lg bg-[#0b4a56] px-3 text-xs text-white">Appliquer</button>
              <span className="text-xs text-[#4d6a72]">
                <strong>{rows.length.toLocaleString("fr-FR")}</strong> / {stock.length.toLocaleString("fr-FR")} articles
              </span>
            </form>
          }
        >
          <BenchmarkTable rows={rows} comps={comps} compCount={compCount} ownShop={matrix.ownShop} />
        </ScrollPanel>
      ) : (
        <EmptyState
          title="Aucun article en stock"
          body="Importez la liste de votre stock (Réf, Désignation, Qté) : chaque article est cherché sur votre site et chez les concurrents automatiquement."
        />
      )}
      <p className="mt-2 text-[11px] text-[#6b858c]">{benchmarkLegend}</p>
    </div>
  );
}

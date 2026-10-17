// Product × shop price matrix shared by the benchmark and stock pages. Every price links to the exact
// article on the competitor's site; "Comparer" opens a Primini-style ranking of all offers for the product.
import Link from "next/link";
import type { Competitor } from "@/db/schema";
import type { BenchmarkRow } from "@/lib/benchmark";
import { formatTnd, n, signedTnd } from "@/lib/money";
import { ExpandableRow } from "@/components/ClientWidgets";

const pctText = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);
// Compact price for the dense matrix: no currency suffix, decimals only when needed.
const priceText = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: Number.isInteger(v) ? 0 : 3 }).format(v);
const marginOf = (price: number, cost: number) => (price > 0 ? (price - cost) / price : null);

export function coverageOf(r: BenchmarkRow): number {
  return Object.values(r.cells).filter(Boolean).length;
}

function OwnStatus({ r, compact }: { r: BenchmarkRow; compact?: boolean }) {
  const p = r.product;
  if (p.ownStatus === "found" || p.ownStatus === "review") {
    const price = p.ownPriceTnd != null ? n(p.ownPriceTnd) : null;
    return (
      <div className="leading-tight">
        <span
          className={`rounded px-1 text-[10px] font-semibold ${p.ownStatus === "found" ? "bg-[#e5f6ee] text-[#0c6b4d]" : "bg-[#fff4d6] text-[#8a6100]"}`}
          title={p.ownStatus === "found" ? "Article trouvé sur notre site" : "Article probable — vérifiez que c'est bien le même produit"}
        >
          {p.ownStatus === "found" ? "En ligne" : "À vérifier"}
        </span>
        {price != null ? <span className="ml-1 font-semibold tabular-nums">{priceText(price)}</span> : null}
        {p.ownUrl ? (
          <div>
            <a href={p.ownUrl} target="_blank" rel="noreferrer" className="text-[10px] text-[#1b6f9a] underline" title={p.ownTitle ?? undefined}>
              {compact ? "Voir ↗" : "Voir notre article ↗"}
            </a>
          </div>
        ) : null}
      </div>
    );
  }
  if (p.ownStatus === "missing")
    return (
      <span className="rounded bg-[#fdecec] px-1 text-[10px] font-semibold text-[#b42323]" title="Introuvable sur notre site : article à créer">
        À insérer
      </span>
    );
  return <span className="text-[10px] text-[#8aa1a7]">Recherche…</span>;
}

function Recommendation({ r }: { r: BenchmarkRow }) {
  const rec = r.recommendation;
  if (!rec) return <span className="text-[#c3d0d3]">—</span>;
  return (
    <div className="leading-tight" title={rec.kind === "beat" ? `1 DT sous le moins cher en stock (${formatTnd(rec.reference)})` : `Impossible de battre ${formatTnd(rec.reference)} avec la marge minimale : prix plancher`}>
      <span className="font-bold tabular-nums">{priceText(rec.priceTnd)}</span>
      <div className={`text-[10px] ${rec.kind === "beat" ? "text-[#0c6b4d]" : "text-[#8a6100]"}`}>
        {pctText(rec.marginPct)} · {rec.kind === "beat" ? "−1 DT" : "plancher"}
      </div>
    </div>
  );
}

/** Primini-style list: every shop selling the product, cheapest first, with a button to the exact article. */
function OfferRanking({ r, comps, ownShop }: { r: BenchmarkRow; comps: Competitor[]; ownShop: Competitor | null }) {
  const p = r.product;
  const list = comps
    .flatMap((c) => {
      const cell = r.cells[c.id];
      return cell ? [{ c, cell }] : [];
    })
    .sort((a, b) => Number(a.cell.availability === "out_of_stock") - Number(b.cell.availability === "out_of_stock") || a.cell.priceTnd - b.cell.priceTnd);
  const missing = comps.filter((c) => !r.cells[c.id]);
  const ownPrice = p.ownPriceTnd != null ? n(p.ownPriceTnd) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4d6a72]">
        <span className="font-semibold text-[#14343b]">{p.name}</span>
        {p.manufacturerRef ? <span className="font-mono">{p.manufacturerRef}</span> : null}
        <span>Achat TTC {formatTnd(r.purchaseTtc)}</span>
        {r.recommendation ? (
          <span className="rounded bg-[#0b4a56] px-2 py-0.5 font-semibold text-white">
            Prix conseillé {formatTnd(r.recommendation.priceTnd)} · marge {pctText(r.recommendation.marginPct)}
            {r.recommendation.kind === "floor" ? " (plancher)" : ""}
          </span>
        ) : null}
      </div>
      <ol className="divide-y divide-[#e3ecee] overflow-hidden rounded-xl border border-[#d7e3e6] bg-white">
        <li className="flex items-center gap-3 bg-[#f6fafb] px-3 py-2">
          <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-[#d4a017] text-[10px] font-bold text-[#3b2a00]">NOUS</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{ownShop?.name ?? "Notre site"}</div>
            <div className="truncate text-[11px] text-[#6b858c]">{p.ownTitle ?? (p.ownStatus === "missing" ? "Article absent de notre site — à insérer" : "Recherche en cours…")}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold tabular-nums">{ownPrice != null ? formatTnd(ownPrice) : r.ourPrice != null ? formatTnd(r.ourPrice) : "—"}</div>
            <div className="text-[10px] text-[#6b858c]">
              {ownPrice != null ? `en ligne · marge ${pctText(marginOf(ownPrice, r.purchaseTtc))}` : r.ourPrice != null ? "prix de vente (fiche)" : ""}
            </div>
          </div>
          {p.ownUrl ? (
            <a href={p.ownUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-[#0b4a56] px-3 py-1 text-xs font-semibold text-[#0b4a56] hover:bg-[#eef6f7]">
              Notre article ↗
            </a>
          ) : (
            <Link href={`/products/${p.id}`} className="shrink-0 rounded-lg border border-[#d7e3e6] px-3 py-1 text-xs text-[#4d6a72]">
              Fiche produit
            </Link>
          )}
        </li>
        {list.map(({ c, cell }, i) => {
          const below = r.ourPrice != null && cell.priceTnd < r.ourPrice;
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-4 shrink-0 text-right text-[11px] text-[#8aa1a7]">{i + 1}</span>
              <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-[#0b4a56] text-[10px] font-bold text-white">{c.logoText ?? c.name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {c.name}
                  {i === 0 && cell.availability !== "out_of_stock" ? (
                    <span className="ml-2 rounded bg-[#d4a017] px-1 text-[10px] font-bold text-[#3b2a00]">Le moins cher</span>
                  ) : null}
                </div>
                <div className="truncate text-[11px] text-[#6b858c]" title={cell.title}>
                  {cell.title}
                </div>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 text-[10px] font-semibold ${cell.availability === "out_of_stock" ? "bg-[#fdecec] text-[#b42323]" : "bg-[#e5f6ee] text-[#0c6b4d]"}`}
              >
                {cell.availability === "out_of_stock" ? "Rupture" : cell.availability === "in_stock" ? "En stock" : "Dispo ?"}
              </span>
              <div className="w-28 shrink-0 text-right">
                <div className={`text-sm font-bold tabular-nums ${below ? "text-[#b42323]" : "text-[#0c6b4d]"}`}>{formatTnd(cell.priceTnd)}</div>
                <div className="text-[10px] text-[#6b858c]">marge {pctText(cell.marginPct)}</div>
              </div>
              {cell.url ? (
                <a href={cell.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-[#0b4a56] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0e5f6e]">
                  Voir l’offre ↗
                </a>
              ) : (
                <span className="w-[86px] shrink-0" />
              )}
            </li>
          );
        })}
      </ol>
      {missing.length ? <p className="text-[11px] text-[#8aa1a7]">Non trouvé chez : {missing.map((c) => c.name).join(", ")}</p> : null}
    </div>
  );
}

export function BenchmarkTable({
  rows,
  comps,
  compCount,
  ownShop,
  showOwn = true,
}: {
  rows: BenchmarkRow[];
  comps: Competitor[];
  compCount: Map<string, number>;
  ownShop: Competitor | null;
  showOwn?: boolean;
}) {
  const colSpan = 6 + (showOwn ? 1 : 0) + comps.length + 2; // + Compatibles
  return (
    <table className="pp-table pp-compact pp-sticky-col">
      <thead>
        <tr>
          <th className="min-w-[200px]">Réf / Désignation</th>
          <th className="text-right" title="Quantité en stock">
            Qté
          </th>
          <th className="text-right">Achat TTC</th>
          <th className="text-right" title="Notre prix de vente (fiche produit)">
            Notre prix
          </th>
          {showOwn ? (
            <th className="min-w-[96px]" title={ownShop ? `Présence de l'article sur ${ownShop.domain}` : "Notre site"}>
              Notre site
            </th>
          ) : null}
          <th className="text-right" title="1 DT sous le concurrent le moins cher en stock, sans passer sous la marge minimale">
            Prix conseillé
          </th>
          {comps.map((c) => {
            const blocked = isBlocked(c);
            return (
              <th key={c.id} className="max-w-[92px] text-right" title={blocked ? c.lastError ?? "" : `${c.name} — ${compCount.get(c.id) ?? 0} produits trouvés`}>
                <div className="truncate">{c.name}</div>
                {blocked && (compCount.get(c.id) ?? 0) > 0 ? (
                  <div className="text-[9px] font-normal normal-case text-[#8a6100]">{compCount.get(c.id)} prod. via Primini</div>
                ) : blocked ? (
                  <div className="text-[9px] font-semibold normal-case text-[#b42323]">accès bloqué</div>
                ) : (
                  <div className="text-[9px] font-normal normal-case text-[#8aa1a7]">{compCount.get(c.id) ?? 0} prod.</div>
                )}
              </th>
            );
          })}
          <th className="text-right" title="Versions compatibles (adaptables) chez les concurrents — affichées à part, jamais utilisées pour le prix conseillé ni l'écart">
            Compatibles
          </th>
          <th className="text-right" title="Notre prix moins le concurrent le moins cher">
            Écart
          </th>
          <th className="text-right" title="Nombre de concurrents qui vendent ce produit">
            Conc.
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const count = coverageOf(r);
          return (
            <ExpandableRow
              key={r.product.id}
              className={count ? "" : "opacity-60"}
              colSpan={colSpan}
              count={count}
              first={
                <>
                  <Link href={`/products/${r.product.id}`} className="block truncate font-semibold text-[#0b4a56]" title={r.product.name}>
                    {r.product.manufacturerRef || r.product.model || r.product.name}
                  </Link>
                  <div className="truncate text-[11px] text-[#6b858c]" title={r.product.name}>
                    {r.product.name}
                  </div>
                </>
              }
              rest={
                <>
                  <td className="text-right tabular-nums">{r.product.stockQty}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{priceText(r.purchaseTtc)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {r.ourPrice != null ? priceText(r.ourPrice) : "—"}
                    <div className="text-[10px] text-[#6b858c]">{pctText(r.ourMarginPct)}</div>
                  </td>
                  {showOwn ? (
                    <td className="whitespace-nowrap">
                      <OwnStatus r={r} compact />
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap bg-[#f6fafb] text-right">
                    <Recommendation r={r} />
                  </td>
                  {comps.map((c) => {
                    const cell = r.cells[c.id];
                    if (!cell)
                      return (
                        <td key={c.id} className="pp-none text-center" title={isBlocked(c) ? `${c.name} : accès bloqué par le site (protection anti-robot)` : `${c.name} : produit non trouvé`}>
                          ·
                        </td>
                      );
                    const below = r.ourPrice != null && cell.priceTnd < r.ourPrice;
                    const cheapest = r.cheapest?.competitorId === c.id;
                    const notes = [cell.availability === "out_of_stock" ? "rupture" : "", cell.stale ? "à vérifier" : ""].filter(Boolean).join(" · ");
                    return (
                      <td
                        key={c.id}
                        className={`whitespace-nowrap text-right tabular-nums ${below ? "pp-below" : "pp-above"} ${cheapest ? "pp-cheapest" : ""}`}
                        title={`${c.name} : ${cell.title} — ${formatTnd(cell.priceTnd)}${notes ? ` (${notes})` : ""}`}
                      >
                        {cell.url ? (
                          <a href={cell.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {priceText(cell.priceTnd)}
                          </a>
                        ) : (
                          priceText(cell.priceTnd)
                        )}
                        <div className="text-[10px] opacity-80">
                          {pctText(cell.marginPct)}
                          {cell.availability === "out_of_stock" ? <span title="Rupture de stock"> ⊘</span> : null}
                          {cell.stale ? <span title="Prix à vérifier"> ⚠</span> : null}
                        </div>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap text-right tabular-nums">
                    <Compatibles r={r} />
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{r.gapToCheapest != null ? signedTnd(r.gapToCheapest).replace(" DT", "") : "—"}</td>
                  <td className="text-right tabular-nums">{count}</td>
                </>
              }
              detail={<OfferRanking r={r} comps={comps} ownShop={ownShop} />}
            />
          );
        })}
      </tbody>
    </table>
  );
}

export const benchmarkLegend = (
  <>
    Prix TTC en DT · % = marge sur notre achat TTC ·{" "}
    <span className="rounded bg-[#fdecec] px-1 text-[#b42323]">rouge</span> = moins cher que nous ·{" "}
    <span className="rounded bg-[#e5f6ee] px-1 text-[#0c6b4d]">vert</span> = plus cher ·{" "}
    <span className="rounded px-1 ring-2 ring-[#d4a017] ring-inset">encadré</span> = le moins cher · ⊘ rupture · ⚠ à vérifier · cliquez un prix pour ouvrir
    l’article chez le concurrent
  </>
);

const isBlocked = (c: Competitor) => Boolean(c.lastError?.startsWith("Accès bloqué"));

/** Cheapest compatible ("adaptable") version, marked as such; the others are listed in the tooltip. */
function Compatibles({ r }: { r: BenchmarkRow }) {
  const first = r.compatibles[0];
  if (!first) return <span className="text-[#c3d0d3]">—</span>;
  const all = r.compatibles.map((c) => `${c.competitorName} : ${formatTnd(c.priceTnd)} — ${c.title}`).join("\n");
  return (
    <div title={`Compatibles (pas l'original) :\n${all}`}>
      {first.url ? (
        <a href={first.url} target="_blank" rel="noreferrer" className="text-[#6b5a00] hover:underline">
          {priceText(first.priceTnd)}
        </a>
      ) : (
        <span className="text-[#6b5a00]">{priceText(first.priceTnd)}</span>
      )}
      <div className="text-[10px] text-[#8a6100]">
        compatible · {first.competitorName}
        {r.compatibles.length > 1 ? ` +${r.compatibles.length - 1}` : ""}
      </div>
    </div>
  );
}

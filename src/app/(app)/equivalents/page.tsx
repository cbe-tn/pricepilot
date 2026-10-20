import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatTnd } from "@/lib/money";
import { findEquivalents } from "@/lib/equivalents";

export const metadata = { title: "Produits équivalents" };

const SOURCE_LABEL = { catalogue: "Catalogue", fournisseur: "Fournisseur", concurrent: "Concurrent", index: "Site concurrent" } as const;

function gapText(gap: number | null) {
  if (gap === null) return null;
  const pct = Math.round(gap * 100);
  if (Math.abs(pct) < 3) return <span className="text-[#4d6a72]">même prix</span>;
  return <span className={pct < 0 ? "text-[#0c8a62]" : "text-[#9a5b08]"}>{pct > 0 ? `+${pct}` : pct} %</span>;
}

export default async function EquivalentsPage({ searchParams }: { searchParams: Promise<{ q?: string; tous?: string }> }) {
  const auth = await requirePageAuth();
  const { q = "", tous } = await searchParams;
  const inStockOnly = tous !== "1";
  const query = q.trim();
  const result = query.length >= 2 ? await findEquivalents(auth.workspace.id, query, inStockOnly) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produits équivalents"
        subtitle="Un client demande une référence que nous n'avons pas ? Saisissez-la : l'application identifie le produit (catalogue, offres fournisseurs, sites concurrents) puis propose les produits de notre catalogue aux caractéristiques les plus proches."
      />
      <Card>
        <form action="/equivalents" className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input name="q" defaultValue={query} placeholder="Référence ou nom : CF259A, Canon G3410, 82V30046FE, HP 15 i5 16Go…" className="md:flex-1" autoFocus />
          <label className="flex items-center gap-2 text-sm text-[#4d6a72]">
            <input type="checkbox" name="tous" value="1" defaultChecked={!inStockOnly} /> Inclure les produits hors stock
          </label>
          <Button type="submit">Chercher</Button>
        </form>
      </Card>

      {!result ? (
        <EmptyState title="Saisissez une référence" body="Référence fabricant, code-barres ou nom du produit demandé par le client." />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b858c]">Produit demandé</p>
                <h2 className="mt-1 text-lg font-semibold">{result.target.title}</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.target.type ? <Badge tone="teal">{result.target.type}</Badge> : <Badge tone="warn">Type non reconnu</Badge>}
                  {result.target.brand ? <Badge>{result.target.brand}</Badge> : null}
                  {result.target.features
                    .filter((f) => !f.key.startsWith("w:"))
                    .map((f) => (
                      <Badge key={f.key} tone="info">
                        {f.label}
                      </Badge>
                    ))}
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b858c]">Prix constaté TTC</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{result.target.priceTtc ? formatTnd(result.target.priceTtc) : "—"}</p>
              </div>
            </div>
            {result.target.ours.length ? (
              <div className="mt-4 rounded-lg bg-[#e7f3fa] px-3 py-2 text-sm text-[#1b6f9a]">
                Nous avons cette référence :{" "}
                {result.target.ours.map((p, i) => (
                  <span key={p.id}>
                    {i ? ", " : ""}
                    <Link href={`/products/${p.id}`} className="font-medium underline">
                      {p.name}
                    </Link>{" "}
                    ({p.stockQty > 0 ? `${p.stockQty} en stock` : "rupture de stock"})
                  </span>
                ))}
              </div>
            ) : null}
            {result.target.sources.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-[#4d6a72]">Identifié à partir de {result.target.sources.length} source(s)</summary>
                <ul className="mt-2 space-y-1">
                  {result.target.sources.map((s, i) => (
                    <li key={i} className="flex flex-wrap gap-2">
                      <Badge>{SOURCE_LABEL[s.kind]}</Badge>
                      <span className="font-medium">{s.label}</span>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                          {s.title}
                        </a>
                      ) : (
                        <span>{s.title}</span>
                      )}
                      {s.priceTtc ? <span className="tabular-nums text-[#4d6a72]">{formatTnd(s.priceTtc)} TTC</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="mt-3 text-sm text-[#9a5b08]">
                Référence inconnue de nos fournisseurs et des sites concurrents indexés : la recherche se base sur le texte saisi. Ajoutez des mots (type, caractéristiques) pour de meilleurs résultats.
              </p>
            )}
          </Card>

          {result.equivalents.length ? (
            <Card>
              <h2 className="mb-3 font-semibold">Équivalents dans notre catalogue</h2>
              <div className="pp-table-wrap">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th>Similarité</th>
                      <th>Points communs</th>
                      <th>Stock</th>
                      <th className="text-right">Notre prix TTC</th>
                      <th className="text-right">Écart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.equivalents.map((e) => (
                      <tr key={e.product.id}>
                        <td className="min-w-72">
                          <Link href={`/products/${e.product.id}`} className="font-medium hover:underline">
                            {e.product.name}
                          </Link>
                          <p className="text-xs text-[#6b858c]">
                            {[e.product.brand, e.product.manufacturerRef, e.product.category].filter(Boolean).join(" · ")}
                          </p>
                        </td>
                        <td>
                          {e.sameRef ? (
                            <Badge tone="ok">Même référence (compatible)</Badge>
                          ) : (
                            <Badge tone={e.similarity >= 0.75 ? "ok" : e.similarity >= 0.5 ? "gold" : "slate"}>{Math.round(e.similarity * 100)} %</Badge>
                          )}
                        </td>
                        <td className="max-w-80 text-xs">
                          {e.shared.length ? <span className="text-[#0c8a62]">{e.shared.join(" · ")}</span> : null}
                          {e.missing.length ? <span className="block text-[#9a5b08]">Sans : {e.missing.join(" · ")}</span> : null}
                        </td>
                        <td>{e.product.stockQty > 0 ? <Badge tone="ok">{e.product.stockQty}</Badge> : <Badge tone="bad">Rupture</Badge>}</td>
                        <td className="text-right tabular-nums">{e.priceTtc ? formatTnd(e.priceTtc) : "—"}</td>
                        <td className="text-right tabular-nums">{gapText(e.priceGap) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[#6b858c]">
                Classement : même type de produit obligatoire, puis caractéristiques communes, prix proche du produit demandé et disponibilité en stock. Vérifiez la fiche avant de proposer au client.
              </p>
            </Card>
          ) : (
            <EmptyState
              title="Aucun équivalent trouvé"
              body={inStockOnly ? "Aucun produit en stock du même type et aux caractéristiques proches. Essayez d'inclure les produits hors stock." : "Aucun produit du même type et aux caractéristiques proches dans le catalogue."}
            />
          )}
        </>
      )}
    </div>
  );
}

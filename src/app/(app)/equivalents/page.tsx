import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatTnd } from "@/lib/money";
import { findEquivalents, isAvailable } from "@/lib/equivalents";
import type { Product } from "@/db/schema";

export const metadata = { title: "Produits équivalents" };

const SOURCE_LABEL = { catalogue: "Catalogue", fournisseur: "Fournisseur", concurrent: "Concurrent", index: "Site concurrent" } as const;

function Availability({ p }: { p: Product }) {
  if (p.stockQty > 0) return <Badge tone="ok">{p.stockQty} en stock</Badge>;
  if (p.ownAvailability === "in_stock") return <Badge tone="ok">Dispo sur le site</Badge>;
  return <Badge tone="bad">Rupture</Badge>;
}

function gapText(gap: number | null, inBand: boolean) {
  if (gap === null) return null;
  const pct = Math.round(gap * 100);
  if (Math.abs(pct) < 3) return <span className="text-[#4d6a72]">{inBand ? "dans la gamme" : "même prix"}</span>;
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
        subtitle="Un client demande un produit que nous n'avons pas ? Saisissez sa référence ou sa description complète (marque, modèle, type, capacité, gamme…) : l'application propose les produits de notre catalogue aux caractéristiques les plus proches."
      />
      <Card>
        <form action="/equivalents" className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input name="q" defaultValue={query} placeholder="Référence ou description : CF259A, xiaomi redmi note 10 smartphone milieu de gamme 64 go…" className="md:flex-1" autoFocus />
          <label className="flex items-center gap-2 text-sm text-[#4d6a72]">
            <input type="checkbox" name="tous" value="1" defaultChecked={!inStockOnly} /> Inclure les produits indisponibles
          </label>
          <Button type="submit">Chercher</Button>
        </form>
      </Card>

      {!result ? (
        <EmptyState title="Saisissez une référence ou une description" body="Référence fabricant, code-barres, ou description du produit demandé par le client : marque, modèle, type, capacité, « entrée / milieu / haut de gamme »." />
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
                {result.target.priceBand ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b858c]">{result.target.priceBand.label} TTC</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {formatTnd(result.target.priceBand.lo)} – {formatTnd(result.target.priceBand.hi)}
                    </p>
                    <p className="text-[11px] text-[#6b858c]">d&apos;après nos prix pour ce type de produit</p>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b858c]">Prix constaté TTC</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{result.target.priceTtc ? formatTnd(result.target.priceTtc) : "—"}</p>
                  </>
                )}
              </div>
            </div>
            {result.target.ours.length ? (
              <div className="mt-4 rounded-lg bg-[#e7f3fa] px-3 py-2 text-sm text-[#1b6f9a]">
                Nous avons ce produit :{" "}
                {result.target.ours.map((p, i) => (
                  <span key={p.id}>
                    {i ? ", " : ""}
                    <Link href={`/products/${p.id}`} className="font-medium underline">
                      {p.name}
                    </Link>{" "}
                    ({p.stockQty > 0 ? `${p.stockQty} en stock` : isAvailable(p) ? "dispo sur le site" : "rupture de stock"})
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
                Produit inconnu de notre catalogue, de nos fournisseurs et des sites concurrents indexés : la recherche se base sur le texte saisi. Ajoutez des mots (type, capacité, gamme) pour de meilleurs résultats.
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
                        <td>
                          <Availability p={e.product} />
                        </td>
                        <td className="text-right tabular-nums">{e.priceTtc ? formatTnd(e.priceTtc) : "—"}</td>
                        <td className="text-right tabular-nums">{gapText(e.priceGap, Boolean(result.target.priceBand)) ?? "—"}</td>
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
              body={inStockOnly ? "Aucun produit disponible du même type et aux caractéristiques proches. Essayez d'inclure les produits indisponibles." : "Aucun produit du même type et aux caractéristiques proches dans le catalogue."}
            />
          )}
        </>
      )}
    </div>
  );
}

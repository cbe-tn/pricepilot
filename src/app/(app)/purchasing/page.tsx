import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { supplierPriceImports, suppliers, users } from "@/db/schema";
import { SupplierImport } from "@/components/purchasing/SupplierImport";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Stat } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatTnd, formatWhen } from "@/lib/money";
import { buildSupplierComparison } from "@/lib/purchasing";
import { deleteSupplierImportAction } from "@/lib/purchasing-actions";

export const metadata = { title: "Comparateur fournisseurs" };

const MAX_ROWS = 300;

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ q?: string; multi?: string }> }) {
  const auth = await requirePageAuth({ allowPurchasing: true });
  const { q = "", multi } = await searchParams;
  const onlyMulti = multi === "1";
  const query = q.trim().toLowerCase();

  const [sups, imports, comparison] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.workspaceId, auth.workspace.id)).orderBy(suppliers.name),
    db
      .select({ imp: supplierPriceImports, supplierName: suppliers.name, uploader: users.fullName })
      .from(supplierPriceImports)
      .innerJoin(suppliers, eq(suppliers.id, supplierPriceImports.supplierId))
      .leftJoin(users, eq(users.id, supplierPriceImports.uploadedBy))
      .where(eq(supplierPriceImports.workspaceId, auth.workspace.id))
      .orderBy(desc(supplierPriceImports.createdAt))
      .limit(30),
    buildSupplierComparison(auth.workspace.id),
  ]);

  const { suppliers: cols, rows } = comparison;
  const compared = rows.filter((r) => r.secondPrice !== null);
  const savings = compared.reduce((sum, r) => sum + (r.secondPrice! - r.bestPrice), 0);
  const wins = new Map<string, number>();
  for (const r of compared) wins.set(r.bestSupplierId, (wins.get(r.bestSupplierId) ?? 0) + 1);
  const leader = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];

  const filtered = rows.filter(
    (r) => (!onlyMulti || r.secondPrice !== null) && (!query || r.ref.toLowerCase().includes(query) || r.name.toLowerCase().includes(query)),
  );
  const supplierName = (id: string) => cols.find((s) => s.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comparateur fournisseurs"
        subtitle="Importez les offres reçues des fournisseurs (PDF, Word, Excel) : chaque article est comparé par référence et le fournisseur le moins cher est mis en évidence. Tous les prix sont comparés HT."
        actions={
          rows.length ? (
            <a href="/api/purchasing/export" className="inline-flex h-10 items-center rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm">
              Exporter en Excel
            </a>
          ) : null
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Articles avec prix" value={rows.length} hint={`${cols.length} fournisseur(s)`} />
        <Stat label="Comparés (2 fournisseurs ou +)" value={compared.length} />
        <Stat label="Économie vs 2e meilleur" value={formatTnd(savings)} hint="Somme des écarts, 1 unité par article" tone={savings > 0 ? "ok" : undefined} />
        <Stat label="Le plus souvent moins cher" value={leader ? supplierName(leader[0]) : "—"} hint={leader ? `${leader[1]} article(s)` : undefined} />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Importer une offre fournisseur</h2>
        <SupplierImport suppliers={sups} />
      </Card>

      {rows.length ? (
        <Card>
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="font-semibold">Comparatif par article</h2>
            <form className="flex flex-wrap items-center gap-2" action="/purchasing">
              <Input name="q" defaultValue={q} placeholder="Référence ou désignation…" className="w-64" />
              <label className="flex items-center gap-1 text-sm text-[#4d6a72]">
                <input type="checkbox" name="multi" value="1" defaultChecked={onlyMulti} /> 2 fournisseurs ou +
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Filtrer
              </Button>
            </form>
          </div>
          <div className="pp-table-wrap max-h-[70vh] overflow-auto">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Désignation</th>
                  {cols.map((s) => (
                    <th key={s.id} className="text-right">
                      {s.name}
                    </th>
                  ))}
                  <th>Moins cher</th>
                  <th className="text-right">Économie vs 2e</th>
                  <th className="text-right">Achat actuel</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, MAX_ROWS).map((r) => (
                  <tr key={r.key}>
                    <td className="font-mono text-xs">{r.ref || "—"}</td>
                    <td className="min-w-64">
                      {r.name || "—"}
                      {r.productId ? (
                        <span className="ml-2">
                          <Badge tone="teal">catalogue</Badge>
                        </span>
                      ) : null}
                    </td>
                    {cols.map((s) => {
                      const p = r.prices[s.id];
                      const best = p && s.id === r.bestSupplierId && r.secondPrice !== null;
                      return (
                        <td
                          key={s.id}
                          className={`text-right tabular-nums ${best ? "bg-[#e5f6ee] font-semibold text-[#0c8a62]" : ""}`}
                          title={p ? `Offre du ${formatWhen(p.quotedAt)}${p.supplierRef ? ` · réf. ${p.supplierRef}` : ""}${p.qty !== null ? ` · qté ${p.qty}` : ""}` : undefined}
                        >
                          {p ? formatTnd(p.price) : <span className="text-[#b5c6ca]">—</span>}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap font-medium">
                      {r.secondPrice !== null ? supplierName(r.bestSupplierId) : <span className="text-[#6b858c]">{supplierName(r.bestSupplierId)} (seul)</span>}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.secondPrice !== null ? (
                        <>
                          {formatTnd(r.secondPrice - r.bestPrice)}
                          <span className="ml-1 text-xs text-[#6b858c]">({Math.round(((r.secondPrice - r.bestPrice) / r.secondPrice) * 1000) / 10} %)</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.currentPurchase !== null ? (
                        <span
                          className={r.bestPrice < r.currentPurchase ? "text-[#0c8a62]" : ""}
                          title={r.bestPrice < r.currentPurchase ? `${formatTnd(r.currentPurchase - r.bestPrice)} de moins que le prix d'achat actuel` : undefined}
                        >
                          {formatTnd(r.currentPurchase)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#6b858c]">
            {filtered.length > MAX_ROWS ? `${MAX_ROWS} articles affichés sur ${filtered.length} : affinez la recherche ou exportez en Excel. ` : ""}
            En vert : le moins cher quand au moins deux fournisseurs proposent l’article. Survolez un prix pour voir la date de l’offre.
          </p>
        </Card>
      ) : (
        <EmptyState title="Aucune offre importée" body="Importez le fichier reçu d'un premier fournisseur, puis ceux des autres : la comparaison article par article apparaît ici." />
      )}

      {imports.length ? (
        <Card>
          <h2 className="mb-3 font-semibold">Fichiers importés</h2>
          <div className="pp-table-wrap">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Fournisseur</th>
                  <th>Fichier</th>
                  <th>Lignes</th>
                  <th>Importé par</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {imports.map(({ imp, supplierName: name, uploader }) => (
                  <tr key={imp.id}>
                    <td>{formatWhen(imp.createdAt)}</td>
                    <td>{name}</td>
                    <td>
                      {imp.fileName} <Badge>{imp.priceBasis.toUpperCase()}</Badge>
                    </td>
                    <td>{imp.rowCount}</td>
                    <td>{uploader ?? "—"}</td>
                    <td>
                      <form action={deleteSupplierImportAction}>
                        <input type="hidden" name="id" value={imp.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Supprimer
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#6b858c]">Supprimer un fichier retire ses prix du comparatif (en cas d’erreur d’import).</p>
        </Card>
      ) : null}
      {auth.user.role !== "purchasing" ? (
        <p className="text-xs text-[#6b858c]">
          Les devis saisis à la main sur la page{" "}
          <Link href="/suppliers" className="underline">
            Fournisseurs
          </Link>{" "}
          sont aussi pris en compte.
        </p>
      ) : null}
    </div>
  );
}

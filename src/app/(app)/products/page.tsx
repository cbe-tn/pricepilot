import Link from "next/link";
import { and, asc, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, products } from "@/db/schema";
import { ImportForm, ProductTableClient } from "@/components/ClientWidgets";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatPctPoints, formatTnd, n } from "@/lib/money";
import { analyzePrice, costFromProduct, marketStats, positionLabel, taxFromWorkspace } from "@/lib/pricing";
import { isSelectedCompetitor } from "@/lib/connectors";

export const metadata = { title: "Catalogue produits" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePageAuth();
  const sp = await searchParams;
  const q = String(sp.q ?? "");
  const brand = String(sp.brand ?? "");
  const category = String(sp.category ?? "");
  const stock = String(sp.stock ?? "");
  const monitor = String(sp.monitor ?? "");
  const archived = String(sp.archived ?? "");
  const sort = String(sp.sort ?? "added");

  const filters = [eq(products.workspaceId, auth.workspace.id)];
  if (archived === "1") filters.push(isNotNull(products.archivedAt));
  else filters.push(isNull(products.archivedAt));
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(products.name, like), ilike(products.sku, like), ilike(products.barcode, like), ilike(products.manufacturerRef, like))!);
  }
  if (brand) filters.push(eq(products.brand, brand));
  if (category) filters.push(eq(products.category, category));
  if (stock) filters.push(eq(products.stockStatus, stock as "in_stock"));
  if (monitor) filters.push(eq(products.monitoringStatus, monitor as "active"));

  const order =
    sort === "price"
      ? desc(products.actualSellingPrice)
      : sort === "name"
        ? asc(products.name)
        : desc(products.createdAt);

  const rows = await db
    .select()
    .from(products)
    .where(and(...filters))
    .orderBy(order);

  const selectedCompetitorIds = new Set(
    (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter(isSelectedCompetitor).map((c) => c.id),
  );
  const offers = (await db.select().from(competitorOffers).where(eq(competitorOffers.workspaceId, auth.workspace.id))).filter((o) => selectedCompetitorIds.has(o.competitorId));
  const tax = taxFromWorkspace(auth.workspace);

  const table = rows.map((p) => {
    const pOffers = offers.filter((o) => o.productId === p.id);
    const stats = marketStats(
      pOffers.map((o) => ({
        priceTnd: n(o.priceTnd),
        availability: o.availability,
        matchClass: o.matchClass,
        excludedFromBenchmark: o.excludedFromBenchmark,
        condition: o.condition,
      })),
    );
    const analysis = analyzePrice(n(p.actualSellingPrice), costFromProduct(p), { ...tax, vatRate: n(p.vatRate) || tax.vatRate });
    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      sku: p.sku,
      category: p.category,
      selling: formatTnd(p.actualSellingPrice),
      profit: formatTnd(analysis.grossProfit),
      margin: formatPctPoints(analysis.grossMargin),
      stock: p.stockQty,
      status: p.stockStatus,
      monitoring: p.monitoringStatus,
      demo: p.isDemo,
      competitiveness: positionLabel(n(p.actualSellingPrice), stats),
      profitN: analysis.grossProfit,
    };
  });

  if (sort === "profit") table.sort((a, b) => b.profitN - a.profitN);
  if (sort === "compete") table.sort((a, b) => a.competitiveness.localeCompare(b.competitiveness));

  const brands = [...new Set(rows.map((r) => r.brand).filter(Boolean))] as string[];
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))] as string[];

  return (
    <div>
      <PageHeader
        title="Catalogue produits"
        subtitle="Recherchez par nom, SKU, code-barres ou référence fabricant. Importez un fichier Excel si vous avez déjà une liste de prix."
        actions={
          <>
            <a href="/api/export?type=products&format=csv" className="inline-flex h-10 items-center rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm">
              Exporter CSV
            </a>
            <a href="/api/export?type=products&format=xlsx" className="inline-flex h-10 items-center rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm">
              Exporter Excel
            </a>
            <Link href="/products/new" className="inline-flex h-10 items-center rounded-lg bg-[#0b4a56] px-4 text-sm font-medium text-white">
              Ajouter un produit
            </Link>
          </>
        }
      />

      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-6">
          <input name="q" defaultValue={q} placeholder="Rechercher…" className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm md:col-span-2" />
          <select name="brand" defaultValue={brand} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">
            <option value="">Toutes les marques</option>
            {brands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <select name="category" defaultValue={category} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">
            <option value="">Toutes les catégories</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select name="stock" defaultValue={stock} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">
            <option value="">Tout le stock</option>
            <option value="in_stock">En stock</option>
            <option value="low_stock">Stock faible</option>
            <option value="out_of_stock">Rupture</option>
          </select>
          <select name="monitor" defaultValue={monitor} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">
            <option value="">Tous les suivis</option>
            <option value="active">Actif</option>
            <option value="paused">En pause</option>
          </select>
          <select name="sort" defaultValue={sort} className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">
            <option value="added">Plus récents</option>
            <option value="name">Nom</option>
            <option value="price">Prix de vente</option>
            <option value="profit">Bénéfice</option>
            <option value="compete">Compétitivité</option>
          </select>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="archived" value="1" defaultChecked={archived === "1"} /> Afficher les archivés
          </label>
          <Button type="submit" size="sm">
            Appliquer les filtres
          </Button>
        </form>
        <div className="mt-4 border-t border-[#eef3f5] pt-4">
          <ImportForm />
          <p className="mt-2 text-xs text-[#6b858c]">
            Colonnes reconnues : Réf, Désignation, Qté, Prix Achat HT, Code a barres, Marque, Modèle, Catégorie, Fournisseur, TVA, Prix de vente TTC (les noms anglais name, manufacturerRef, purchasePrice… fonctionnent aussi). Les produits importés sont recherchés automatiquement chez les concurrents.
          </p>
        </div>
      </Card>

      {table.length ? (
        <ProductTableClient rows={table} />
      ) : (
        <EmptyState
          title="Aucun produit trouvé"
          body="Essayez de retirer des filtres, ou ajoutez un produit avec sa référence fabricant et son prix d'achat."
          action={
            <Link href="/products/new" className="inline-flex h-10 items-center rounded-lg bg-[#d4a017] px-4 text-sm font-semibold text-[#3b2a00]">
              Ajouter un produit
            </Link>
          }
        />
      )}
    </div>
  );
}

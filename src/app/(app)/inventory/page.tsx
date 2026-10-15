import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, salesRecords, stockMovements } from "@/db/schema";
import { MovementForm } from "@/components/ClientWidgets";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatTnd, formatWhen, n } from "@/lib/money";
import { fr } from "@/lib/labels";

export const metadata = { title: "Stock" };

export default async function InventoryPage() {
  const auth = await requirePageAuth();
  const catalog = await db.select().from(products).where(eq(products.workspaceId, auth.workspace.id));
  const moves = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.workspaceId, auth.workspace.id))
    .orderBy(desc(stockMovements.createdAt))
    .limit(40);
  const sales = await db.select().from(salesRecords).where(eq(salesRecords.workspaceId, auth.workspace.id));
  const value = catalog.reduce((s, p) => s + n(p.purchasePrice) * p.stockQty, 0);
  const low = catalog.filter((p) => p.stockStatus === "low_stock" || p.stockQty <= p.lowStockThreshold);
  const salesByProduct = new Map<string, number>();
  for (const s of sales) salesByProduct.set(s.productId, (salesByProduct.get(s.productId) ?? 0) + s.quantity);
  const slow = catalog.filter((p) => p.stockQty > 0 && (salesByProduct.get(p.id) ?? 0) === 0);
  const hot = [...salesByProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock et ventes"
        subtitle="Mouvements de stock simplifiés. Les indications de rotation sont descriptives, pas des prévisions : aucune vente n'est prédite sans historique suffisant."
      />
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Valeur du stock (au coût)" value={formatTnd(value)} />
        <Stat label="Références en stock" value={catalog.filter((p) => p.stockQty > 0).length} />
        <Stat label="Stock faible" value={low.length} tone={low.length ? "warn" : "ok"} />
        <Stat label="Lignes de vente enregistrées" value={sales.length} />
      </div>
      <Card>
        <h2 className="mb-3 font-semibold">Enregistrer un mouvement</h2>
        <MovementForm products={catalog.map((p) => ({ id: p.id, name: p.name }))} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Stock faible</h2>
          <ul className="space-y-2 text-sm">
            {low.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.name}</span>
                <Badge tone="warn">{p.stockQty} unités</Badge>
              </li>
            ))}
            {!low.length ? <p className="text-[#6b858c]">Rien sous le seuil.</p> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Aperçu de la demande (estimation)</h2>
          <p className="text-xs text-[#6b858c]">Basé uniquement sur les ventes enregistrées ici — pas une prévision statistique.</p>
          <p className="mt-2 text-sm font-medium">Demande la plus forte</p>
          <ul className="mt-1 text-sm">
            {hot.map(([id, qty]) => (
              <li key={id}>
                {catalog.find((p) => p.id === id)?.name} : {qty} unités
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-medium">Faible rotation (en stock, aucune vente enregistrée)</p>
          <ul className="mt-1 text-sm">
            {slow.slice(0, 6).map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="pp-table-wrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Produit</th>
              <th>Type</th>
              <th>Qté</th>
              <th>Coût unitaire</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <td>{formatWhen(m.createdAt)}</td>
                <td>{catalog.find((p) => p.id === m.productId)?.name}</td>
                <td>{fr(m.type)}</td>
                <td>{m.quantity}</td>
                <td>{formatTnd(m.unitCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, products, supplierQuotes, suppliers } from "@/db/schema";
import { PurchaseCalculator, QuoteForm, SupplierForm } from "@/components/ClientWidgets";
import { Card, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatPctPoints, formatTnd, formatWhen, n } from "@/lib/money";
import { analyzePrice, costFromProduct, marketStats, taxFromWorkspace } from "@/lib/pricing";

export const metadata = { title: "Fournisseurs" };

export default async function SuppliersPage() {
  const auth = await requirePageAuth();
  const sups = await db.select().from(suppliers).where(eq(suppliers.workspaceId, auth.workspace.id));
  const quotes = await db.select().from(supplierQuotes).where(eq(supplierQuotes.workspaceId, auth.workspace.id));
  const catalog = await db.select().from(products).where(eq(products.workspaceId, auth.workspace.id));
  const offers = await db.select().from(competitorOffers).where(eq(competitorOffers.workspaceId, auth.workspace.id));
  const tax = taxFromWorkspace(auth.workspace);

  const calcQuotes = quotes.map((q) => {
    const p = catalog.find((x) => x.id === q.productId);
    const stats = p
      ? marketStats(
          offers
            .filter((o) => o.productId === p.id)
            .map((o) => ({
              priceTnd: n(o.priceTnd),
              availability: o.availability,
              matchClass: o.matchClass,
              excludedFromBenchmark: o.excludedFromBenchmark,
              condition: o.condition,
            })),
        )
      : { average: null as number | null };
    return {
      id: q.id,
      name: `${sups.find((s) => s.id === q.supplierId)?.name ?? "Fournisseur"} · ${q.productName ?? p?.name ?? q.productRef}`,
      quoted: n(q.quotedPrice),
      shipping: n(q.shippingCost),
      market: stats.average,
      selling: p ? n(p.actualSellingPrice) : 0,
      tax,
      minMargin: p ? n(p.minProfitMargin) : n(auth.workspace.defaultMinMargin),
    };
  });

  const renegotiate = quotes.filter((q) => {
    const p = catalog.find((x) => x.id === q.productId);
    if (!p) return false;
    const analysis = analyzePrice(n(p.actualSellingPrice), costFromProduct({ ...p, purchasePrice: q.quotedPrice, shippingCost: q.shippingCost }), tax);
    return analysis.grossMargin < n(p.minProfitMargin);
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Fournisseurs et achats" subtitle="Comparez les prix d'achat proposés au marché et à votre marge cible. Renégociez lorsqu'un devis ne permet plus d'atteindre votre prix plancher." />
      <Card>
        <h2 className="mb-3 font-semibold">Ajouter un fournisseur</h2>
        <SupplierForm />
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {sups.map((s) => (
          <Card key={s.id}>
            <h3 className="font-semibold">{s.name}</h3>
            <p className="text-sm text-[#6b858c]">
              {s.contactName} · {s.city}
              <br />
              {s.email} · {s.phone}
            </p>
            <p className="mt-2 text-sm">{s.notes}</p>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="mb-3 font-semibold">Devis</h2>
        <QuoteForm
          suppliers={sups.map((s) => ({ id: s.id, name: s.name }))}
          products={catalog.map((p) => ({ id: p.id, name: p.name }))}
        />
        <div className="pp-table-wrap mt-4">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Produit</th>
                <th>Prix proposé</th>
                <th>Qté min.</th>
                <th>Délai</th>
                <th>Valable jusqu’au</th>
                <th>Marge estimée au prix actuel</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const p = catalog.find((x) => x.id === q.productId);
                const analysis = p
                  ? analyzePrice(n(p.actualSellingPrice), costFromProduct({ ...p, purchasePrice: q.quotedPrice, shippingCost: q.shippingCost }), tax)
                  : null;
                return (
                  <tr key={q.id}>
                    <td>{sups.find((s) => s.id === q.supplierId)?.name}</td>
                    <td>{q.productName ?? p?.name ?? q.productRef}</td>
                    <td className="tabular-nums">{formatTnd(q.quotedPrice)}</td>
                    <td>{q.moq}</td>
                    <td>{q.leadTimeDays} j</td>
                    <td>{formatWhen(q.expiresAt)}</td>
                    <td>{analysis ? formatPctPoints(analysis.grossMargin) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {renegotiate.length ? (
        <Card>
          <h2 className="font-semibold">À renégocier ou à éviter</h2>
          <p className="mt-1 text-sm text-[#4d6a72]">Ces devis ne permettraient pas d’atteindre votre marge minimale au prix de vente actuel.</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {renegotiate.map((q) => (
              <li key={q.id}>
                {q.productName ?? catalog.find((p) => p.id === q.productId)?.name} @ {formatTnd(q.quotedPrice)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <PurchaseCalculator quotes={calcQuotes} />
    </div>
  );
}

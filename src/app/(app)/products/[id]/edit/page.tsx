import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { updateProductAction } from "@/lib/actions";
import { ProductForm } from "@/components/ClientWidgets";
import { PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { n } from "@/lib/money";

export const metadata = { title: "Modifier le produit" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAuth();
  const { id } = await params;
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!p) notFound();
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Modifier ${p.name}`} subtitle="Modifiez les coûts, l'identité ou le suivi. L'historique des prix est conservé." />
      <ProductForm
        action={updateProductAction}
        product={p}
        defaults={{ vatPct: n(auth.workspace.defaultVatRate) * 100, minMarginPct: n(auth.workspace.defaultMinMargin) * 100 }}
      />
    </div>
  );
}

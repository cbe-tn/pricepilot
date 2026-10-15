import { Card, PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { formatWhen } from "@/lib/money";

export const metadata = { title: "Rapports" };

const REPORTS = [
  { type: "comparison", label: "Comparaison des prix concurrents" },
  { type: "profitability", label: "Rentabilité des produits" },
  { type: "recommendations", label: "Recommandations de prix" },
  { type: "below-margin", label: "Produits sous la marge cible" },
  { type: "discovery", label: "Nouveaux produits découverts" },
  { type: "changes", label: "Changements de prix concurrents" },
  { type: "suppliers", label: "Comparaison des coûts fournisseurs" },
  { type: "trends", label: "Tendances historiques du marché" },
  { type: "inventory", label: "Stock et inventaire" },
];

export default async function ReportsPage() {
  const auth = await requirePageAuth();
  const generated = formatWhen(new Date());
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rapports et exports"
        subtitle={`Généré le ${generated}. La date des relevés est incluse dans chaque fichier. Le résumé hebdomadaire par e-mail s'active dans Paramètres.`}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {REPORTS.map((r) => (
          <Card key={r.type}>
            <h3 className="font-semibold">{r.label}</h3>
            <p className="mt-1 text-sm text-[#6b858c]">Espace : {auth.workspace.name}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="rounded-lg border border-[#d7e3e6] px-3 py-2 text-sm" href={`/api/reports?type=${r.type}&format=csv`}>
                CSV
              </a>
              <a className="rounded-lg border border-[#d7e3e6] px-3 py-2 text-sm" href={`/api/reports?type=${r.type}&format=xlsx`}>
                Excel
              </a>
              <a className="rounded-lg bg-[#0b4a56] px-3 py-2 text-sm text-white" href={`/reports/print?type=${r.type}`}>
                PDF / impression
              </a>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

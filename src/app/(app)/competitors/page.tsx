import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { competitors, monitoringErrors, monitoringJobs, products } from "@/db/schema";
import { CatalogTools, CheckNowButton, CompetitorForm } from "@/components/ClientWidgets";
import { catalogStatus } from "@/lib/catalog";
import { schedulerStatus } from "@/lib/scheduler";
import { fr } from "@/lib/labels";
import { Badge, Card, PageHeader } from "@/components/ui";
import { deleteCompetitorAction, toggleCompetitorAction } from "@/lib/actions";
import { BUILTIN_CONNECTORS, isSelectedCompetitor } from "@/lib/connectors";
import { requirePageAuth } from "@/lib/page-auth";
import { formatWhen, relativeTime } from "@/lib/money";

export const metadata = { title: "Concurrents" };

export default async function CompetitorsPage() {
  const auth = await requirePageAuth();
  const rows = (await db.select().from(competitors).where(eq(competitors.workspaceId, auth.workspace.id))).filter((c) => !c.isOwnShop && isSelectedCompetitor(c));
  const jobs = await db
    .select()
    .from(monitoringJobs)
    .where(eq(monitoringJobs.workspaceId, auth.workspace.id))
    .orderBy(desc(monitoringJobs.createdAt))
    .limit(12);
  const errors = await db
    .select()
    .from(monitoringErrors)
    .where(eq(monitoringErrors.workspaceId, auth.workspace.id))
    .orderBy(desc(monitoringErrors.createdAt))
    .limit(8);
  const catalogs = await catalogStatus(rows.map((r) => r.id));
  const worker = schedulerStatus();
  const [{ total }] = await db.select({ total: count() }).from(products).where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const [{ searched }] = await db
    .select({ searched: count() })
    .from(products)
    .where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt), isNotNull(products.lastMatchedAt)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sources concurrentes"
        subtitle="Les prix sont lus en direct sur les pages produits publiques de chaque concurrent. Les produits sont retrouvés par leur référence grâce aux plans de site publiés par les boutiques (robots.txt respecté, aucun contournement anti-robot)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CatalogTools />
            <CheckNowButton />
          </div>
        }
      />

      <div className="mb-4 rounded-xl border border-[#d7e3e6] bg-white p-3 text-sm text-[#4d6a72]">
        <span className="font-semibold text-[#0b4a56]">Recherche automatique :</span>{" "}
        {worker.active ? (worker.running ? "en cours" : "active") : "arrêtée"} · {searched} sur {total} produits recherchés par référence
        {total - searched > 0 ? ` · ${total - searched} en attente` : " · tous les produits ont été recherchés (nouvelle vérification chaque jour)"}
        {worker.lastTick ? ` · dernier passage ${relativeTime(worker.lastTick)}` : ""}
        {worker.lastError ? <span className="text-[#c53d3d]"> · dernière erreur : {worker.lastError}</span> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((c) => {
          const def = BUILTIN_CONNECTORS.find((d) => d.slug === c.slug);
          return (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b4a56] text-sm font-bold text-white">{c.logoText ?? c.name.slice(0, 2)}</div>
                  <div>
                    <h2 className="font-semibold">{c.name}</h2>
                    <a href={c.websiteUrl} className="text-xs text-[#1b6f9a] underline" target="_blank" rel="noreferrer">
                      {c.domain}
                    </a>
                  </div>
                </div>
                <Badge tone={c.connectorStatus === "demo" ? "gold" : c.connectorStatus === "error" ? "bad" : c.enabled ? "teal" : "slate"}>
                  {fr(c.connectorStatus)}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-[#4d6a72]">{c.connectorNotes}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div>
                  Dernier succès
                  <div className="font-medium">{c.lastSuccessfulCheck ? relativeTime(c.lastSuccessfulCheck) : "jamais"}</div>
                </div>
                <div>
                  Prochaine vérification
                  <div className="font-medium">{c.nextCheckAt ? formatWhen(c.nextCheckAt) : "—"}</div>
                </div>
                <div>
                  Catalogue indexé
                  <div className="font-medium">
                    {(catalogs.get(c.id)?.size ?? 0).toLocaleString("fr-FR")} produits
                    {catalogs.get(c.id)?.indexedAt ? <span className="text-xs text-[#4d6a72]"> · {relativeTime(catalogs.get(c.id)!.indexedAt!)}</span> : null}
                  </div>
                </div>
                <div>
                  Offres suivies
                  <div className="font-medium">{c.trackedProductCount}</div>
                </div>
                <div>
                  Nouveautés / changements de prix
                  <div className="font-medium">
                    {c.newListingsCount} / {c.priceChangesCount}
                  </div>
                </div>
              </dl>
              {c.lastError ? <p className="mt-2 text-xs text-[#c53d3d]">{c.lastError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <CheckNowButton competitorId={c.id} />
                <form action={toggleCompetitorAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="enabled" value={c.enabled ? "false" : "true"} />
                  <button className="h-10 rounded-lg border border-[#d7e3e6] px-3 text-sm">{c.enabled ? "Désactiver" : "Activer"}</button>
                </form>
                {!c.isBuiltIn ? (
                  <form action={deleteCompetitorAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="h-10 px-3 text-sm text-[#c53d3d]">Supprimer</button>
                  </form>
                ) : null}
              </div>
              {def ? (
                <p className="mt-3 text-[11px] text-[#6b858c]">
                  Recherche automatique : {def.capabilities.automated ? "oui" : "non"} · robots : {def.robotsUrl}
                </p>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Ajouter une source</h2>
        <CompetitorForm />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Passages de surveillance</h2>
          <ul className="space-y-2 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex justify-between gap-3 rounded-lg bg-[#f4f8f9] px-3 py-2">
                <span>
                  {fr(j.trigger)} · {fr(j.status)} · {j.productsChecked} vérifiés / {j.changesDetected} changements
                </span>
                <span className="text-[#6b858c]">{j.finishedAt ? relativeTime(j.finishedAt) : "en cours"}</span>
              </li>
            ))}
            {!jobs.length ? <p className="text-sm text-[#6b858c]">Aucun passage pour le moment. Utilisez « Vérifier maintenant ».</p> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Erreurs</h2>
          <ul className="space-y-2 text-sm">
            {errors.map((e) => (
              <li key={e.id}>
                <span className="font-medium">{fr(e.classification)}</span> — {e.message}
                <div className="text-xs text-[#6b858c]">{relativeTime(e.createdAt)}</div>
              </li>
            ))}
            {!errors.length ? <p className="text-[#6b858c]">Aucune erreur de surveillance enregistrée.</p> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { InviteForm } from "@/components/ClientWidgets";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { updateProfileAction, updateWorkspaceAction } from "@/lib/actions";
import { requirePageAuth } from "@/lib/page-auth";
import { formatWhen, n } from "@/lib/money";
import { fr } from "@/lib/labels";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const auth = await requirePageAuth();
  const members = await db.select().from(users).where(eq(users.workspaceId, auth.workspace.id));
  const logs = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, auth.workspace.id)).orderBy(desc(auditLogs.createdAt)).limit(20);
  const canManage = auth.user.role === "owner" || auth.user.role === "administrator";

  return (
    <div className="space-y-6">
      <PageHeader title="Paramètres" subtitle="Espace, hypothèses fiscales, fréquence de surveillance, alertes et membres. Les collaborateurs ne peuvent modifier que leur propre profil." />

      <Card>
        <h2 className="mb-4 font-semibold">Votre profil et vos notifications</h2>
        <form action={updateProfileAction} className="grid gap-3 md:grid-cols-2">
          <Field label="Nom complet">
            <Input name="fullName" defaultValue={auth.user.fullName} />
          </Field>
          <Field label="Fonction">
            <Input name="jobTitle" defaultValue={auth.user.jobTitle ?? ""} />
          </Field>
          <Field label="Téléphone">
            <Input name="phone" defaultValue={auth.user.phone ?? ""} />
          </Field>
          <Field label="Devise d'affichage">
            <Input name="currency" defaultValue={auth.settings.currency} />
          </Field>
          <Field label="Début des heures de silence">
            <Input name="quietHoursStart" defaultValue={auth.settings.quietHoursStart ?? "22:00"} />
          </Field>
          <Field label="Fin des heures de silence">
            <Input name="quietHoursEnd" defaultValue={auth.settings.quietHoursEnd ?? "07:00"} />
          </Field>
          <Field label="Alerter si un concurrent baisse de plus de %">
            <Input name="alertPriceDropPct" type="number" step="0.1" defaultValue={n(auth.settings.alertPriceDropPct) * 100} />
          </Field>
          <div className="md:col-span-2 grid gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="emailNotifications" defaultChecked={auth.settings.emailNotifications} /> Notifications par e-mail
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="inAppNotifications" defaultChecked={auth.settings.inAppNotifications} /> Notifications dans l’application
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="browserNotifications" defaultChecked={auth.settings.browserNotifications} /> Notifications du navigateur (autorisation demandée par le navigateur)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="weeklyReportEmail" defaultChecked={auth.settings.weeklyReportEmail} /> Résumé hebdomadaire du marché par e-mail
            </label>
          </div>
          <button className="h-10 rounded-lg bg-[#0b4a56] px-4 text-sm text-white">Enregistrer le profil</button>
        </form>
      </Card>

      {canManage ? (
        <Card>
          <h2 className="mb-4 font-semibold">Espace, TVA et surveillance</h2>
          <form action={updateWorkspaceAction} className="grid gap-3 md:grid-cols-2">
            <Field label="Nom de l'espace">
              <Input name="name" defaultValue={auth.workspace.name} />
            </Field>
            <Field label="Raison sociale">
              <Input name="legalName" defaultValue={auth.workspace.legalName ?? ""} />
            </Field>
            <Field label="Ville">
              <Input name="city" defaultValue={auth.workspace.city ?? ""} />
            </Field>
            <Field label="Téléphone">
              <Input name="phone" defaultValue={auth.workspace.phone ?? ""} />
            </Field>
            <Field label="TVA par défaut %">
              <Input name="defaultVatRate" type="number" step="0.1" defaultValue={n(auth.workspace.defaultVatRate) * 100} />
            </Field>
            <Field label="Marge minimale par défaut %">
              <Input name="defaultMinMargin" type="number" step="0.1" defaultValue={n(auth.workspace.defaultMinMargin) * 100} />
            </Field>
            <Field label="Coût de vente variable %">
              <Input name="variableSellingCostRate" type="number" step="0.1" defaultValue={n(auth.workspace.variableSellingCostRate) * 100} />
            </Field>
            <Field label="Charges mensuelles (DT)">
              <Input name="monthlyOperatingCosts" type="number" step="0.001" defaultValue={n(auth.workspace.monthlyOperatingCosts)} />
            </Field>
            <Field label="Seuil de stock faible">
              <Input name="lowStockThreshold" type="number" defaultValue={auth.workspace.lowStockThreshold} />
            </Field>
            <Field label="Intervalle de surveillance (minutes)">
              <Input name="monitoringIntervalMinutes" type="number" defaultValue={auth.workspace.monitoringIntervalMinutes} />
            </Field>
            <Field label="Conservation des données (jours)">
              <Input name="dataRetentionDays" type="number" defaultValue={auth.workspace.dataRetentionDays} />
            </Field>
            <div className="md:col-span-2 grid gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="purchasePricesIncludeVat" defaultChecked={auth.workspace.purchasePricesIncludeVat} /> Les prix d’achat incluent la TVA récupérable
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="sellingPricesIncludeVat" defaultChecked={auth.workspace.sellingPricesIncludeVat} /> Les prix de vente incluent la TVA (TTC)
              </label>
            </div>
            <button className="h-10 rounded-lg bg-[#0b4a56] px-4 text-sm text-white">Enregistrer l’espace</button>
          </form>
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <h2 className="mb-3 font-semibold">Membres · propriétaire / administrateur / collaborateur</h2>
          <ul className="mb-4 text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex justify-between border-b border-[#eef3f5] py-2">
                <span>
                  {m.fullName} · {m.email}
                </span>
                <span className="text-[#6b858c]">{fr(m.role)}</span>
              </li>
            ))}
          </ul>
          <InviteForm />
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold">Journal des modifications</h2>
        <ul className="space-y-1 text-sm">
          {logs.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span>
                {fr(l.action)}
              </span>
              <span className="text-[#6b858c]">{formatWhen(l.createdAt)}</span>
            </li>
          ))}
          {!logs.length ? <p className="text-[#6b858c]">Aucune modification enregistrée pour le moment.</p> : null}
        </ul>
      </Card>
    </div>
  );
}

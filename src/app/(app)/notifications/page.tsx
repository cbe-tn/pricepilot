import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { Badge, PageHeader } from "@/components/ui";
import { markNotificationsAction } from "@/lib/actions";
import { requirePageAuth } from "@/lib/page-auth";
import { relativeTime } from "@/lib/money";
import { fr } from "@/lib/labels";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const auth = await requirePageAuth();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.workspaceId, auth.workspace.id))
    .orderBy(desc(notifications.createdAt))
    .limit(80);

  return (
    <div>
      <PageHeader
        title="Centre de notifications"
        subtitle="Les alertes sont dédoublonnées. Les heures de silence et les canaux se règlent dans Paramètres. Chaque alerte renvoie vers le produit ou la source concernée."
        actions={
          <form action={markNotificationsAction}>
            <input type="hidden" name="all" value="true" />
            <button className="h-10 rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm">Tout marquer comme lu</button>
          </form>
        }
      />
      <form action={markNotificationsAction} className="space-y-2">
        {rows.map((n) => (
          <label key={n.id} className={`flex gap-3 rounded-xl border border-[#d7e3e6] bg-white p-4 ${n.readAt ? "opacity-70" : ""}`}>
            <input type="checkbox" name="ids" value={n.id} className="mt-1" />
            <a href={n.href ?? "#"} className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{n.title}</p>
                <Badge tone="teal">{fr(n.type)}</Badge>
                {!n.readAt ? <Badge tone="gold">Non lue</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-[#4d6a72]">{n.body}</p>
              <p className="mt-1 text-xs text-[#6b858c]">{relativeTime(n.createdAt)}</p>
            </a>
          </label>
        ))}
        <button className="h-10 rounded-lg bg-[#0b4a56] px-4 text-sm text-white">Marquer la sélection comme lue</button>
      </form>
    </div>
  );
}

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { requirePageAuth } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePageAuth({ allowPurchasing: true });
  const unreadRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.workspaceId, auth.workspace.id), eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));
  const unread = Number(unreadRows[0]?.c ?? 0);
  return (
    <AppShell
      unread={unread}
      user={{
        fullName: auth.user.fullName,
        email: auth.user.email,
        role: auth.user.role,
        workspaceName: auth.workspace.name,
      }}
    >
      {children}
    </AppShell>
  );
}

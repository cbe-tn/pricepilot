import { randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  passwordResetTokens,
  sessions,
  userSettings,
  users,
  workspaces,
  type User,
  type UserSettings,
  type Workspace,
} from "@/db/schema";
import { hashPassword, hashToken, verifyPassword } from "@/lib/auth-password";
import { ensureDemoSeed } from "@/lib/seed";

export { hashPassword, hashToken, verifyPassword };

export const SESSION_COOKIE = "pp_session";
const SESSION_DAYS = 14;

export type AuthContext = {
  user: User;
  workspace: Workspace;
  settings: UserSettings;
};

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const hdrs = await headers();
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
    userAgent: hdrs.get("user-agent") ?? null,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
}

export async function getAuth(): Promise<AuthContext | null> {
  // Demo data is opt-in for development only; real workspaces never get seeded.
  if (process.env.PRICEPILOT_DEMO_SEED === "1") {
    try {
      await ensureDemoSeed();
    } catch {
      // Seed is best-effort; auth still proceeds.
    }
  }
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(workspaces, eq(users.workspaceId, workspaces.id))
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.users.isActive) return null;
  let settings = row.user_settings;
  if (!settings) {
    // Concurrent first requests (layout + page) may both get here: the loser reads the winner's row.
    const created = await db.insert(userSettings).values({ userId: row.users.id }).onConflictDoNothing().returning();
    settings = created[0] ?? (await db.select().from(userSettings).where(eq(userSettings.userId, row.users.id)).limit(1))[0];
  }
  return { user: row.users, workspace: row.workspaces, settings };
}

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) {
    throw new Error("UNAUTHENTICATED");
  }
  return auth;
}

export function canManageWorkspace(role: User["role"]): boolean {
  return role === "owner" || role === "administrator";
}

/** Home of the "Acheteur" role, the only page it may open. */
export const PURCHASING_PATH = "/purchasing";

/** Acheteur accounts only import supplier price lists and compare suppliers. */
export function isPurchasingOnly(role: User["role"]): boolean {
  return role === "purchasing";
}

export async function writeAudit(
  auth: AuthContext,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogs).values({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    action,
    entityType,
    entityId,
    details,
  });
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimitLogin(key: string, limit = 8, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || rec.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  rec.count += 1;
  return rec.count <= limit;
}

export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString("hex");
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

export async function consumeResetToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, new Date()),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
  return row.userId;
}

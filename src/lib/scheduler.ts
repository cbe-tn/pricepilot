// Background worker: keeps competitor offers current without any manual step.
//  1. Auto-match: every active product is searched by its reference on all enabled competitors
//     when it is new, then again every MATCH_INTERVAL (competitors list new products over time).
//  2. Monitoring: tracked offers are re-checked when each competitor's nextCheckAt is due.
//  3. Own shop: each product is looked up on our own web shop (link + live price, or "to add").
// Runs inside the Next.js server process (started from src/instrumentation.ts) on a normal server,
// or one bounded pass per call of /api/cron on serverless hosts (Vercel), where no process stays alive.

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { randomUUID } from "crypto";
import { competitors, jobLeases, products, userSettings, users, workspaces } from "@/db/schema";
import { autoMatchProduct, matchOwnListing, ownShopFor, searchTermsForProduct } from "@/lib/catalog";
import { runMonitoringJob } from "@/lib/monitoring";
import type { AuthContext } from "@/lib/auth";

const TICK_MS = 60 * 1000;
const MATCH_INTERVAL_MS = 24 * 3600 * 1000;
const MATCH_BATCH = 5; // products per tick, so a big import is spread out politely

type SchedulerState = { timer?: ReturnType<typeof setInterval>; running: boolean; kicked: boolean; lastTick?: Date; lastError?: string };
const g = globalThis as typeof globalThis & { __pricePilotScheduler?: SchedulerState };

function state(): SchedulerState {
  if (!g.__pricePilotScheduler) g.__pricePilotScheduler = { running: false, kicked: false };
  return g.__pricePilotScheduler;
}

/** Acts on behalf of the workspace owner (notifications go to them). */
async function systemAuth(workspaceId: string): Promise<AuthContext | null> {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.isActive, true)))
    .orderBy(sql`case when ${users.role} = 'owner' then 0 when ${users.role} = 'administrator' then 1 else 2 end`)
    .limit(1);
  if (!workspace || !user) return null;
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  return { workspace, user, settings } as AuthContext;
}

/** Time left before the caller's deadline; a product search can take ~40 s, so stop with margin. */
const SAFETY_MS = 45_000;
const timeLeft = (deadline?: number) => (deadline ? deadline - Date.now() > SAFETY_MS : true);

async function autoMatchDue(auth: AuthContext, deadline?: number): Promise<number> {
  const cutoff = new Date(Date.now() - MATCH_INTERVAL_MS);
  const due = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.workspaceId, auth.workspace.id),
        isNull(products.archivedAt),
        or(isNull(products.lastMatchedAt), lte(products.lastMatchedAt, cutoff)),
      ),
    )
    .orderBy(sql`${products.lastMatchedAt} asc nulls first`, asc(products.createdAt))
    .limit(MATCH_BATCH);
  let done = 0;
  for (const p of due) {
    if (!timeLeft(deadline)) break; // the rest stays due for the next run
    done += 1;
    try {
      if (searchTermsForProduct(p).length) await autoMatchProduct(auth, p);
    } finally {
      // Mark as searched even on failure so one bad product never blocks the queue.
      await db.update(products).set({ lastMatchedAt: new Date() }).where(eq(products.id, p.id));
    }
  }
  return done;
}

async function ownListingDue(auth: AuthContext, deadline?: number): Promise<number> {
  if (!(await ownShopFor(auth.workspace.id))) return 0;
  const cutoff = new Date(Date.now() - MATCH_INTERVAL_MS);
  const due = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.workspaceId, auth.workspace.id),
        isNull(products.archivedAt),
        or(isNull(products.ownCheckedAt), lte(products.ownCheckedAt, cutoff)),
      ),
    )
    // Stock first: those are the products we must have online.
    .orderBy(sql`${products.ownCheckedAt} asc nulls first`, sql`${products.stockQty} > 0 desc`, asc(products.createdAt))
    .limit(MATCH_BATCH);
  let done = 0;
  for (const p of due) {
    if (!timeLeft(deadline)) break;
    done += 1;
    try {
      if (searchTermsForProduct(p).length) await matchOwnListing(auth, p);
      else await db.update(products).set({ ownCheckedAt: new Date() }).where(eq(products.id, p.id));
    } catch (error) {
      await db.update(products).set({ ownCheckedAt: new Date() }).where(eq(products.id, p.id));
      console.error("[pricepilot] own-shop lookup failed:", error instanceof Error ? error.message : error);
    }
  }
  return done;
}

async function monitoringDue(auth: AuthContext, deadline?: number): Promise<number> {
  const due = await db
    .select()
    .from(competitors)
    .where(
      and(
        eq(competitors.workspaceId, auth.workspace.id),
        eq(competitors.enabled, true),
        or(isNull(competitors.nextCheckAt), lte(competitors.nextCheckAt, new Date())),
      ),
    );
  let done = 0;
  for (const c of due) {
    if (deadline && deadline - Date.now() < 20_000) break;
    await runMonitoringJob(auth, { competitorId: c.id, trigger: "scheduled", deadline: deadline ? deadline - 15_000 : undefined });
    done += 1;
  }
  return done;
}

/**
 * Database lease so only one run works at a time, even across serverless instances. A crashed run
 * frees the lease when it expires. Without the job_leases table, only the in-process flag applies.
 */
async function acquireLease(holder: string, ms: number): Promise<boolean> {
  try {
    const rows = await db
      .insert(jobLeases)
      .values({ name: "scheduler", holder, lockedUntil: new Date(Date.now() + ms) })
      .onConflictDoUpdate({
        target: jobLeases.name,
        set: { holder, lockedUntil: new Date(Date.now() + ms) },
        setWhere: lte(jobLeases.lockedUntil, new Date()),
      })
      .returning({ holder: jobLeases.holder });
    return rows[0]?.holder === holder;
  } catch {
    return true;
  }
}

async function releaseLease(holder: string) {
  try {
    await db.update(jobLeases).set({ lockedUntil: new Date() }).where(and(eq(jobLeases.name, "scheduler"), eq(jobLeases.holder, holder)));
  } catch {
    // table missing: nothing to release
  }
}

/** One scheduler pass. With `budgetMs` (serverless), work stops before the budget is spent. */
export async function schedulerTick(opts?: { budgetMs?: number }): Promise<{ matched: number; monitored: number; skipped?: boolean }> {
  const s = state();
  if (s.running) return { matched: 0, monitored: 0, skipped: true };
  const deadline = opts?.budgetMs ? Date.now() + opts.budgetMs : undefined;
  const holder = randomUUID();
  if (!(await acquireLease(holder, (opts?.budgetMs ?? 10 * 60_000) + 60_000))) return { matched: 0, monitored: 0, skipped: true };
  s.running = true;
  let matched = 0;
  let monitored = 0;
  try {
    for (const ws of await db.select({ id: workspaces.id }).from(workspaces)) {
      const auth = await systemAuth(ws.id);
      if (!auth) continue;
      matched += await autoMatchDue(auth, deadline);
      matched += await ownListingDue(auth, deadline);
      monitored += await monitoringDue(auth, deadline);
    }
    s.lastError = undefined;
  } catch (error) {
    s.lastError = error instanceof Error ? error.message : String(error);
    console.error("[pricepilot] scheduler tick failed:", s.lastError);
  } finally {
    s.running = false;
    s.lastTick = new Date();
    await releaseLease(holder);
  }
  if (matched || monitored) console.log(`[pricepilot] scheduler: searched ${matched} products, checked ${monitored} competitors`);
  return { matched, monitored };
}

export function startScheduler() {
  const s = state();
  // Serverless (Vercel): no long-lived process — passes are triggered by /api/cron instead.
  if (s.timer || process.env.PRICEPILOT_SCHEDULER === "0" || process.env.VERCEL) return;
  s.timer = setInterval(() => {
    // Keep going while there is a backlog (e.g. right after an import); otherwise one tick per minute.
    void schedulerTick().then((r) => {
      if (r.matched >= MATCH_BATCH) kickScheduler();
    });
  }, TICK_MS);
  setTimeout(() => void schedulerTick(), 5000);
  console.log("[pricepilot] background scheduler started (auto-match + monitoring)");
}

/** Ask for a tick soon (after imports / new products) instead of waiting for the next minute. */
export function kickScheduler() {
  const s = state();
  // Serverless: work started after the response would be frozen; the next /api/cron call picks it up.
  if (s.kicked || process.env.VERCEL) return;
  s.kicked = true;
  setTimeout(() => {
    s.kicked = false;
    void schedulerTick().then((r) => {
      if (r.matched >= MATCH_BATCH) kickScheduler();
    });
  }, 1000);
}

export function schedulerStatus() {
  const s = state();
  return { active: Boolean(s.timer), running: s.running, lastTick: s.lastTick ?? null, lastError: s.lastError ?? null };
}

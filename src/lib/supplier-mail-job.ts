// Runs the e-mail check from the minute cron at most every 10 minutes and remembers how the last check
// went (shown on the comparator page). Both use the job_leases table: no extra schema.
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { jobLeases } from "@/db/schema";
import { checkSupplierMail, mailConfigured, type MailCheckResult } from "@/lib/supplier-mail";

const LEASE = "supplier-mail";
/** Held while a check runs, so the cron and "Vérifier maintenant" never read the box at the same time. */
const RUNNING = "supplier-mail-running";
const STATUS = "supplier-mail-status";
const EVERY_MS = 10 * 60_000;

export type MailStatus = { at: string; ok: boolean; result?: MailCheckResult; error?: string };

async function lease(name: string, ms: number, holder = `${Date.now()}-${Math.random()}`): Promise<string | null> {
  const rows = await db
    .insert(jobLeases)
    .values({ name, holder, lockedUntil: new Date(Date.now() + ms) })
    .onConflictDoUpdate({ target: jobLeases.name, set: { holder, lockedUntil: new Date(Date.now() + ms) }, setWhere: lte(jobLeases.lockedUntil, new Date()) })
    .returning({ holder: jobLeases.holder });
  return rows[0]?.holder === holder ? holder : null;
}

async function saveStatus(status: MailStatus) {
  const holder = JSON.stringify(status).slice(0, 2000);
  await db.insert(jobLeases).values({ name: STATUS, holder, lockedUntil: new Date() }).onConflictDoUpdate({ target: jobLeases.name, set: { holder, lockedUntil: new Date() } });
}

export async function lastMailStatus(): Promise<MailStatus | null> {
  const [row] = await db.select().from(jobLeases).where(eq(jobLeases.name, STATUS)).limit(1);
  try {
    return row ? (JSON.parse(row.holder) as MailStatus) : null;
  } catch {
    return null;
  }
}

function explain(e: unknown): string {
  const err = e as { authenticationFailed?: boolean; code?: string; message?: string; responseText?: string };
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials/i.test(`${err?.responseText ?? ""} ${err?.message ?? ""}`)) {
    return "Connexion refusée par la boîte e-mail : vérifiez MAIL_IMAP_USER et MAIL_IMAP_PASSWORD (et MAIL_IMAP_HOST pour une offre OVH Email Pro).";
  }
  if (err?.code === "ENOTFOUND" || err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED") return "Serveur e-mail injoignable (MAIL_IMAP_HOST / MAIL_IMAP_PORT).";
  return (err?.message ?? "Erreur inconnue").slice(0, 300);
}

/** force = "Vérifier maintenant" (ignores the 10-minute spacing). */
export async function runMailCheck(opts: { force?: boolean; deadline?: number } = {}): Promise<MailStatus | null> {
  if (!mailConfigured()) return null;
  if (!opts.force && !(await lease(LEASE, EVERY_MS))) return null;
  const running = await lease(RUNNING, 3 * 60_000);
  if (!running) return null; // another check is reading the box right now
  let status: MailStatus;
  try {
    status = { at: new Date().toISOString(), ok: true, result: await checkSupplierMail({ deadline: opts.deadline }) };
  } catch (e) {
    status = { at: new Date().toISOString(), ok: false, error: explain(e) };
  } finally {
    await db.update(jobLeases).set({ lockedUntil: new Date() }).where(and(eq(jobLeases.name, RUNNING), eq(jobLeases.holder, running))).catch(() => undefined);
  }
  await saveStatus(status).catch(() => undefined);
  return status;
}

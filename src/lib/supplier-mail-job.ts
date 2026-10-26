// Runs the e-mail check from the minute cron at most every 10 minutes and remembers how the last check
// went (shown on the comparator page). Both use the job_leases table: no extra schema.
import { eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { jobLeases } from "@/db/schema";
import { checkSupplierMail, mailConfigured, type MailCheckResult } from "@/lib/supplier-mail";

const LEASE = "supplier-mail";
const STATUS = "supplier-mail-status";
const EVERY_MS = 10 * 60_000;

export type MailStatus = { at: string; ok: boolean; result?: MailCheckResult; error?: string };

async function due(): Promise<boolean> {
  const holder = `${Date.now()}`;
  const rows = await db
    .insert(jobLeases)
    .values({ name: LEASE, holder, lockedUntil: new Date(Date.now() + EVERY_MS) })
    .onConflictDoUpdate({ target: jobLeases.name, set: { holder, lockedUntil: new Date(Date.now() + EVERY_MS) }, setWhere: lte(jobLeases.lockedUntil, new Date()) })
    .returning({ holder: jobLeases.holder });
  return rows[0]?.holder === holder;
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
    return "Connexion refusée par la boîte e-mail : vérifiez MAIL_IMAP_USER et le mot de passe d'application (MAIL_IMAP_PASSWORD).";
  }
  if (err?.code === "ENOTFOUND" || err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED") return "Serveur e-mail injoignable (MAIL_IMAP_HOST / MAIL_IMAP_PORT).";
  return (err?.message ?? "Erreur inconnue").slice(0, 300);
}

/** force = "Vérifier maintenant" (ignores the 10-minute spacing). */
export async function runMailCheck(opts: { force?: boolean; deadline?: number } = {}): Promise<MailStatus | null> {
  if (!mailConfigured()) return null;
  if (!opts.force && !(await due())) return null;
  let status: MailStatus;
  try {
    status = { at: new Date().toISOString(), ok: true, result: await checkSupplierMail({ deadline: opts.deadline }) };
  } catch (e) {
    status = { at: new Date().toISOString(), ok: false, error: explain(e) };
  }
  await saveStatus(status).catch(() => undefined);
  return status;
}

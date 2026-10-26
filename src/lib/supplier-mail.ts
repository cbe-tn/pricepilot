// Supplier price lists received by e-mail. The mailbox (Gmail with an app password, or any IMAP box) is
// opened read-only: nothing is marked as read, moved, deleted or sent. Attachments (PDF, Word, Excel,
// CSV) from known suppliers, or that look like a price list, are read with the same parser as the
// manual upload. A known sender with clearly detected columns is imported at once; anything else waits
// "à vérifier" on the comparator page.
import { and, eq } from "drizzle-orm";
import { ImapFlow, type MessageStructureObject } from "imapflow";
import { db } from "@/db";
import { supplierInbox, suppliers, workspaces } from "@/db/schema";
import { importSupplierLines } from "@/lib/purchasing-import";
import { detectTable, linesFromTable, lowPriceCount, type ParsedLine } from "@/lib/supplier-columns";
import { extractTables } from "@/lib/supplier-files";

export const mailConfigured = () => Boolean(process.env.MAIL_IMAP_USER && process.env.MAIL_IMAP_PASSWORD);
export const mailAddress = () => process.env.MAIL_IMAP_USER ?? null;

const ALLOWED = /\.(xlsx|xlsm|xls|csv|ods|docx|pdf)$/i;
const MAX_BYTES = 15 * 1024 * 1024;
const LOOKBACK_DAYS = 7;
/** Words of a price-list subject or file name (needed when the sender is not a known supplier). */
const LOOKS_LIKE_PRICES = /prix|tarif|price|liste|list|offre|catalogue|stock|promo|devis|quotation|disponibilit/i;
/** Webmail and ISP domains: a sender there is identified by the full address only, never by the domain. */
const GENERIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.fr",
  "yahoo.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "icloud.com",
  "gnet.tn",
  "topnet.tn",
  "planet.tn",
  "orange.tn",
]);
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

type SupplierRef = { id: string; name: string };

/** Addresses and company domains of our suppliers (e-mail field and every address in the notes). */
export async function supplierDirectory(workspaceId: string) {
  const rows = await db.select().from(suppliers).where(eq(suppliers.workspaceId, workspaceId));
  const byAddress = new Map<string, SupplierRef>();
  const byDomain = new Map<string, SupplierRef | null>();
  for (const s of rows) {
    const ref = { id: s.id, name: s.name };
    for (const raw of `${s.email ?? ""} ${s.notes ?? ""}`.match(EMAIL_RE) ?? []) {
      const address = raw.toLowerCase();
      byAddress.set(address, ref);
      const domain = address.split("@")[1];
      if (GENERIC_DOMAINS.has(domain)) continue;
      const prev = byDomain.get(domain);
      // A domain shared by two suppliers identifies neither.
      byDomain.set(domain, prev === undefined || prev?.id === s.id ? ref : null);
    }
  }
  return {
    identify(address: string): SupplierRef | null {
      const a = address.toLowerCase();
      return byAddress.get(a) ?? byDomain.get(a.split("@")[1] ?? "") ?? null;
    },
  };
}

export type ParsedFile = { lines: ParsedLine[]; basis: "ht" | "ttc"; low: number };

/** Every table of the file with a detected price column, read with the manual upload's rules. */
export async function parsePriceFile(buffer: Buffer, fileName: string): Promise<ParsedFile> {
  const tables = (await extractTables(buffer, fileName)).map(detectTable);
  const lines: ParsedLine[] = [];
  let low = 0;
  let ttc = 0;
  for (const t of tables) {
    const found = linesFromTable(t, t.headerRow, t.mapping);
    if (!found.length) continue;
    lines.push(...found);
    low += lowPriceCount(t, t.headerRow, t.mapping);
    if (t.basis === "ttc") ttc += found.length;
  }
  const basis = ttc > lines.length / 2 || (!ttc && /\bttc\b/i.test(fileName)) ? "ttc" : "ht";
  return { lines, basis, low };
}

/** Why a file cannot be imported without a look, or null when it can. */
export function doubtReason(supplier: SupplierRef | null, parsed: ParsedFile): string | null {
  if (!supplier) return "Expéditeur inconnu : choisissez le fournisseur.";
  if (parsed.lines.length < 3) return "Colonnes de prix non reconnues dans le fichier.";
  if (parsed.low > parsed.lines.length * 0.2) return "Beaucoup de lignes à moins de 1 DT (taux de TVA ou remises ?) : vérifiez le fichier.";
  return null;
}

type Attachment = { part: string; fileName: string; mime: string; size: number };

function attachmentsOf(node: MessageStructureObject | undefined, out: Attachment[] = []): Attachment[] {
  if (!node) return out;
  const fileName = node.dispositionParameters?.filename ?? node.parameters?.name;
  // Size on the wire is base64 (about 4/3 of the file).
  if (node.part && fileName && ALLOWED.test(fileName) && (node.size ?? 0) <= MAX_BYTES * 1.4) {
    out.push({ part: node.part, fileName: fileName.slice(0, 200), mime: node.type || "application/octet-stream", size: node.size ?? 0 });
  }
  for (const child of node.childNodes ?? []) attachmentsOf(child, out);
  return out;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks);
}

export type MailCheckResult = { messages: number; imported: number; pending: number; errors: number; skipped?: string };

/** One pass over the recent messages; already handled attachments are skipped (unique message + file name). */
export async function checkSupplierMail(opts?: { deadline?: number }): Promise<MailCheckResult> {
  const result: MailCheckResult = { messages: 0, imported: 0, pending: 0, errors: 0 };
  if (!mailConfigured()) return { ...result, skipped: "Boîte e-mail non configurée (MAIL_IMAP_USER / MAIL_IMAP_PASSWORD)." };
  const [ws] = await db.select().from(workspaces).limit(1);
  if (!ws) return { ...result, skipped: "Aucun espace de travail." };
  const directory = await supplierDirectory(ws.id);
  const host = process.env.MAIL_IMAP_HOST || "imap.gmail.com";
  const client = new ImapFlow({
    host,
    port: Number(process.env.MAIL_IMAP_PORT) || 993,
    secure: true,
    // Google shows app passwords in groups of four letters: spaces are not part of it.
    auth: { user: process.env.MAIL_IMAP_USER!, pass: process.env.MAIL_IMAP_PASSWORD!.replace(/\s+/g, "") },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(process.env.MAIL_IMAP_FOLDER || "INBOX", { readOnly: true });
  try {
    const query = host.includes("gmail") ? { gmraw: `has:attachment newer_than:${LOOKBACK_DAYS}d` } : { since: new Date(Date.now() - LOOKBACK_DAYS * 86_400_000) };
    const uids = ((await client.search(query, { uid: true })) || []).slice(-60);
    if (!uids.length) return result;
    // Read the list first: no other IMAP command may run while fetch() is streaming.
    const messages: Array<{ uid: number; messageId: string; from: string; fromName: string | null; subject: string; date: Date | null; attachments: Attachment[] }> = [];
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
      const from = msg.envelope?.from?.[0];
      const attachments = attachmentsOf(msg.bodyStructure);
      if (!from?.address || !attachments.length) continue;
      messages.push({
        uid: msg.uid,
        messageId: msg.envelope?.messageId || `uid-${msg.uid}`,
        from: from.address.toLowerCase(),
        fromName: from.name || null,
        subject: msg.envelope?.subject ?? "",
        date: msg.internalDate ? new Date(msg.internalDate) : null,
        attachments,
      });
    }
    for (const m of messages) {
      if (opts?.deadline && Date.now() > opts.deadline) break;
      const supplier = directory.identify(m.from);
      const done = new Set(
        (await db.select({ name: supplierInbox.attachmentName }).from(supplierInbox).where(and(eq(supplierInbox.workspaceId, ws.id), eq(supplierInbox.messageId, m.messageId)))).map((r) => r.name),
      );
      let counted = false;
      for (const att of m.attachments) {
        if (done.has(att.fileName)) continue;
        // Unknown senders: only files that look like a price list (invoices, photos… are left alone).
        if (!supplier && !LOOKS_LIKE_PRICES.test(`${m.subject} ${att.fileName}`)) continue;
        if (!counted) {
          result.messages += 1;
          counted = true;
        }
        const base = {
          workspaceId: ws.id,
          messageId: m.messageId,
          attachmentName: att.fileName,
          fromAddress: m.from,
          fromName: m.fromName,
          subject: m.subject.slice(0, 300),
          receivedAt: m.date,
          mime: att.mime,
          supplierId: supplier?.id ?? null,
        };
        try {
          const dl = await client.download(String(m.uid), att.part, { uid: true, maxBytes: MAX_BYTES });
          if (!dl.content) throw new Error("Pièce jointe introuvable.");
          const buffer = await readAll(dl.content);
          const parsed = await parsePriceFile(buffer, att.fileName);
          const doubt = doubtReason(supplier, parsed);
          if (!doubt && supplier) {
            const imp = await importSupplierLines({ workspaceId: ws.id, userId: null, supplierId: supplier.id, fileName: `${att.fileName} (e-mail)`, basis: parsed.basis, lines: parsed.lines });
            await db.insert(supplierInbox).values({ ...base, status: "imported", importId: imp.importId, priceBasis: parsed.basis, rowCount: imp.count, reason: `${imp.matched} article(s) reconnu(s) dans le catalogue` });
            result.imported += 1;
          } else {
            await db.insert(supplierInbox).values({ ...base, status: "pending", dataBase64: buffer.toString("base64"), priceBasis: parsed.basis, rowCount: parsed.lines.length, reason: doubt });
            result.pending += 1;
          }
        } catch (e) {
          await db
            .insert(supplierInbox)
            .values({ ...base, status: "error", reason: e instanceof Error ? e.message.slice(0, 300) : "Lecture impossible." })
            .onConflictDoNothing();
          result.errors += 1;
        }
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return result;
}

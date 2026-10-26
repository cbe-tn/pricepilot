// Supplier price lists received by e-mail. The mailbox (contact@numedia.tn on OVH, Gmail, or any IMAP box) is
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

/**
 * IMAP server: MAIL_IMAP_HOST when set; otherwise Gmail for a Gmail address and OVH (numedia.tn mail,
 * standard "MX Plan" offer) for anything else. OVH Email Pro uses pro1/pro2.mail.ovh.net instead.
 */
export function imapHost(): string {
  if (process.env.MAIL_IMAP_HOST) return process.env.MAIL_IMAP_HOST.trim();
  return /@(gmail|googlemail)\.com$/i.test(process.env.MAIL_IMAP_USER ?? "") ? "imap.gmail.com" : "ssl0.ovh.net";
}

const ALLOWED = /\.(xlsx|xlsm|xls|csv|ods|docx|pdf)$/i;
const MAX_BYTES = 15 * 1024 * 1024;
const LOOKBACK_DAYS = 7;
/** Words of a price-list subject or file name (needed when the sender is not a known supplier). */
const LOOKS_LIKE_PRICES = /prix|tarif|price|liste|list|offre|catalogue|stock|promo|devis|quotation|disponibilit/i;
/** Never a supplier price list: customers asking us for prices, spam, invoices and orders. */
const NOT_A_PRICE_LIST = /demande\s+(de\s+prix|d['’]\s*offre|de\s+devis|de\s+cotation)|\bDIP\b|\[spam\]|appel\s+d['’]\s*offres?|bon\s+de\s+commande|\bfacture\b|\binvoice\b/i;
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

/** Body text of the message (plain text preferred): a forward quotes the original sender there. */
function textPartOf(node: MessageStructureObject | undefined): { part: string; html: boolean } | null {
  if (!node) return null;
  const isAttachment = node.disposition === "attachment" || Boolean(node.dispositionParameters?.filename);
  if (!isAttachment && node.part && (node.type === "text/plain" || node.type === "text/html")) return { part: node.part, html: node.type === "text/html" };
  let html: { part: string; html: boolean } | null = null;
  for (const child of node.childNodes ?? []) {
    const found = textPartOf(child);
    if (found && !found.html) return found;
    html ??= found;
  }
  return html;
}

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
  const host = imapHost();
  const client = new ImapFlow({
    host,
    port: Number(process.env.MAIL_IMAP_PORT) || 993,
    secure: true,
    // Google shows app passwords in groups of four letters (spaces are not part of it); other boxes keep it as typed.
    auth: { user: process.env.MAIL_IMAP_USER!.trim(), pass: host.includes("gmail") ? process.env.MAIL_IMAP_PASSWORD!.replace(/\s+/g, "") : process.env.MAIL_IMAP_PASSWORD! },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(process.env.MAIL_IMAP_FOLDER || "INBOX", { readOnly: true });
  try {
    const query = host.includes("gmail") ? { gmraw: `has:attachment newer_than:${LOOKBACK_DAYS}d` } : { since: new Date(Date.now() - LOOKBACK_DAYS * 86_400_000) };
    const uids = ((await client.search(query, { uid: true })) || []).slice(-150);
    if (!uids.length) return result;
    // Read the list first: no other IMAP command may run while fetch() is streaming.
    const messages: Array<{
      uid: number;
      messageId: string;
      from: string;
      fromName: string | null;
      subject: string;
      date: Date | null;
      attachments: Attachment[];
      text: { part: string; html: boolean } | null;
    }> = [];
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
        text: textPartOf(msg.bodyStructure),
      });
    }
    // Newest first: a list that just arrived is never left behind by the time limit.
    messages.sort((a, b) => b.uid - a.uid);
    const ownAddress = (process.env.MAIL_IMAP_USER ?? "").toLowerCase().trim();
    const ownDomain = ownAddress.split("@")[1] ?? "";
    for (const m of messages) {
      if (opts?.deadline && Date.now() > opts.deadline) break;
      const known = await db
        .select({ id: supplierInbox.id, name: supplierInbox.attachmentName, status: supplierInbox.status, supplierId: supplierInbox.supplierId })
        .from(supplierInbox)
        .where(and(eq(supplierInbox.workspaceId, ws.id), eq(supplierInbox.messageId, m.messageId)));
      if (NOT_A_PRICE_LIST.test(m.subject)) {
        // Picked up before this rule existed: a customer's request or spam waiting "à vérifier".
        for (const r of known.filter((r) => r.status === "pending" || r.status === "error")) {
          await db.update(supplierInbox).set({ status: "ignored", dataBase64: null, reason: "Demande client, spam ou facture : pas une liste de prix fournisseur." }).where(eq(supplierInbox.id, r.id));
        }
        continue;
      }
      let supplier = directory.identify(m.from);
      let forwardedBy: string | null = null;
      // Files waiting only because the sender was unknown are looked at again (the supplier may now be found).
      const retry = new Map(known.filter((r) => r.status === "pending" && !r.supplierId).map((r) => [r.name, r.id]));
      const done = new Set(known.filter((r) => !retry.has(r.name)).map((r) => r.name));
      let counted = false;
      const fresh = m.attachments.filter((a) => !done.has(a.fileName));
      if (!fresh.length) continue;
      // A colleague forwarding a supplier's mail ("TR: …"): the supplier's address is quoted in the body.
      if (!supplier && m.text) {
        try {
          const dl = await client.download(String(m.uid), m.text.part, { uid: true, maxBytes: 400_000 });
          const body = dl.content ? (await readAll(dl.content)).toString("utf8") : "";
          for (const address of body.match(EMAIL_RE) ?? []) {
            const a = address.toLowerCase();
            if (a === m.from || a === ownAddress || a.endsWith(`@${ownDomain}`)) continue;
            const hit = directory.identify(a);
            if (hit) {
              supplier = hit;
              forwardedBy = m.fromName || m.from;
              break;
            }
          }
        } catch {
          // Body unreadable: the sender stays unknown.
        }
      }
      for (const att of fresh) {
        const retryId = retry.get(att.fileName);
        // Still no supplier: the waiting row stays as it is.
        if (retryId && !supplier) continue;
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
          if (retryId) await db.delete(supplierInbox).where(eq(supplierInbox.id, retryId));
          if (!doubt && supplier) {
            const imp = await importSupplierLines({ workspaceId: ws.id, userId: null, supplierId: supplier.id, fileName: `${att.fileName} (e-mail)`, basis: parsed.basis, lines: parsed.lines });
            await db.insert(supplierInbox).values({
              ...base,
              status: "imported",
              importId: imp.importId,
              priceBasis: parsed.basis,
              rowCount: imp.count,
              reason: `${forwardedBy ? `Transféré par ${forwardedBy} — ` : ""}${imp.matched} article(s) reconnu(s) dans le catalogue`,
            });
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

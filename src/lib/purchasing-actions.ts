"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { supplierInbox, supplierPriceImports, suppliers } from "@/db/schema";
import { getAuth, writeAudit } from "@/lib/auth";
import { importSupplierLines, supplierByName } from "@/lib/purchasing-import";
import { parsePriceFile } from "@/lib/supplier-mail";
import { runMailCheck } from "@/lib/supplier-mail-job";

// Open to every role, including Acheteur.
async function mustAuth() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

const importSchema = z.object({
  supplierId: z.string().uuid().optional(),
  newSupplierName: z.string().trim().max(120).optional(),
  fileName: z.string().trim().min(1).max(255),
  basis: z.enum(["ht", "ttc"]),
  validUntil: z.string().optional(),
  lines: z
    .array(
      z.object({
        ref: z.string().max(120),
        name: z.string().max(500),
        price: z.number().positive().max(10_000_000),
        qty: z.number().int().nullable(),
      }),
    )
    .min(1)
    .max(10_000),
});

export type SaveImportInput = z.infer<typeof importSchema>;

export async function saveSupplierImportAction(input: SaveImportInput): Promise<{ ok: true; count: number; matched: number } | { error: string }> {
  const auth = await mustAuth();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: "Données invalides : vérifiez les colonnes choisies." };
  const data = parsed.data;
  const ws = auth.workspace.id;

  let supplierId = data.supplierId;
  if (supplierId) {
    const own = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.workspaceId, ws))).limit(1);
    if (!own.length) return { error: "Fournisseur introuvable." };
  } else {
    const name = data.newSupplierName?.trim();
    if (!name) return { error: "Choisissez ou saisissez le fournisseur." };
    supplierId = await supplierByName(ws, name);
  }

  const { importId, count, matched } = await importSupplierLines({
    workspaceId: ws,
    userId: auth.user.id,
    supplierId,
    fileName: data.fileName,
    basis: data.basis,
    validUntil: data.validUntil,
    lines: data.lines,
  });
  await writeAudit(auth, "import_supplier_prices", "supplier_price_import", importId, { fileName: data.fileName, rows: count, matched });
  revalidatePath("/purchasing");
  revalidatePath("/suppliers");
  return { ok: true, count, matched };
}

export async function deleteSupplierImportAction(formData: FormData) {
  const auth = await mustAuth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(supplierPriceImports).where(and(eq(supplierPriceImports.id, id), eq(supplierPriceImports.workspaceId, auth.workspace.id)));
  await writeAudit(auth, "delete_supplier_import", "supplier_price_import", id);
  revalidatePath("/purchasing");
  revalidatePath("/suppliers");
}

// ---------- price lists received by e-mail ----------

async function inboxRow(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(supplierInbox).where(and(eq(supplierInbox.id, id), eq(supplierInbox.workspaceId, workspaceId))).limit(1);
  return row ?? null;
}

export type InboxActionState = { ok: boolean; message: string } | null;

/**
 * "Importer" / "Ignorer" on a file waiting in the e-mail list (the clicked button sends op). Same parser
 * and import as the manual upload; the file is claimed first so a double click never imports it twice.
 */
export async function inboxItemAction(_prev: InboxActionState, formData: FormData): Promise<InboxActionState> {
  const auth = await mustAuth();
  const row = await inboxRow(auth.workspace.id, String(formData.get("id") ?? ""));
  if (!row) return { ok: false, message: "Fichier introuvable : rechargez la page." };
  if (formData.get("op") === "ignore") {
    if (row.status === "imported") return { ok: false, message: "Déjà importé." };
    await db.update(supplierInbox).set({ status: "ignored", dataBase64: null }).where(eq(supplierInbox.id, row.id));
    revalidatePath("/purchasing");
    return { ok: true, message: "Ignoré." };
  }
  if (row.status !== "pending" || !row.dataBase64) return { ok: false, message: row.status === "imported" ? "Déjà importé." : "Ce fichier ne peut plus être importé : rechargez la page." };
  const basis = formData.get("basis") === "ttc" ? "ttc" : "ht";
  const chosen = String(formData.get("supplierId") ?? "");
  const newName = String(formData.get("newSupplierName") ?? "").trim().slice(0, 120);
  let supplierId: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(chosen)) {
    const own = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, chosen), eq(suppliers.workspaceId, auth.workspace.id))).limit(1);
    supplierId = own[0]?.id ?? null;
  } else if (newName) supplierId = await supplierByName(auth.workspace.id, newName);
  if (!supplierId) return { ok: false, message: "Choisissez le fournisseur (ou saisissez un nouveau nom) avant d'importer." };
  const [claimed] = await db
    .update(supplierInbox)
    .set({ status: "processing" })
    .where(and(eq(supplierInbox.id, row.id), eq(supplierInbox.status, "pending")))
    .returning({ id: supplierInbox.id });
  if (!claimed) return { ok: false, message: "Import déjà en cours ou terminé : rechargez la page." };
  try {
    const parsed = await parsePriceFile(Buffer.from(row.dataBase64, "base64"), row.attachmentName);
    if (!parsed.lines.length) throw new Error("Aucune ligne de prix reconnue : importez ce fichier avec « Importer une offre fournisseur » pour choisir les colonnes.");
    const imp = await importSupplierLines({ workspaceId: auth.workspace.id, userId: auth.user.id, supplierId, fileName: `${row.attachmentName} (e-mail)`, basis, lines: parsed.lines });
    await db
      .update(supplierInbox)
      .set({ status: "imported", dataBase64: null, supplierId, importId: imp.importId, priceBasis: basis, rowCount: imp.count, reason: `${imp.matched} article(s) reconnu(s) dans le catalogue` })
      .where(eq(supplierInbox.id, row.id));
    await writeAudit(auth, "import_supplier_prices", "supplier_price_import", imp.importId, { fileName: row.attachmentName, rows: imp.count, matched: imp.matched, source: "email" });
    revalidatePath("/purchasing");
    return { ok: true, message: `${imp.count} ligne(s) importée(s), ${imp.matched} reconnue(s) dans le catalogue.` };
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Import impossible.";
    await db.update(supplierInbox).set({ status: "pending", reason: message }).where(eq(supplierInbox.id, row.id));
    revalidatePath("/purchasing");
    return { ok: false, message };
  }
}

/** "Vérifier maintenant": reads the mailbox right away instead of waiting for the 10-minute check. */
export async function checkMailNowAction() {
  await mustAuth();
  await runMailCheck({ force: true, deadline: Date.now() + 45_000 });
  revalidatePath("/purchasing");
}

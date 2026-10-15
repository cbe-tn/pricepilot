"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  competitorOffers,
  competitors,
  discoveredListings,
  notifications,
  productCompetitorUrls,
  products,
  salesRecords,
  stockMovements,
  supplierQuotes,
  suppliers,
  userSettings,
  users,
  watchlistItems,
  workspaces,
} from "@/db/schema";
import {
  canManageWorkspace,
  createResetToken,
  createSession,
  destroySession,
  getAuth,
  hashPassword,
  rateLimitLogin,
  verifyPassword,
  writeAudit,
  consumeResetToken,
} from "@/lib/auth";
import { BUILTIN_CONNECTORS } from "@/lib/connectors";
import { matchListing } from "@/lib/matching";
import { moneyStr, n } from "@/lib/money";
import { runMonitoringJob } from "@/lib/monitoring";
import { fetchLiveOffer } from "@/lib/extract";
import { findByReference, rebuildCatalog, sellerExclusions, type ReferenceSearchResult } from "@/lib/catalog";
import { kickScheduler } from "@/lib/scheduler";
import { parseSpreadsheet } from "@/lib/csv";
import { vatRateFor } from "@/lib/tax";
import { recommendPrice, costFromProduct, taxFromWorkspace } from "@/lib/pricing";
import { pricingRecommendations } from "@/db/schema";

async function mustAuth() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function num(formData: FormData, key: string, fallback = 0): number {
  const v = str(formData, key);
  if (!v) return fallback;
  return n(v.replace(",", "."));
}

export async function loginAction(_prev: unknown, formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "L'e-mail et le mot de passe sont obligatoires." };
  if (!rateLimitLogin(email)) return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "E-mail ou mot de passe incorrect." };
  }
  await createSession(user.id);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1);
  redirect(ws && !ws.onboardingCompleted ? "/onboarding" : "/dashboard");
}

export async function registerAction(_prev: unknown, formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = str(formData, "fullName");
  const workspaceName = str(formData, "workspaceName") || `Boutique de ${fullName}`;
  if (!email || !password || !fullName) return { error: "Le nom, l'e-mail et le mot de passe sont obligatoires." };
  if (password.length < 8) return { error: "Use at least 8 characters." };
  const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (exists.length) return { error: "Un compte existe déjà avec cet e-mail." };
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: workspaceName, city: str(formData, "city") || "Tunis", onboardingCompleted: false, onboardingStep: 1 })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      workspaceId: workspace.id,
      email,
      passwordHash: await hashPassword(password),
      fullName,
      role: "owner",
    })
    .returning();
  await db.insert(userSettings).values({ userId: user.id });
  for (const c of BUILTIN_CONNECTORS) {
    await db.insert(competitors).values({
      workspaceId: workspace.id,
      slug: c.slug,
      name: c.name,
      domain: c.domain,
      websiteUrl: c.websiteUrl,
      logoText: c.logoText,
      listingUrl: c.listingUrl,
      searchUrlTemplate: c.searchUrlTemplate,
      enabled: true,
      connectorStatus: "limited",
      connectorNotes: c.notes,
      isBuiltIn: true,
      isDemo: false,
    });
  }
  await createSession(user.id);
  redirect("/onboarding");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function forgotAction(_prev: unknown, formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  if (!email) return { error: "Email is required." };
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!rows[0]) return { ok: true, message: "Si ce compte existe, un lien de réinitialisation a été créé." };
  const token = await createResetToken(rows[0].id);
  return {
    ok: true,
    message: "Lien de réinitialisation créé. Aucun serveur d'e-mail n'étant configuré, le lien est affiché ci-dessous.",
    demoLink: `/reset-password?token=${token}`,
  };
}

export async function resetAction(_prev: unknown, formData: FormData) {
  const token = str(formData, "token");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  const userId = await consumeResetToken(token);
  if (!userId) return { error: "Ce lien de réinitialisation est invalide ou a expiré." };
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  redirect("/login");
}

export async function updateProfileAction(formData: FormData) {
  const auth = await mustAuth();
  await db
    .update(users)
    .set({
      fullName: str(formData, "fullName") || auth.user.fullName,
      phone: str(formData, "phone") || null,
      jobTitle: str(formData, "jobTitle") || null,
    })
    .where(eq(users.id, auth.user.id));
  await db
    .update(userSettings)
    .set({
      currency: str(formData, "currency") || "TND",
      emailNotifications: formData.get("emailNotifications") === "on",
      inAppNotifications: formData.get("inAppNotifications") === "on",
      browserNotifications: formData.get("browserNotifications") === "on",
      weeklyReportEmail: formData.get("weeklyReportEmail") === "on",
      quietHoursStart: str(formData, "quietHoursStart") || "22:00",
      quietHoursEnd: str(formData, "quietHoursEnd") || "07:00",
      alertPriceDropPct: moneyStr(num(formData, "alertPriceDropPct", 3) / 100),
    })
    .where(eq(userSettings.userId, auth.user.id));
  await writeAudit(auth, "update_profile", "user", auth.user.id);
  revalidatePath("/settings");
}

export async function updateWorkspaceAction(formData: FormData) {
  const auth = await mustAuth();
  if (!canManageWorkspace(auth.user.role)) return;
  await db
    .update(workspaces)
    .set({
      name: str(formData, "name") || auth.workspace.name,
      legalName: str(formData, "legalName") || null,
      city: str(formData, "city") || null,
      phone: str(formData, "phone") || null,
      website: str(formData, "website") || null,
      defaultVatRate: moneyStr(num(formData, "defaultVatRate", 19) / 100),
      purchasePricesIncludeVat: formData.get("purchasePricesIncludeVat") === "on",
      sellingPricesIncludeVat: formData.get("sellingPricesIncludeVat") === "on",
      defaultMinMargin: moneyStr(num(formData, "defaultMinMargin", 3) / 100),
      variableSellingCostRate: moneyStr(num(formData, "variableSellingCostRate", 1.5) / 100),
      monthlyOperatingCosts: moneyStr(num(formData, "monthlyOperatingCosts", 0)),
      lowStockThreshold: Math.round(num(formData, "lowStockThreshold", 3)),
      monitoringIntervalMinutes: Math.round(num(formData, "monitoringIntervalMinutes", 360)),
      dataRetentionDays: Math.round(num(formData, "dataRetentionDays", 365)),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, auth.workspace.id));
  await writeAudit(auth, "update_workspace", "workspace", auth.workspace.id);
  revalidatePath("/settings");
}

export async function inviteStaffAction(formData: FormData) {
  const auth = await mustAuth();
  if (!canManageWorkspace(auth.user.role)) return { error: "Seuls le propriétaire et les administrateurs peuvent ajouter des membres." };
  const email = str(formData, "email").toLowerCase();
  const fullName = str(formData, "fullName");
  const role = str(formData, "role") as "administrator" | "staff";
  const password = String(formData.get("password") ?? "Staff1234!");
  if (!email || !fullName) return { error: "Le nom et l'e-mail sont obligatoires." };
  const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (exists.length) return { error: "Cet e-mail est déjà utilisé." };
  const [u] = await db
    .insert(users)
    .values({
      workspaceId: auth.workspace.id,
      email,
      fullName,
      role: role === "administrator" ? "administrator" : "staff",
      passwordHash: await hashPassword(password),
    })
    .returning();
  await db.insert(userSettings).values({ userId: u.id });
  await writeAudit(auth, "invite_user", "user", u.id, { email, role });
  revalidatePath("/settings");
  return { ok: true };
}

function productValues(formData: FormData, workspaceDefaultVat: number, workspaceMin: number) {
  const tags = str(formData, "tags")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const specsRaw = str(formData, "specifications");
  const specifications: Record<string, string> = {};
  if (specsRaw) {
    for (const line of specsRaw.split("\n")) {
      const [k, ...rest] = line.split(":");
      if (k && rest.length) specifications[k.trim()] = rest.join(":").trim();
    }
  }
  const stockQty = Math.round(num(formData, "stockQty", 0));
  const low = Math.round(num(formData, "lowStockThreshold", 3));
  const stockStatus =
    stockQty <= 0 ? "out_of_stock" : stockQty <= low ? "low_stock" : (str(formData, "stockStatus") as "in_stock") || "in_stock";
  return {
    name: str(formData, "name"),
    brand: str(formData, "brand") || null,
    manufacturer: str(formData, "manufacturer") || str(formData, "brand") || null,
    model: str(formData, "model") || null,
    manufacturerRef: str(formData, "manufacturerRef") || null,
    barcode: str(formData, "barcode") || null,
    sku: str(formData, "sku") || null,
    category: str(formData, "category") || null,
    subcategory: str(formData, "subcategory") || null,
    imageUrl: str(formData, "imageUrl") || null,
    purchasePrice: moneyStr(num(formData, "purchasePrice")),
    purchaseCurrency: str(formData, "purchaseCurrency") || "TND",
    exchangeRate: moneyStr(num(formData, "exchangeRate", 1) || 1),
    shippingCost: moneyStr(num(formData, "shippingCost")),
    importCost: moneyStr(num(formData, "importCost")),
    otherCosts: moneyStr(num(formData, "otherCosts")),
    vatRate: moneyStr(num(formData, "vatRate", workspaceDefaultVat * 100) / 100),
    minProfitMargin: moneyStr(num(formData, "minProfitMargin", workspaceMin * 100) / 100),
    targetSellingPrice: str(formData, "targetSellingPrice") ? moneyStr(num(formData, "targetSellingPrice")) : null,
    actualSellingPrice: str(formData, "actualSellingPrice") ? moneyStr(num(formData, "actualSellingPrice")) : null,
    stockQty,
    stockStatus: stockStatus as "in_stock" | "low_stock" | "out_of_stock" | "on_order" | "discontinued",
    lowStockThreshold: low,
    supplierName: str(formData, "supplierName") || null,
    warranty: str(formData, "warranty") || null,
    condition: str(formData, "condition") || "new",
    description: str(formData, "description") || null,
    specifications,
    notes: str(formData, "notes") || null,
    tags,
    monitoringStatus: (str(formData, "monitoringStatus") as "active" | "paused" | "archived") || "active",
    updatedAt: new Date(),
  };
}

export async function createProductAction(formData: FormData) {
  const auth = await mustAuth();
  const values = productValues(formData, n(auth.workspace.defaultVatRate), n(auth.workspace.defaultMinMargin));
  if (!values.name) return { error: "Le nom du produit est obligatoire." };
  const [p] = await db
    .insert(products)
    .values({ workspaceId: auth.workspace.id, ...values, isDemo: false })
    .returning();
  const urls = str(formData, "competitorUrls")
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
  for (const url of urls) {
    await db.insert(productCompetitorUrls).values({ productId: p.id, url });
  }
  await writeAudit(auth, "create_product", "product", p.id, { name: p.name });
  kickScheduler(); // finds competitor offers by reference in the background
  revalidatePath("/products");
  redirect(`/products/${p.id}`);
}

export async function updateProductAction(formData: FormData) {
  const auth = await mustAuth();
  const id = str(formData, "id");
  const values = productValues(formData, n(auth.workspace.defaultVatRate), n(auth.workspace.defaultMinMargin));
  await db
    .update(products)
    .set({ ...values, lastMatchedAt: null })
    .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)));
  await writeAudit(auth, "update_product", "product", id);
  kickScheduler();
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}

export async function duplicateProductAction(formData: FormData) {
  const auth = await mustAuth();
  const id = str(formData, "id");
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!p) return;
  const { id: _id, createdAt: _c, updatedAt: _u, archivedAt: _a, ...rest } = p;
  const [copy] = await db
    .insert(products)
    .values({ ...rest, name: `${p.name} (copy)`, sku: p.sku ? `${p.sku}-COPY` : null, isDemo: false })
    .returning();
  await writeAudit(auth, "duplicate_product", "product", copy.id);
  revalidatePath("/products");
  redirect(`/products/${copy.id}`);
}

export async function archiveProductAction(formData: FormData) {
  const auth = await mustAuth();
  const id = str(formData, "id");
  await db
    .update(products)
    .set({ archivedAt: new Date(), monitoringStatus: "archived", updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)));
  await writeAudit(auth, "archive_product", "product", id);
  revalidatePath("/products");
}

export async function restoreProductAction(formData: FormData) {
  const auth = await mustAuth();
  const id = str(formData, "id");
  await db
    .update(products)
    .set({ archivedAt: null, monitoringStatus: "active", updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)));
  await writeAudit(auth, "restore_product", "product", id);
  revalidatePath("/products");
}

export async function deleteProductAction(formData: FormData) {
  const auth = await mustAuth();
  if (!canManageWorkspace(auth.user.role)) return;
  const id = str(formData, "id");
  await db.delete(products).where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)));
  await writeAudit(auth, "delete_product", "product", id);
  revalidatePath("/products");
}

export async function bulkProductAction(formData: FormData) {
  const auth = await mustAuth();
  const ids = formData.getAll("ids").map(String);
  const op = str(formData, "op");
  if (!ids.length) return;
  for (const id of ids) {
    if (op === "pause") {
      await db
        .update(products)
        .set({ monitoringStatus: "paused", updatedAt: new Date() })
        .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)));
    } else if (op === "monitor") {
      await db
        .update(products)
        .set({ monitoringStatus: "active", updatedAt: new Date() })
        .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)));
    } else if (op === "archive") {
      await db
        .update(products)
        .set({ archivedAt: new Date(), monitoringStatus: "archived", updatedAt: new Date() })
        .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)));
    }
  }
  await writeAudit(auth, `bulk_${op}`, "product", ids.join(","));
  revalidatePath("/products");
}

// "Clé: valeur" lines (one per line) -> specifications; other lines are ignored.
function parseSpecLines(text: string | undefined): Record<string, string> {
  const specifications: Record<string, string> = {};
  for (const line of (text ?? "").split("\n")) {
    const [k, ...rest] = line.split(":");
    if (k.trim() && rest.join(":").trim()) specifications[k.trim()] = rest.join(":").trim();
  }
  return specifications;
}

function asRate(v: string | undefined): number {
  const x = n(String(v ?? "").replace("%", "").replace(",", "."));
  return x > 1 ? x / 100 : x;
}

export async function importProductsAction(formData: FormData) {
  const auth = await mustAuth();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez un fichier CSV ou Excel." };
  const buf = Buffer.from(await file.arrayBuffer());
  const rows = parseSpreadsheet(buf);

  // Re-importing a list (or a stock file) updates the products we already have instead of duplicating
  // them: same manufacturer reference, barcode or SKU (case-insensitive).
  const existing = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)));
  const keyOf = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byKey = new Map<string, (typeof existing)[number]>();
  for (const p of existing.sort((a, b) => +a.createdAt - +b.createdAt)) {
    for (const k of [p.manufacturerRef, p.barcode, p.sku].map(keyOf)) if (k.length >= 3 && !byKey.has(k)) byKey.set(k, p);
  }

  let count = 0;
  let updated = 0;
  for (const row of rows) {
    const name = row.name || row.Name;
    if (!name) continue;
    const ref = row.manufacturerRef || row.reference || null;
    const barcode = row.barcode || row.ean || null;
    const match = [ref, barcode, row.sku].map(keyOf).find((k) => k.length >= 3 && byKey.has(k));
    const current = match ? byKey.get(match)! : null;
    if (current) {
      // Only overwrite what the file actually provides, so a "Réf + Qté" stock list keeps prices intact.
      const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
      if (row.purchasePrice) set.purchasePrice = moneyStr(n(row.purchasePrice));
      if (row.actualSellingPrice) set.actualSellingPrice = moneyStr(n(row.actualSellingPrice));
      if (row.targetSellingPrice) set.targetSellingPrice = moneyStr(n(row.targetSellingPrice));
      if (row.stockQty !== undefined && row.stockQty !== "") set.stockQty = Math.round(n(row.stockQty));
      if (row.vatRate) set.vatRate = moneyStr(asRate(row.vatRate));
      if (row.minProfitMargin) set.minProfitMargin = moneyStr(asRate(row.minProfitMargin));
      if (row.brand && !current.brand) set.brand = row.brand;
      if (row.model && !current.model) set.model = row.model;
      if (barcode && !current.barcode) set.barcode = barcode;
      if (row.category && !current.category) set.category = row.category;
      if (row.supplierName) set.supplierName = row.supplierName;
      if (row.description && !current.description) {
        set.description = row.description;
        set.specifications = parseSpecLines(row.description);
      }
      await db.update(products).set(set).where(eq(products.id, current.id));
      updated += 1;
      continue;
    }
    const [created] = await db.insert(products).values({
      workspaceId: auth.workspace.id,
      name,
      brand: row.brand || null,
      manufacturer: row.manufacturer || row.brand || null,
      model: row.model || null,
      manufacturerRef: ref,
      barcode,
      sku: row.sku || null,
      category: row.category || null,
      subcategory: row.subcategory || null,
      purchasePrice: moneyStr(n(row.purchasePrice)),
      purchaseCurrency: row.purchaseCurrency || "TND",
      exchangeRate: moneyStr(n(row.exchangeRate) || 1),
      shippingCost: moneyStr(n(row.shippingCost)),
      importCost: moneyStr(n(row.importCost)),
      otherCosts: moneyStr(n(row.otherCosts)),
      // Accept both 0.19 and 19 (percent) in spreadsheets; otherwise 7 % for IT equipment, 19 % for the rest.
      vatRate: moneyStr(asRate(row.vatRate) || vatRateFor({ name, category: row.category, subcategory: row.subcategory })),
      minProfitMargin: moneyStr(asRate(row.minProfitMargin) || n(auth.workspace.defaultMinMargin)),
      targetSellingPrice: row.targetSellingPrice ? moneyStr(n(row.targetSellingPrice)) : null,
      actualSellingPrice: row.actualSellingPrice ? moneyStr(n(row.actualSellingPrice)) : null,
      stockQty: Math.round(n(row.stockQty)),
      supplierName: row.supplierName || null,
      warranty: row.warranty || null,
      condition: row.condition || "new",
      description: row.description || null,
      specifications: parseSpecLines(row.description),
      tags: (row.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      isDemo: false,
    }).returning();
    for (const k of [created.manufacturerRef, created.barcode, created.sku].map(keyOf)) if (k.length >= 3 && !byKey.has(k)) byKey.set(k, created);
    count += 1;
  }
  await writeAudit(auth, "import_products", "product", undefined, { count, updated });
  kickScheduler(); // imported products are matched on competitors in the background
  revalidatePath("/products");
  revalidatePath("/stock");
  return { ok: true, count, updated };
}

export async function addManualOfferAction(formData: FormData) {
  const auth = await mustAuth();
  const productId = str(formData, "productId");
  const competitorId = str(formData, "competitorId");
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!product) return { error: "Produit introuvable." };
  const url = str(formData, "url");
  let livePrice: number | null = null;
  let liveTitle: string | null = null;
  let liveAvailability: string | null = null;
  let liveImage: string | null = null;
  let liveSeller: string | null = null;
  if (url) {
    const live = await fetchLiveOffer(url, { excludeSellers: await sellerExclusions(auth.workspace.id) });
    if (live.ok) {
      livePrice = live.offer.priceTnd;
      liveTitle = live.offer.title;
      liveAvailability = live.offer.availability === "unknown" ? null : live.offer.availability;
      liveImage = live.offer.imageUrl;
      liveSeller = live.offer.seller ?? null;
    } else if (!str(formData, "priceTnd")) {
      return { error: `Impossible de lire le prix en direct : ${live.error}. Saisissez le prix manuellement.` };
    }
  }
  const priceTnd = livePrice ?? num(formData, "priceTnd");
  if (!(priceTnd > 0)) return { error: "Saisissez un prix ou l'URL d'un produit concurrent." };
  const title = str(formData, "title") || liveTitle || product.name;
  const match = matchListing({
    productName: product.name,
    brand: product.brand,
    model: product.model,
    manufacturerRef: product.manufacturerRef,
    barcode: product.barcode,
    specifications: product.specifications,
    listingTitle: title,
    listingBrand: str(formData, "brand") || product.brand,
    listingModel: str(formData, "model") || product.model,
    listingRef: str(formData, "manufacturerRef") || product.manufacturerRef,
    listingBarcode: str(formData, "barcode") || product.barcode,
    listingCondition: str(formData, "condition") || "new",
  });
  await db.insert(competitorOffers).values({
    workspaceId: auth.workspace.id,
    productId,
    competitorId,
    title,
    brand: str(formData, "brand") || product.brand,
    model: str(formData, "model") || product.model,
    manufacturerRef: str(formData, "manufacturerRef") || product.manufacturerRef,
    barcode: str(formData, "barcode") || product.barcode,
    url: url || null,
    imageUrl: liveImage,
    sellerName: liveSeller,
    priceTnd: moneyStr(priceTnd),
    availability: ((liveAvailability ?? str(formData, "availability")) as "in_stock") || "in_stock",
    condition: (str(formData, "condition") as "new") || "new",
    matchClass: match.matchClass,
    matchConfidence: match.confidence,
    matchReason: match.reason,
    excludedFromBenchmark: match.excluded,
    isDemo: false,
  });
  revalidatePath(`/products/${productId}`);
  revalidatePath("/benchmarking");
  return { ok: true, live: livePrice != null, priceTnd };
}

export async function reviewMatchAction(formData: FormData) {
  const auth = await mustAuth();
  const offerId = str(formData, "offerId");
  const decision = str(formData, "decision");
  const productId = str(formData, "productId");
  if (decision === "confirm") {
    await db
      .update(competitorOffers)
      .set({ matchClass: "exact", matchConfidence: 100, matchReason: "Confirmée par l'utilisateur", excludedFromBenchmark: false, userReview: "confirm", productId })
      .where(and(eq(competitorOffers.id, offerId), eq(competitorOffers.workspaceId, auth.workspace.id)));
  } else if (decision === "reject") {
    await db
      .update(competitorOffers)
      .set({ excludedFromBenchmark: true, userReview: "reject", matchReason: "Rejetée par l'utilisateur", productId })
      .where(and(eq(competitorOffers.id, offerId), eq(competitorOffers.workspaceId, auth.workspace.id)));
  } else if (decision === "link") {
    await db
      .update(competitorOffers)
      .set({ productId, userReview: "link", matchClass: "exact", matchConfidence: 100, excludedFromBenchmark: false, matchReason: "Liée manuellement" })
      .where(and(eq(competitorOffers.id, offerId), eq(competitorOffers.workspaceId, auth.workspace.id)));
  }
  revalidatePath("/benchmarking");
  if (productId) revalidatePath(`/products/${productId}`);
}

export async function saveRecommendationAction(formData: FormData) {
  const auth = await mustAuth();
  const productId = str(formData, "productId");
  const strategy = (str(formData, "strategy") as "competitive" | "balanced" | "premium") || "balanced";
  const price = num(formData, "recommendedPrice");
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!product) return;
  const offers = await db.select().from(competitorOffers).where(eq(competitorOffers.productId, productId));
  const rec = recommendPrice({
    cost: costFromProduct(product),
    tax: taxFromWorkspace(auth.workspace, product.vatRate),
    minMargin: n(product.minProfitMargin),
    currentSellingTtc: n(product.actualSellingPrice),
    targetSellingTtc: n(product.targetSellingPrice),
    offers: offers.map((o) => ({
      priceTnd: n(o.priceTnd),
      availability: o.availability,
      matchClass: o.matchClass,
      excludedFromBenchmark: o.excludedFromBenchmark,
      condition: o.condition,
    })),
    strategy,
  });
  await db.insert(pricingRecommendations).values({
    workspaceId: auth.workspace.id,
    productId,
    strategy,
    recommendedPrice: moneyStr(price || rec.recommendedTtc),
    expectedProfit: moneyStr(rec.breakdown.grossProfit),
    expectedMargin: moneyStr(rec.breakdown.grossMargin),
    explanation: rec.explanation,
    confidence: rec.confidence,
    flaggedLoss: rec.flaggedLoss,
    isDemo: product.isDemo,
  });
  if (formData.get("applyTarget") === "on") {
    await db
      .update(products)
      .set({ targetSellingPrice: moneyStr(price || rec.recommendedTtc), savedStrategy: strategy, updatedAt: new Date() })
      .where(eq(products.id, productId));
  } else {
    await db.update(products).set({ savedStrategy: strategy, updatedAt: new Date() }).where(eq(products.id, productId));
  }
  await writeAudit(auth, "save_recommendation", "product", productId, { strategy, price });
  revalidatePath(`/products/${productId}`);
  revalidatePath("/recommendations");
}

export async function runCheckNowAction(formData: FormData) {
  const auth = await mustAuth();
  const competitorId = str(formData, "competitorId") || undefined;
  await runMonitoringJob(auth, { competitorId, trigger: "manual" });
  revalidatePath("/competitors");
  revalidatePath("/dashboard");
  revalidatePath("/history");
}

export async function upsertCompetitorAction(formData: FormData) {
  const auth = await mustAuth();
  if (!canManageWorkspace(auth.user.role)) return;
  const id = str(formData, "id");
  const values = {
    name: str(formData, "name"),
    domain: str(formData, "domain"),
    websiteUrl: str(formData, "websiteUrl"),
    listingUrl: str(formData, "listingUrl") || null,
    searchUrlTemplate: str(formData, "searchUrlTemplate") || null,
    logoText: str(formData, "logoText") || str(formData, "name").slice(0, 2).toUpperCase(),
    monitoringFrequencyMinutes: Math.round(num(formData, "monitoringFrequencyMinutes", 360)),
    connectorNotes: str(formData, "connectorNotes") || "Suivi par URL ou import, en attendant une source automatique autorisée.",
    connectorStatus: "limited" as const,
    enabled: formData.get("enabled") !== "off",
  };
  if (id) {
    await db
      .update(competitors)
      .set(values)
      .where(and(eq(competitors.id, id), eq(competitors.workspaceId, auth.workspace.id)));
  } else {
    await db.insert(competitors).values({
      workspaceId: auth.workspace.id,
      slug: values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      ...values,
      isBuiltIn: false,
      isDemo: false,
    });
  }
  revalidatePath("/competitors");
}

export async function toggleCompetitorAction(formData: FormData) {
  const auth = await mustAuth();
  const id = str(formData, "id");
  const enabled = str(formData, "enabled") === "true";
  await db
    .update(competitors)
    .set({ enabled })
    .where(and(eq(competitors.id, id), eq(competitors.workspaceId, auth.workspace.id)));
  revalidatePath("/competitors");
}

export async function deleteCompetitorAction(formData: FormData) {
  const auth = await mustAuth();
  if (!canManageWorkspace(auth.user.role)) return;
  const id = str(formData, "id");
  const [c] = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.id, id), eq(competitors.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!c || c.isBuiltIn) return;
  await db.delete(competitors).where(eq(competitors.id, id));
  revalidatePath("/competitors");
}

export async function discoveryAction(formData: FormData) {
  const auth = await mustAuth();
  const id = str(formData, "id");
  const op = str(formData, "op");
  const [row] = await db
    .select()
    .from(discoveredListings)
    .where(and(eq(discoveredListings.id, id), eq(discoveredListings.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!row) return;
  if (op === "ignore") {
    await db.update(discoveredListings).set({ status: "ignored" }).where(eq(discoveredListings.id, id));
  } else if (op === "watch") {
    await db.update(discoveredListings).set({ status: "watchlist" }).where(eq(discoveredListings.id, id));
    await db.insert(watchlistItems).values({ workspaceId: auth.workspace.id, listingId: id, note: "Watchlist" });
  } else if (op === "add") {
    const [p] = await db
      .insert(products)
      .values({
        workspaceId: auth.workspace.id,
        name: row.title,
        brand: row.brand,
        manufacturerRef: row.manufacturerRef,
        category: row.category,
        actualSellingPrice: row.priceTnd,
        targetSellingPrice: row.priceTnd,
        isDemo: false,
        notes: `Ajouté depuis les nouveautés concurrents. URL source : ${row.url ?? ""}`,
      })
      .returning();
    await db.update(discoveredListings).set({ status: "added", alreadyInCatalog: true, matchedProductId: p.id }).where(eq(discoveredListings.id, id));
    revalidatePath("/products");
    redirect(`/products/${p.id}`);
  }
  revalidatePath("/discovery");
}

export async function upsertSupplierAction(formData: FormData) {
  const auth = await mustAuth();
  const id = str(formData, "id");
  const values = {
    name: str(formData, "name"),
    contactName: str(formData, "contactName") || null,
    email: str(formData, "email") || null,
    phone: str(formData, "phone") || null,
    city: str(formData, "city") || null,
    notes: str(formData, "notes") || null,
  };
  if (!values.name) return;
  if (id) {
    await db.update(suppliers).set(values).where(and(eq(suppliers.id, id), eq(suppliers.workspaceId, auth.workspace.id)));
  } else {
    await db.insert(suppliers).values({ workspaceId: auth.workspace.id, ...values });
  }
  revalidatePath("/suppliers");
}

export async function addQuoteAction(formData: FormData) {
  const auth = await mustAuth();
  await db.insert(supplierQuotes).values({
    workspaceId: auth.workspace.id,
    supplierId: str(formData, "supplierId"),
    productId: str(formData, "productId") || null,
    productRef: str(formData, "productRef") || null,
    productName: str(formData, "productName") || null,
    quotedPrice: moneyStr(num(formData, "quotedPrice")),
    moq: Math.round(num(formData, "moq", 1)),
    leadTimeDays: Math.round(num(formData, "leadTimeDays", 3)),
    shippingCost: moneyStr(num(formData, "shippingCost")),
    availability: str(formData, "availability") || "in_stock",
    expiresAt: str(formData, "expiresAt") ? new Date(str(formData, "expiresAt")) : null,
  });
  revalidatePath("/suppliers");
}

export async function addMovementAction(formData: FormData) {
  const auth = await mustAuth();
  const productId = str(formData, "productId");
  const type = str(formData, "type") as "purchase" | "sale" | "return" | "adjustment" | "replenishment";
  const quantity = Math.round(num(formData, "quantity"));
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!p) return;
  const signed = type === "sale" ? -Math.abs(quantity) : type === "return" ? Math.abs(quantity) : quantity;
  const nextQty = p.stockQty + signed;
  await db.insert(stockMovements).values({
    workspaceId: auth.workspace.id,
    productId,
    type,
    quantity: signed,
    unitCost: str(formData, "unitCost") ? moneyStr(num(formData, "unitCost")) : p.purchasePrice,
    note: str(formData, "note") || null,
  });
  if (type === "sale") {
    await db.insert(salesRecords).values({
      workspaceId: auth.workspace.id,
      productId,
      quantity: Math.abs(quantity),
      unitPrice: moneyStr(num(formData, "unitPrice", n(p.actualSellingPrice))),
      channel: str(formData, "channel") || "store",
    });
  }
  const stockStatus = nextQty <= 0 ? "out_of_stock" : nextQty <= p.lowStockThreshold ? "low_stock" : "in_stock";
  await db.update(products).set({ stockQty: nextQty, stockStatus, updatedAt: new Date() }).where(eq(products.id, productId));
  revalidatePath("/inventory");
  revalidatePath(`/products/${productId}`);
}

export async function markNotificationsAction(formData: FormData) {
  const auth = await mustAuth();
  const ids = formData.getAll("ids").map(String);
  const all = str(formData, "all") === "true";
  if (all) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.workspaceId, auth.workspace.id), eq(notifications.userId, auth.user.id)));
  } else {
    for (const id of ids) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.workspaceId, auth.workspace.id)));
    }
  }
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}

export async function completeOnboardingAction(formData: FormData) {
  const auth = await mustAuth();
  const step = Math.round(num(formData, "step", 7));
  await db
    .update(workspaces)
    .set({
      onboardingStep: step,
      onboardingCompleted: step >= 7,
      defaultMinMargin: str(formData, "defaultMinMargin")
        ? moneyStr(num(formData, "defaultMinMargin") / 100)
        : auth.workspace.defaultMinMargin,
      name: str(formData, "name") || auth.workspace.name,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, auth.workspace.id));
  revalidatePath("/onboarding");
  if (step >= 7) redirect("/dashboard");
}

export async function searchProductsAction(query: string) {
  const auth = await getAuth();
  if (!auth) return [];
  const q = `%${query}%`;
  const rows = await db
    .select({ id: products.id, name: products.name, sku: products.sku, brand: products.brand })
    .from(products)
    .where(
      and(
        eq(products.workspaceId, auth.workspace.id),
        or(ilike(products.name, q), ilike(products.sku, q), ilike(products.barcode, q), ilike(products.manufacturerRef, q)),
      ),
    )
    .limit(8);
  return rows;
}

export async function findOnCompetitorsAction(productId: string, reference: string): Promise<ReferenceSearchResult | { error: string }> {
  const auth = await mustAuth();
  const ref = reference.trim();
  if (ref.length < 2) return { error: "Saisissez une référence, un modèle ou un nom de produit." };
  try {
    return await findByReference(auth, { reference: ref, productId });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "La recherche a échoué" };
  }
}

export async function refreshCatalogsAction() {
  const auth = await mustAuth();
  const sources = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.workspaceId, auth.workspace.id), eq(competitors.enabled, true)));
  const sizes = await Promise.all(sources.map(async (s) => ({ name: s.name, ...(await rebuildCatalog(s)) })));
  revalidatePath("/competitors");
  return { sizes };
}

// Queues every active product for an automatic competitor search; the background worker does the work.
export async function autoMatchProductsAction() {
  const auth = await mustAuth();
  const queued = await db
    .update(products)
    .set({ lastMatchedAt: null })
    .where(and(eq(products.workspaceId, auth.workspace.id), isNull(products.archivedAt)))
    .returning({ id: products.id });
  kickScheduler();
  return { queued: queued.length };
}

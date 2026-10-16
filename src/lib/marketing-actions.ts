"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { marketingCampaigns, products } from "@/db/schema";
import { getAuth, writeAudit } from "@/lib/auth";
import { loadPosterProducts, officialPhotoUrl } from "@/lib/marketing";
import { BRAND_COLORS, checkPoster, defaultDesign, MAX_POSTER_PRODUCTS, normalizeDesign, THEMES, type PosterCheck, type PosterDesign, type PosterProduct } from "@/lib/poster";

const MAX_VERSIONS = 15;

async function mustAuth() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

const text = (max: number) => z.string().max(max);
const layout = z.object({ dx: z.number().min(-1080).max(1080), dy: z.number().min(-1080).max(1080), scale: z.number().min(0.4).max(2) });
const designSchema = z.object({
  brand: z.enum(["numedia", "cbe"]),
  lang: z.enum(["fr", "ar", "bi"]),
  theme: z.enum(THEMES.map((t) => t.value) as [PosterDesign["theme"], ...PosterDesign["theme"][]]),
  accent: z.enum(BRAND_COLORS.map((c) => c.value) as [string, ...string[]]),
  title: text(80),
  titleAr: text(80),
  subtitle: text(140),
  subtitleAr: text(140),
  tag: text(24),
  tagAr: text(24),
  benefits: z.array(text(40)).max(3),
  benefitsAr: z.array(text(40)).max(3),
  cta: text(60),
  ctaAr: text(60),
  footer: text(120),
  validUntil: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  promoPrice: z.number().positive().max(10_000_000).nullable(),
  showOldPrice: z.boolean(),
  showDiscount: z.boolean(),
  productOrder: z.array(z.string().uuid()).max(MAX_POSTER_PRODUCTS),
  layout: z.object({ title: layout, products: layout, price: layout, benefits: layout }),
});

async function ownCampaign(workspaceId: string, id: string) {
  const [c] = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.workspaceId, workspaceId)))
    .limit(1);
  return c ?? null;
}

export async function createCampaignAction(formData: FormData) {
  const auth = await mustAuth();
  const ids = [...new Set(formData.getAll("productIds").map(String))].slice(0, MAX_POSTER_PRODUCTS);
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const brand = formData.get("brand") === "cbe" ? "cbe" : "numedia";
  const lang = (["fr", "ar", "bi"].includes(String(formData.get("lang"))) ? formData.get("lang") : "fr") as PosterDesign["lang"];
  if (!ids.length || !name) return;
  const owned = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.workspaceId, auth.workspace.id), inArray(products.id, ids)));
  const valid = ids.filter((id) => owned.some((o) => o.id === id));
  if (!valid.length) return;
  const facts = await loadPosterProducts(auth.workspace.id, valid);
  const design = defaultDesign(facts, { brand, lang, website: auth.workspace.website, phone: auth.workspace.phone });
  const [created] = await db
    .insert(marketingCampaigns)
    .values({ workspaceId: auth.workspace.id, createdBy: auth.user.id, name, productIds: valid, design })
    .returning({ id: marketingCampaigns.id });
  await writeAudit(auth, "create_campaign", "marketing_campaign", created.id, { products: valid.length });
  redirect(`/marketing/${created.id}`);
}

type Version = { at: string; design: PosterDesign };
type SaveResult = { ok: true; versions: Version[] } | { ok: false; error: string };

export async function saveCampaignAction(id: string, raw: unknown, name?: string): Promise<SaveResult> {
  const auth = await mustAuth();
  const campaign = await ownCampaign(auth.workspace.id, id);
  if (!campaign) return { ok: false, error: "Campagne introuvable." };
  const parsed = designSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Affiche invalide : " + parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
  // The product list is fixed at creation; the design can only reorder it.
  const design = { ...parsed.data, productOrder: parsed.data.productOrder.filter((p) => campaign.productIds.includes(p)) };
  const unchanged = JSON.stringify(campaign.design) === JSON.stringify(design) && (!name || name === campaign.name);
  if (unchanged) return { ok: true, versions: campaign.versions as Version[] };
  const versions = [{ at: campaign.updatedAt.toISOString(), design: campaign.design }, ...campaign.versions].slice(0, MAX_VERSIONS);
  await db
    .update(marketingCampaigns)
    .set({ design, versions, name: name?.trim().slice(0, 100) || campaign.name, status: "draft", validatedAt: null, updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, id));
  revalidatePath("/marketing");
  return { ok: true, versions: versions as Version[] };
}

type ValidateResult = { ok: boolean; check: PosterCheck; products: PosterProduct[]; error?: string };

/** Saves, re-reads the catalogue (prices may have changed) and marks the poster exportable if every rule passes. */
export async function validateCampaignAction(id: string, raw: unknown, name?: string): Promise<ValidateResult> {
  const auth = await mustAuth();
  const saved = await saveCampaignAction(id, raw, name);
  const campaign = await ownCampaign(auth.workspace.id, id);
  if (!saved.ok || !campaign) {
    return { ok: false, error: saved.ok ? "Campagne introuvable." : saved.error, check: { errors: [], warnings: [], pricing: { price: null, oldPrice: null, discountPct: null, floor: null, marginPct: null } }, products: [] };
  }
  const facts = await loadPosterProducts(auth.workspace.id, campaign.productIds);
  const design = normalizeDesign(campaign.design as Partial<PosterDesign>, facts);
  const check = checkPoster(design, facts);
  if (facts.length !== campaign.productIds.length) check.errors.push("Un produit de la campagne n'existe plus dans le catalogue.");
  // A confirmed numedia.tn listing can still have no photo: check the official photo really exists.
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, auth.workspace.id), inArray(products.id, campaign.productIds)));
  for (const p of rows) {
    if (facts.find((f) => f.id === p.id)?.hasPhoto && !(await officialPhotoUrl(p))) {
      check.errors.push(`${p.name} : aucune photo officielle sur numedia.tn.`);
    }
  }
  const ok = check.errors.length === 0;
  if (ok) {
    await db.update(marketingCampaigns).set({ status: "validated", validatedAt: new Date() }).where(eq(marketingCampaigns.id, id));
    await writeAudit(auth, "validate_campaign", "marketing_campaign", id, { price: check.pricing.price, oldPrice: check.pricing.oldPrice });
  }
  revalidatePath("/marketing");
  return { ok, check, products: facts };
}

export async function duplicateCampaignAction(formData: FormData) {
  const auth = await mustAuth();
  const campaign = await ownCampaign(auth.workspace.id, String(formData.get("id") ?? ""));
  if (!campaign) return;
  const [copy] = await db
    .insert(marketingCampaigns)
    .values({ workspaceId: auth.workspace.id, createdBy: auth.user.id, name: `${campaign.name} (copie)`.slice(0, 100), productIds: campaign.productIds, design: campaign.design })
    .returning({ id: marketingCampaigns.id });
  redirect(`/marketing/${copy.id}`);
}

export async function deleteCampaignAction(formData: FormData) {
  const auth = await mustAuth();
  const id = String(formData.get("id") ?? "");
  const campaign = await ownCampaign(auth.workspace.id, id);
  if (!campaign) return;
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  await writeAudit(auth, "delete_campaign", "marketing_campaign", id, { name: campaign.name });
  revalidatePath("/marketing");
}

/** "Remplacer par la photo officielle": forgets the stored photo and reads it again from numedia.tn. */
export async function refreshPhotoAction(productId: string): Promise<{ ok: boolean }> {
  const auth = await mustAuth();
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!product) return { ok: false };
  await db.update(products).set({ imageUrl: null }).where(eq(products.id, product.id));
  return { ok: Boolean(await officialPhotoUrl({ ...product, imageUrl: null })) };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { marketingAssets, marketingCampaigns, products } from "@/db/schema";
import { getAuth, writeAudit } from "@/lib/auth";
import { loadPosterProducts, officialPhotoUrl } from "@/lib/marketing";
import { defaultSceneQuery, TN_EVENTS } from "@/lib/events";
import { AI_SCENES_PER_DAY, AMBIANCES, aiScenesConfigured, buildScenePrompt, generateSceneImage } from "@/lib/ai-scenes";
import { SCENE_URL } from "@/lib/scenes";
import { applyEvent, BRAND_COLORS, checkPoster, defaultDesign, MAX_POSTER_PRODUCTS, normalizeDesign, THEMES, type PosterCheck, type PosterDesign, type PosterProduct, type PosterScene } from "@/lib/poster";

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
  reflection: z.boolean(),
  event: z.union([z.literal(""), z.enum(TN_EVENTS.map((e) => e.id) as [string, ...string[]])]),
  // Scene photos come only from the CC0 StockSnap CDN (served through our image proxy).
  scene: z
    .object({
      url: z.string().regex(SCENE_URL),
      thumb: z.string().regex(SCENE_URL),
      title: text(200),
      creator: text(200),
      landing: z.string().max(500),
    })
    .nullable(),
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
  const base = defaultDesign(facts, { brand, lang, website: auth.workspace.website, phone: auth.workspace.phone });
  const event = String(formData.get("event") ?? "");
  const design = TN_EVENTS.some((e) => e.id === event) ? applyEvent(base, event, facts) : base;
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

type GenerateResult = { ok: true; scene: PosterScene; left: number } | { ok: false; error: string };

/**
 * Generates an empty, product-free background with the free Cloudflare AI tier and stores it for the
 * campaign. Only the ambiance, the event mood and optional details are sent — never prices or names.
 */
export async function generateSceneAction(campaignId: string, ambianceId: string, details: string): Promise<GenerateResult> {
  const auth = await mustAuth();
  const campaign = await ownCampaign(auth.workspace.id, campaignId);
  if (!campaign) return { ok: false, error: "Campagne introuvable." };
  if (!aiScenesConfigured()) return { ok: false, error: "Génération IA gratuite non configurée : ajoutez CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_AI_TOKEN sur Vercel." };
  if (!AMBIANCES.some((a) => a.id === ambianceId)) return { ok: false, error: "Ambiance inconnue." };
  const since = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const [{ used }] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(marketingAssets)
    .where(and(eq(marketingAssets.workspaceId, auth.workspace.id), gte(marketingAssets.createdAt, since)));
  if (used >= AI_SCENES_PER_DAY) return { ok: false, error: `Limite de ${AI_SCENES_PER_DAY} scènes IA par jour atteinte — réessayez demain.` };

  const facts = await loadPosterProducts(auth.workspace.id, campaign.productIds);
  const design = campaign.design as Partial<PosterDesign>;
  const prompt = buildScenePrompt({ ambianceId, sceneQuery: defaultSceneQuery(facts), eventId: design.event, details: String(details ?? "") });
  const gen = await generateSceneImage(prompt);
  if (!gen.ok) return gen;
  const [asset] = await db
    .insert(marketingAssets)
    .values({ workspaceId: auth.workspace.id, campaignId: campaign.id, prompt, mime: gen.mime, dataBase64: gen.bytes.toString("base64") })
    .returning({ id: marketingAssets.id });
  await writeAudit(auth, "generate_scene", "marketing_campaign", campaign.id, { ambiance: ambianceId });
  const url = `/api/marketing/image?asset=${asset.id}`;
  const label = AMBIANCES.find((a) => a.id === ambianceId)?.label ?? "Scène IA";
  return { ok: true, left: AI_SCENES_PER_DAY - used - 1, scene: { url, thumb: url, title: label, creator: "Image générée par IA (FLUX.1 schnell, Cloudflare)", landing: "" } };
}

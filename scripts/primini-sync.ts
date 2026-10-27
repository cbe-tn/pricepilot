// Primini sync — run on an office PC (Primini refuses the hosted app's servers):
//   DATABASE_URL=... bun scripts/primini-sync.ts
// For every catalogue product, imports only the selected shops' Primini prices. Prefer a verified
// seller product page and its live price; when unavailable, link to that seller's site, never Primini.
// Incremental and resumable: the scheduled task runs it every hour; each run only handles products
// never synced or synced more than REFRESH_MS ago (state kept on this PC), so newly imported products
// are picked up automatically and an interrupted run continues where it stopped.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { competitorOffers, competitors, priceObservations, products, userSettings, users, workspaces, type Competitor, type Product } from "@/db/schema";
import { autoMatchProduct, catalogStatus, handledByOfficePc, rebuildCatalog, searchCatalog, searchTermsForProduct } from "@/lib/catalog";
import { runMonitoringJob } from "@/lib/monitoring";
import { compactText, fetchLiveOffer, type Availability } from "@/lib/extract";
import { isCompatibleListing } from "@/lib/matching";
import { moneyStr, n } from "@/lib/money";
import type { AuthContext } from "@/lib/auth";
import { isSelectedCompetitor } from "@/lib/connectors";
import { deriveIdentity } from "@/lib/identity";

const SOURCE_SLUG = "primini-source";
const CATALOG_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
const REFRESH_MS = 20 * 3600 * 1000;
const LOCK_MAX_AGE_MS = 8 * 3600 * 1000;

const stateDir = join(process.env.LOCALAPPDATA ?? ".", "PricePilot");
mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, "primini-state.json");
const lockFile = join(stateDir, "primini-sync.lock");

// One run at a time: an hourly start while a long pass is still running exits immediately.
if (existsSync(lockFile)) {
  const lock = JSON.parse(readFileSync(lockFile, "utf8") || "{}") as { pid?: number; at?: number };
  let alive = false;
  try {
    if (lock.pid) process.kill(lock.pid, 0);
    alive = Boolean(lock.pid);
  } catch {
    alive = false;
  }
  if (alive && lock.at && Date.now() - lock.at < LOCK_MAX_AGE_MS) {
    console.log(`Synchronisation déjà en cours (pid ${lock.pid}) : rien à faire.`);
    process.exit(0);
  }
}
writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
process.on("exit", () => {
  try {
    unlinkSync(lockFile);
  } catch {}
});

/** productId -> last successful sync (ms). Survives interrupted runs. */
const synced: Record<string, number> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8") || "{}") : {};
const saveState = () => writeFileSync(stateFile, JSON.stringify(synced));

const [ws] = await db.select().from(workspaces).limit(1);
if (!ws) throw new Error("Aucun espace de travail");

const list = await db.select().from(products).where(and(eq(products.workspaceId, ws.id), isNull(products.archivedAt)));
// Shop indexes (our numedia.tn shop and the selected shops) are refreshed here: on Vercel a rebuild does
// not fit in one run, so the hosted app keeps using the old index until this task renews it.
{
  const shops = (await db.select().from(competitors).where(eq(competitors.workspaceId, ws.id))).filter((c) => c.isOwnShop || (c.enabled && isSelectedCompetitor(c)));
  const states = await catalogStatus(shops.map((c) => c.id));
  for (const shop of shops) {
    const st = states.get(shop.id);
    if (st?.size && st.indexedAt && Date.now() - st.indexedAt.getTime() < CATALOG_MAX_AGE_MS) continue;
    try {
      console.log(`Index ${shop.name} :`, (await rebuildCatalog(shop)).size, "pages");
    } catch (e) {
      console.log(`Index ${shop.name} : échec (${e instanceof Error ? e.message : e})`);
    }
  }
}

// Shops that refuse the hosted app (Mytek, Graiet…): the hosted app no longer checks them, so their tracked
// prices (read on their own product pages) are refreshed from this PC on every run.
{
  const [owner] = await db.select().from(users).where(eq(users.workspaceId, ws.id)).limit(1);
  const [ownerSettings] = owner ? await db.select().from(userSettings).where(eq(userSettings.userId, owner.id)).limit(1) : [];
  if (owner && ownerSettings) {
    const pcAuth: AuthContext = { user: owner, workspace: ws, settings: ownerSettings };
    const pcShops = (await db.select().from(competitors).where(eq(competitors.workspaceId, ws.id))).filter((c) => c.enabled && isSelectedCompetitor(c) && handledByOfficePc(c));
    for (const shop of pcShops) {
      try {
        const r = await runMonitoringJob(pcAuth, { competitorId: shop.id, trigger: "office-pc", deadline: Date.now() + 8 * 60_000 });
        console.log(`Prix ${shop.name} mis à jour depuis le PC : ${r.checked} vérifié(s), ${r.changes} changement(s)${r.hadError ? " (quelques pages illisibles, ancien prix gardé)" : ""}`);
      } catch (e) {
        console.log(`Prix ${shop.name} : échec (${e instanceof Error ? e.message : e})`);
      }
    }
  }
}

// Never-synced products first (a fresh stock import), then the oldest.
const due = list.filter((p) => !synced[p.id] || Date.now() - synced[p.id] > REFRESH_MS).sort((a, b) => (synced[a.id] ?? 0) - (synced[b.id] ?? 0));
if (!due.length) {
  console.log(`Rien à synchroniser : ${list.length} produits déjà à jour.`);
  await pool.end();
  process.exit(0);
}

// Hidden source: holds Primini's catalogue index only; disabled, never searched by the hosted app, no offers.
let [source] = await db.select().from(competitors).where(and(eq(competitors.workspaceId, ws.id), eq(competitors.slug, SOURCE_SLUG)));
if (!source) {
  [source] = await db
    .insert(competitors)
    .values({
      workspaceId: ws.id,
      slug: SOURCE_SLUG,
      name: "Primini (source)",
      domain: "primini.tn",
      websiteUrl: "https://primini.tn",
      enabled: false,
      connectorStatus: "limited",
      connectorNotes: "Comparateur utilisé comme source : les prix sont classés par boutique. Synchronisé depuis un PC du bureau.",
      isDemo: false,
    })
    .returning();
}

const status = (await catalogStatus([source.id])).get(source.id);
if (!status?.size || !status.indexedAt || Date.now() - status.indexedAt.getTime() > CATALOG_MAX_AGE_MS) {
  console.log("Indexation du catalogue Primini…");
  console.log("  pages produit :", (await rebuildCatalog(source)).size);
}

// Only a real web suffix is dropped ("mytek.tn" -> "mytek"): "SpaceNet" and "Tunisianet" keep their "net".
const shopKey = (s: string) => compactText(s.replace(/\.(tn|com|net)\b/gi, "")).replace(/^www/, "");
const allComps = await db.select().from(competitors).where(eq(competitors.workspaceId, ws.id));
const selectedShops = allComps.filter(isSelectedCompetitor);
const own = [ws.name, ws.legalName, ...allComps.filter((c) => c.isOwnShop).map((c) => c.name)].filter(Boolean).map((s) => shopKey(s!));

const sellerSlugByKey: Record<string, string> = {
  mytek: "mytek",
  spacenet: "spacenet",
  tunisianet: "tunisianet",
  zoom: "zoom",
  // zoom.com.tn appears on Primini under its company name.
  zoominformatique: "zoom",
  graiet: "graiet",
  graiiet: "graiet",
  alarabia: "alarabia",
  batam: "batam",
  electrohadjkacem: "electrohadjkacem",
  hadjkacem: "electrohadjkacem",
};

function shopFor(seller: string): Competitor | undefined {
  const slug = sellerSlugByKey[shopKey(seller)];
  return selectedShops.find((c) => c.slug === slug);
}

type PriceOffer = { title: string; priceTnd: number; seller: string; availability: Availability };

function isPriminiUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === "primini.tn" || new URL(url).hostname.endsWith(".primini.tn");
  } catch {
    return false;
  }
}

function isSellerProductUrl(url: string | null, shop: Competitor): boolean {
  if (!url || isPriminiUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const domain = shop.domain.replace(/^www\./, "").toLowerCase();
    return (parsed.hostname.toLowerCase() === domain || parsed.hostname.toLowerCase().endsWith(`.${domain}`)) && parsed.pathname !== "/";
  } catch {
    return false;
  }
}

/**
 * The seller's own product page for a price read on Primini, so every link opens the exact article.
 * Tried in order: our reference on the seller's page; the seller's own title as shown on Primini (it is the
 * title of its product page); brand + model code from our name. A page found by title or model code must
 * sell at about the Primini price (±8 %). When none is found, the link opens the seller's search results for
 * the article (never its home page when the shop has a search URL).
 */
async function directOfferFor(product: Product, shop: Competitor, priminiOffer: PriceOffer): Promise<{ url: string; offer: PriceOffer; viaPrimini: boolean }> {
  const domain = shop.domain.replace(/^www\./, "").toLowerCase();
  const onShop = (url: string) => {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  };
  const model = priminiSearches(product).filter((s) => s.minScore < 60);
  const attempts: Array<{ term: string; check: string | null; minScore: number; sizes: string[] }> = [
    ...searchTermsForProduct(product).map((t) => ({ term: t, check: t, minScore: 60, sizes: [] as string[] })),
    ...(priminiOffer.title ? [{ term: priminiOffer.title, check: null, minScore: 50, sizes: model[0]?.sizes ?? [] }] : []),
    ...model.map((s) => ({ term: s.term, check: s.check, minScore: 35, sizes: s.sizes })),
  ];
  const tried = new Set<string>();
  for (const a of attempts) {
    const hits = (await searchCatalog([shop.id], a.term, 6)).filter((h) => h.score >= a.minScore && onShop(h.url) && a.sizes.every((sz) => h.slugTitle.split(" ").includes(sz)));
    for (const hit of hits) {
      if (tried.has(hit.url)) continue;
      tried.add(hit.url);
      const live = await fetchLiveOffer(hit.url, a.check ? { reference: a.check } : undefined);
      if (!live.ok || !live.offer.title) continue;
      if (a.check && !live.offer.referenceOnPage) continue;
      // Found by its title or model code: it must be the article Primini priced, not a neighbour.
      if (a.minScore < 60 && Math.abs(live.offer.priceTnd - priminiOffer.priceTnd) > priminiOffer.priceTnd * 0.08) continue;
      return {
        url: hit.url,
        offer: {
          title: live.offer.title,
          priceTnd: live.offer.priceTnd,
          seller: priminiOffer.seller,
          availability: live.offer.availability,
        },
        viaPrimini: false,
      };
    }
  }
  const query = product.manufacturerRef || model[0]?.term || priminiOffer.title;
  const searchUrl = shop.searchUrlTemplate && query ? shop.searchUrlTemplate.replace("{q}", encodeURIComponent(query)) : null;
  return { url: searchUrl ?? shop.websiteUrl, offer: priminiOffer, viaPrimini: true };
}

async function upsert(product: Product, shop: Competitor, pageUrl: string, offer: PriceOffer, compatible: boolean, viaPrimini: boolean) {
  const existing = await db.select().from(competitorOffers).where(and(eq(competitorOffers.productId, product.id), eq(competitorOffers.competitorId, shop.id)));
  const direct = existing.find((o) => isSellerProductUrl(o.url, shop) && !o.matchReason?.includes("via Primini") && !o.isCompatible && o.userReview !== "reject");
  if (direct && !compatible) return "direct";
  const mine = existing.find((o) => o.url === pageUrl && o.isCompatible === compatible)
    ?? existing.find((o) => o.matchReason?.includes("via Primini") && o.isCompatible === compatible);
  if (mine?.userReview === "reject") return "rejected";
  const now = new Date();
  if (mine) {
    const changed = Math.abs(n(mine.priceTnd) - offer.priceTnd) > 0.0005;
    await db.update(competitorOffers).set({
      url: pageUrl,
      priceTnd: moneyStr(offer.priceTnd),
      title: offer.title,
      sellerName: offer.seller,
      availability: offer.availability,
      matchReason: viaPrimini ? `Prix relevé via Primini (vendeur : ${offer.seller})` : "Prix vérifié sur la page produit du vendeur",
      lastCheckedAt: now,
      stale: false,
    }).where(eq(competitorOffers.id, mine.id));
    if (changed) {
      await db.insert(priceObservations).values({ workspaceId: ws.id, offerId: mine.id, productId: product.id, competitorId: shop.id, priceTnd: moneyStr(offer.priceTnd), availability: offer.availability, eventType: offer.priceTnd > n(mine.priceTnd) ? "increase" : "decrease", isDemo: false });
    }
    return "updated";
  }
  const [row] = await db
    .insert(competitorOffers)
    .values({
      workspaceId: ws.id,
      productId: product.id,
      competitorId: shop.id,
      title: offer.title,
      brand: product.brand,
      model: product.model,
      manufacturerRef: product.manufacturerRef,
      url: pageUrl,
      priceTnd: moneyStr(offer.priceTnd),
      sellerName: offer.seller,
      availability: offer.availability,
      matchClass: compatible ? "possible" : "exact",
      matchConfidence: compatible ? 60 : 85,
      matchReason: compatible
        ? `Compatible relevé via Primini (vendeur : ${offer.seller})`
        : viaPrimini
          ? `Prix relevé via Primini (vendeur : ${offer.seller}) — référence trouvée sur la page`
          : "Prix vérifié sur la page produit du vendeur",
      excludedFromBenchmark: compatible,
      isCompatible: compatible,
      isDemo: false,
    })
    .returning();
  await db.insert(priceObservations).values({ workspaceId: ws.id, offerId: row.id, productId: product.id, competitorId: shop.id, priceTnd: moneyStr(offer.priceTnd), availability: offer.availability, eventType: "unchanged", isDemo: false });
  return "added";
}

const totals = { products: due.length, found: 0, added: 0, updated: 0, directMatchesAdded: 0, reviewCandidates: 0, skippedDirect: 0, skippedOtherShops: 0, sellerSiteFallbacks: 0 };
console.log(`${due.length}/${list.length} produits à rechercher sur Primini…`);

const [user] = await db.select().from(users).where(eq(users.workspaceId, ws.id)).limit(1);
if (!user) throw new Error("Aucun utilisateur associé à l'espace de travail");
const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
if (!settings) throw new Error("Aucun paramètre utilisateur associé au compte");
const matchingAuth: AuthContext = { user, workspace: ws, settings };
const selectedShopIds = selectedShops.map((c) => c.id);
type PriminiSearch = { term: string; check: string; minScore: number; sizes: string[] };

/**
 * What to look up on Primini: the usual terms (reference, model, name), plus, for articles imported
 * without a reference, brand + the model code read from the name ("TCL S5K 43" from
 * "Téléviseur TCL 43\" S5K QLED…"). The code must then appear on the Primini page, and a screen size
 * in the name (43, 55…) must appear in its title, so a 55" is never taken for the 43".
 */
function priminiSearches(p: Product): PriminiSearch[] {
  const out: PriminiSearch[] = searchTermsForProduct(p).map((t) => ({ term: t, check: t, minScore: 60, sizes: [] }));
  const words = p.name.split(/[\s"”″/,()—–-]+/).filter(Boolean);
  const codes = words.filter(
    (w) => w.length >= 2 && w.length <= 20 && /[a-z]/i.test(w) && /\d/.test(w) && !/^(\d+(go|gb|to|tb|kg|g|w|l|mp|m|hz|mah|v|p))$/i.test(w) && !/^[2-8]k$|^[345]g$|^3d$/i.test(w),
  );
  // A screen size is written 43" / 55 pouces; a bare number (a reference suffix such as "-80") is not one.
  const size = p.name.match(/\b(\d{2})\s*(?:"|”|″|''|pouces?\b|po\b|inch)/i)?.[1];
  const sizes = size && Number(size) >= 19 && Number(size) <= 98 ? [size] : [];
  const brand = p.brand ?? deriveIdentity(p.name).brand;
  for (const code of codes) {
    if (out.some((s) => s.check.toLowerCase() === code.toLowerCase())) continue;
    out.push({ term: [brand, code, ...sizes].filter(Boolean).join(" "), check: code, minScore: 35, sizes });
  }
  return out;
}

async function syncFromPrimini(p: Product) {
  const costTtc = n(p.purchasePrice) * (n(p.exchangeRate) || 1) * (1 + n(p.vatRate));
  let page: { url: string; sellers: Array<{ title: string; priceTnd: number; seller: string }> } | null = null;
  for (const s of priminiSearches(p)) {
    const hits = (await searchCatalog([source.id], s.term, 8)).filter((h) => h.score >= s.minScore && s.sizes.every((sz) => h.slugTitle.split(" ").includes(sz)));
    for (const hit of hits) {
      const live = await fetchLiveOffer(hit.url, { reference: s.check });
      if (!live.ok || !live.offer.referenceOnPage || !live.offer.sellerOffers?.length) continue;
      page = { url: hit.url, sellers: live.offer.sellerOffers };
      break;
    }
    if (page) break;
  }
  if (!page) return;
  totals.found += 1;
  // Cheapest offer per shop (a shop can list several variants).
  const byShop = new Map<string, PriceOffer>();
  for (const s of page.sellers) {
    if (own.some((o) => o && shopKey(s.seller).includes(o))) continue; // our own shop
    const key = shopKey(s.seller);
    const prev = byShop.get(key);
    if (!prev || s.priceTnd < prev.priceTnd) byShop.set(key, { ...s, availability: "in_stock" });
  }
  for (const s of byShop.values()) {
    const shop = shopFor(s.seller);
    if (!shop) {
      totals.skippedOtherShops += 1;
      continue;
    }
    const compatible = isCompatibleListing(s.title, p.name);
    // Same plausibility guard as the direct search: far below or above our cost is another product.
    if (costTtc > 0 && (s.priceTnd > costTtc * 3 || (!compatible && s.priceTnd < costTtc * 0.5))) continue;
    // No purchase cost: our numedia.tn price is the reference; with neither, do not trust the match.
    const ownRef = n(p.ownPriceTnd);
    if (!(costTtc > 0) && (!(ownRef > 0) || s.priceTnd > ownRef * 2 || (!compatible && s.priceTnd < ownRef * 0.5))) continue;
    const existing = await db.select().from(competitorOffers).where(and(eq(competitorOffers.productId, p.id), eq(competitorOffers.competitorId, shop.id)));
    if (existing.some((o) => isSellerProductUrl(o.url, shop) && !o.matchReason?.includes("via Primini") && !o.isCompatible && o.userReview !== "reject") && !compatible) {
      totals.skippedDirect += 1;
      continue;
    }
    const resolved = await directOfferFor(p, shop, s);
    if (resolved.viaPrimini) totals.sellerSiteFallbacks += 1;
    const r = await upsert(p, shop, resolved.url, resolved.offer, compatible, resolved.viaPrimini);
    if (r === "added") totals.added += 1;
    else if (r === "updated") totals.updated += 1;
    else if (r === "direct") totals.skippedDirect += 1;
  }
}

// Batches of 5: direct search on the shops' own sites (in parallel), then their Primini prices.
// Each product is marked done as soon as it is synced, so an interrupted run loses at most a batch.
for (let offset = 0; offset < due.length; offset += 5) {
  const batch = due.slice(offset, offset + 5);
  const outcomes = await Promise.all(batch.map((p) => autoMatchProduct(matchingAuth, p, { competitorIds: selectedShopIds, verifyPerCompetitor: 1 })));
  for (const outcome of outcomes) {
    totals.directMatchesAdded += outcome.tracked.length;
    totals.reviewCandidates += outcome.review.length;
  }
  for (const p of batch) {
    try {
      await syncFromPrimini(p);
      synced[p.id] = Date.now();
    } catch (err) {
      console.log(`  erreur sur « ${p.name.slice(0, 60)} » : ${err instanceof Error ? err.message : err}`);
    }
  }
  saveState();
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
  console.log(`  ${Math.min(offset + batch.length, due.length)}/${due.length} — ${totals.found} trouvés sur Primini, ${totals.added} prix ajoutés`);
}

const productById = new Map(list.map((p) => [p.id, p]));
const dueIds = new Set(due.map((p) => p.id));
const selectedShopById = new Map(selectedShops.map((c) => [c.id, c]));
const oldPriminiOffers = (await db.select().from(competitorOffers).where(and(eq(competitorOffers.workspaceId, ws.id), eq(competitorOffers.isDemo, false))))
  .filter((o) => isPriminiUrl(o.url) && selectedShopById.has(o.competitorId) && (!o.productId || dueIds.has(o.productId) || !productById.has(o.productId)));
let directLinksFixed = 0;
for (const o of oldPriminiOffers) {
  const shop = selectedShopById.get(o.competitorId)!;
  const product = o.productId ? productById.get(o.productId) : undefined;
  if (!product) {
    await db.update(competitorOffers).set({ url: shop.websiteUrl }).where(eq(competitorOffers.id, o.id));
    totals.sellerSiteFallbacks += 1;
    continue;
  }
  const resolved = await directOfferFor(product, shop, {
    title: o.title,
    priceTnd: n(o.priceTnd),
    seller: o.sellerName ?? shop.name,
    availability: o.availability,
  });
  if (resolved.viaPrimini) {
    await db.update(competitorOffers).set({ url: shop.websiteUrl }).where(eq(competitorOffers.id, o.id));
    totals.sellerSiteFallbacks += 1;
    continue;
  }
  const changed = Math.abs(n(o.priceTnd) - resolved.offer.priceTnd) > 0.0005;
  const now = new Date();
  await db.update(competitorOffers).set({
    url: resolved.url,
    title: resolved.offer.title,
    priceTnd: moneyStr(resolved.offer.priceTnd),
    availability: resolved.offer.availability,
    matchReason: "Prix vérifié sur la page produit du vendeur",
    lastCheckedAt: now,
    stale: false,
  }).where(eq(competitorOffers.id, o.id));
  if (changed) {
    await db.insert(priceObservations).values({
      workspaceId: ws.id,
      offerId: o.id,
      productId: product.id,
      competitorId: shop.id,
      priceTnd: moneyStr(resolved.offer.priceTnd),
      availability: resolved.offer.availability,
      eventType: resolved.offer.priceTnd > n(o.priceTnd) ? "increase" : "decrease",
      isDemo: false,
    });
  }
  directLinksFixed += 1;
}

console.log("Terminé :", JSON.stringify(totals));
if (directLinksFixed) console.log(`${directLinksFixed} anciens liens Primini remplacés par des liens directs vérifiés vers le vendeur.`);
if (totals.sellerSiteFallbacks) console.log(`${totals.sellerSiteFallbacks} prix Primini conservés avec un lien direct vers la boutique (aucune page produit vendeur vérifiable trouvée).`);
await pool.end();

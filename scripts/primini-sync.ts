// Primini sync — run on an office PC (Primini refuses the hosted app's servers):
//   DATABASE_URL=... bun scripts/primini-sync.ts
// For every catalogue product, imports only the selected shops' Primini prices. Prefer a verified
// seller product page and its live price; when unavailable, link to that seller's site, never Primini.
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { competitorOffers, competitors, priceObservations, products, userSettings, users, workspaces, type Competitor, type Product } from "@/db/schema";
import { autoMatchProduct, catalogStatus, rebuildCatalog, searchCatalog, searchTermsForProduct } from "@/lib/catalog";
import { compactText, fetchLiveOffer, type Availability } from "@/lib/extract";
import { isCompatibleListing } from "@/lib/matching";
import { moneyStr, n } from "@/lib/money";
import type { AuthContext } from "@/lib/auth";
import { isSelectedCompetitor } from "@/lib/connectors";

const SOURCE_SLUG = "primini-source";
const CATALOG_MAX_AGE_MS = 3 * 24 * 3600 * 1000;

const [ws] = await db.select().from(workspaces).limit(1);
if (!ws) throw new Error("Aucun espace de travail");

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

const shopKey = (s: string) => compactText(s).replace(/^www/, "").replace(/(tn|com|net)$/, "");
const allComps = await db.select().from(competitors).where(eq(competitors.workspaceId, ws.id));
const selectedShops = allComps.filter(isSelectedCompetitor);
const own = [ws.name, ws.legalName, ...allComps.filter((c) => c.isOwnShop).map((c) => c.name)].filter(Boolean).map((s) => shopKey(s!));

const sellerSlugByKey: Record<string, string> = {
  mytek: "mytek",
  spacenet: "spacenet",
  tunisianet: "tunisianet",
  zoom: "zoom",
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

async function directOfferFor(product: Product, shop: Competitor, priminiOffer: PriceOffer): Promise<{ url: string; offer: PriceOffer; viaPrimini: boolean }> {
  const terms = searchTermsForProduct(product);
  for (const term of terms) {
    const hits = (await searchCatalog([shop.id], term, 8)).filter((h) => h.score >= 60);
    for (const hit of hits) {
      const hitUrl = new URL(hit.url);
      const domain = shop.domain.replace(/^www\./, "").toLowerCase();
      if (hitUrl.hostname.toLowerCase() !== domain && !hitUrl.hostname.toLowerCase().endsWith(`.${domain}`)) continue;
      const live = await fetchLiveOffer(hit.url, { reference: term });
      if (!live.ok || !live.offer.referenceOnPage || !live.offer.title) continue;
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
  return { url: shop.websiteUrl, offer: priminiOffer, viaPrimini: true };
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

const list = await db.select().from(products).where(and(eq(products.workspaceId, ws.id), isNull(products.archivedAt)));
const totals = { products: list.length, found: 0, added: 0, updated: 0, directMatchesAdded: 0, reviewCandidates: 0, skippedDirect: 0, skippedOtherShops: 0, sellerSiteFallbacks: 0 };
console.log(`${list.length} produits à rechercher sur Primini…`);

const [user] = await db.select().from(users).where(eq(users.workspaceId, ws.id)).limit(1);
if (!user) throw new Error("Aucun utilisateur associé à l'espace de travail");
const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
if (!settings) throw new Error("Aucun paramètre utilisateur associé au compte");
const matchingAuth: AuthContext = { user, workspace: ws, settings };
const selectedShopIds = selectedShops.map((c) => c.id);
for (let offset = 0; offset < list.length; offset += 5) {
  const batch = list.slice(offset, offset + 5);
  const outcomes = await Promise.all(batch.map((p) => autoMatchProduct(matchingAuth, p, { competitorIds: selectedShopIds, verifyPerCompetitor: 1 })));
  for (const outcome of outcomes) {
    totals.directMatchesAdded += outcome.tracked.length;
    totals.reviewCandidates += outcome.review.length;
  }
  console.log(`  recherche directe boutiques : ${Math.min(offset + batch.length, list.length)}/${list.length}`);
}

for (const [i, p] of list.entries()) {
  const costTtc = n(p.purchasePrice) * (n(p.exchangeRate) || 1) * (1 + n(p.vatRate));
  let page: { url: string; sellers: Array<{ title: string; priceTnd: number; seller: string }> } | null = null;
  for (const term of searchTermsForProduct(p)) {
    const hits = (await searchCatalog([source.id], term, 8)).filter((h) => h.score >= 60);
    for (const hit of hits) {
      const live = await fetchLiveOffer(hit.url, { reference: term });
      if (!live.ok || !live.offer.referenceOnPage || !live.offer.sellerOffers?.length) continue;
      page = { url: hit.url, sellers: live.offer.sellerOffers };
      break;
    }
    if (page) break;
  }
  if (!page) continue;
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
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${list.length} — ${totals.found} trouvés sur Primini, ${totals.added} prix ajoutés`);
}

const productById = new Map(list.map((p) => [p.id, p]));
const selectedShopById = new Map(selectedShops.map((c) => [c.id, c]));
const oldPriminiOffers = (await db.select().from(competitorOffers).where(and(eq(competitorOffers.workspaceId, ws.id), eq(competitorOffers.isDemo, false))))
  .filter((o) => isPriminiUrl(o.url) && selectedShopById.has(o.competitorId));
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

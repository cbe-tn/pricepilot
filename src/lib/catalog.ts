// Competitor catalogue index built from each shop's public sitemap, plus reference search.
// Sitemaps are published for crawlers, so this works even where on-site search is disallowed
// by robots.txt. Candidates are then verified against the live product page.

import { and, count, eq, ilike, inArray, max, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { competitorCatalog, competitorOffers, competitors, priceObservations, products, workspaces, type Competitor, type Product } from "@/db/schema";
import { USER_AGENT, compactText, fetchLiveOffer, fetchWithTimeout, isAllowedByRobots, politeDelay, type Availability } from "@/lib/extract";
import { isCompatibleListing, matchListing, type MatchClass } from "@/lib/matching";
import { moneyStr, n } from "@/lib/money";
import type { AuthContext } from "@/lib/auth";

const CATALOG_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
const MAX_SITEMAP_FILES = 30;
const INSERT_BATCH = 500;

// ---------- sitemap crawling ----------

type SitemapEntry = { url: string; imageUrl: string | null; lastmod: Date | null; title?: string | null };

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim().replace(/&amp;/g, "&");
}

function sameScheme(url: string, siteUrl: string): string {
  // Some sitemap indexes list http:// children for an https site.
  return siteUrl.startsWith("https:") ? url.replace(/^http:/, "https:") : url;
}

async function fetchText(url: string): Promise<string | null> {
  if (!(await isAllowedByRobots(url))) return null;
  await politeDelay(new URL(url).host);
  try {
    const res = await fetchWithTimeout(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function sitemapRoots(siteUrl: string): Promise<string[]> {
  const origin = new URL(siteUrl).origin;
  const robots = await fetchText(`${origin}/robots.txt`);
  const listed = [...(robots ?? "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => sameScheme(m[1], siteUrl));
  // Magento lists sitemap_category / sitemap_product / sitemap_cms: category pages also end in ".html".
  const productOnly = listed.filter((u) => /product|produit/i.test(u));
  return productOnly.length ? [...new Set(productOnly)] : listed.length ? [...new Set(listed)] : [`${origin}/sitemap.xml`];
}

function isLikelyProductUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  // Most shops use "/slug.html"; Eleganza uses "/product/<id>/<slug>/", Medusa shops "/products/<handle>",
  // numedia.tn "/produit/<slug>".
  return (
    (path.endsWith(".html") && path.length > 6) ||
    /^\/product\/\d+\/[^/]+/.test(path) ||
    /^\/products\/[^/]+\/?$/.test(path) ||
    /^\/produit\/[^/]+\/?$/.test(path)
  );
}

export async function crawlSitemaps(siteUrl: string): Promise<SitemapEntry[]> {
  const queue = await sitemapRoots(siteUrl);
  const seen = new Set<string>();
  const entries = new Map<string, SitemapEntry>();
  while (queue.length && seen.size < MAX_SITEMAP_FILES) {
    const loc = queue.shift()!;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const xml = await fetchText(loc);
    if (!xml) continue;
    if (/<sitemapindex/i.test(xml)) {
      const children = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)].map((m) => sameScheme(stripCdata(m[1]), siteUrl));
      const productChildren = children.filter((c) => /product|produit/i.test(c));
      const pick = productChildren.length ? productChildren : children.filter((c) => !/categor|cms|brand|manufacturer|supplier|page/i.test(c));
      queue.push(...pick);
      continue;
    }
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const block = m[1];
      const url = stripCdata(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] ?? "");
      if (!url || !isLikelyProductUrl(url) || entries.has(url)) continue;
      const image = block.match(/<image:loc>([\s\S]*?)<\/image:loc>/i)?.[1];
      const lastmod = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1];
      const date = lastmod ? new Date(lastmod.trim()) : null;
      entries.set(url, { url, imageUrl: image ? stripCdata(image) : null, lastmod: date && !Number.isNaN(date.getTime()) ? date : null });
    }
  }
  return [...entries.values()];
}

// ---------- catalogue APIs (shops whose sitemap lists no products) ----------

const MAX_API_PAGES = 200;

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  if (!(await isAllowedByRobots(url))) return null;
  await politeDelay(new URL(url).host);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Accept-Language": "fr-TN,fr;q=0.9", ...headers },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

type PrestaListing = {
  products?: Array<{ url?: string; name?: string; cover?: { large?: { url?: string } } | null }>;
  pagination?: { pages_count?: number };
};

/** PrestaShop: the root category (id 2) lists the whole catalogue as JSON when asked over AJAX. */
async function crawlPrestaShop(siteUrl: string): Promise<SitemapEntry[]> {
  const origin = new URL(siteUrl).origin;
  const out = new Map<string, SitemapEntry>();
  for (let page = 1; page <= MAX_API_PAGES; page++) {
    const data = await fetchJson<PrestaListing>(`${origin}/index.php?id_category=2&controller=category&resultsPerPage=100&page=${page}`, {
      "X-Requested-With": "XMLHttpRequest",
    });
    const items = data?.products ?? [];
    for (const p of items) if (p.url) out.set(p.url, { url: p.url, title: p.name ?? null, imageUrl: p.cover?.large?.url ?? null, lastmod: null });
    if (!items.length || page >= (data?.pagination?.pages_count ?? 0)) break;
  }
  return [...out.values()];
}

type MedusaListing = { products?: Array<{ handle?: string; title?: string; thumbnail?: string | null; updated_at?: string }>; count?: number };
const medusaConfigs = new Map<string, { backend: string; key: string }>();

/**
 * Medusa storefronts (Next.js) load products in the browser from a Medusa backend with a public
 * "publishable" key. Both are embedded in the storefront's scripts, so read them from there.
 */
async function medusaConfig(siteUrl: string): Promise<{ backend: string; key: string } | null> {
  const origin = new URL(siteUrl).origin;
  const cached = medusaConfigs.get(origin);
  if (cached) return cached;
  let found: { backend: string; key: string } | null = null;
  const home = await fetchText(origin + "/");
  if (home?.includes("/_next/static/")) {
    const baseDomain = new URL(origin).hostname.replace(/^www\./, "");
    let key: string | undefined;
    const backends = new Set<string>();
    for (const src of [...new Set([...home.matchAll(/\/_next\/static\/[^"'\s]+\.js/g)].map((m) => m[0]))]) {
      const js = await fetchText(origin + src);
      if (!js) continue;
      key ??= js.match(/pk_[a-f0-9]{32,}/)?.[0];
      for (const m of js.matchAll(/https:\/\/([a-z0-9-]+\.)+[a-z]{2,}/g)) {
        const host = new URL(m[0]).hostname;
        if (host !== new URL(origin).hostname && host.endsWith(baseDomain) && !host.startsWith("cdn.")) backends.add(m[0]);
      }
      if (key && backends.size) break;
    }
    for (const backend of key ? [...backends, origin] : []) {
      const probe = await fetchJson<MedusaListing>(`${backend}/store/products?limit=1&fields=handle`, { "x-publishable-api-key": key! });
      if (probe?.products) {
        found = { backend, key: key! };
        break;
      }
    }
  }
  if (found) medusaConfigs.set(origin, found);
  return found;
}

async function crawlMedusa(siteUrl: string): Promise<SitemapEntry[]> {
  const cfg = await medusaConfig(siteUrl);
  if (!cfg) return [];
  const origin = new URL(siteUrl).origin;
  const out: SitemapEntry[] = [];
  for (let page = 0; page < MAX_API_PAGES; page++) {
    const data = await fetchJson<MedusaListing>(`${cfg.backend}/store/products?limit=100&offset=${page * 100}&fields=handle,title,thumbnail,updated_at`, {
      "x-publishable-api-key": cfg.key,
    });
    const items = data?.products ?? [];
    for (const p of items) {
      if (!p.handle) continue;
      const date = p.updated_at ? new Date(p.updated_at) : null;
      out.push({ url: `${origin}/products/${p.handle}`, title: p.title ?? null, imageUrl: p.thumbnail ?? null, lastmod: date && !Number.isNaN(date.getTime()) ? date : null });
    }
    if (items.length < 100 || out.length >= (data?.count ?? 0)) break;
  }
  return out;
}

/** Every product URL a competitor publishes: its sitemap, or else its shop platform's catalogue API. */
export async function crawlCatalog(siteUrl: string): Promise<SitemapEntry[]> {
  const fromSitemap = await crawlSitemaps(siteUrl);
  if (fromSitemap.length >= 50) return fromSitemap;
  for (const crawl of [crawlPrestaShop, crawlMedusa]) {
    const entries = await crawl(siteUrl);
    if (entries.length > fromSitemap.length) return entries;
  }
  return fromSitemap;
}

function slugText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugTitleFromUrl(url: string): string {
  const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  return slugText(
    last
      .replace(/\.html?$/i, "")
      .replace(/^\d+-/, ""), // PrestaShop "12345-" product id prefix
  );
}

// ---------- index maintenance ----------

export type CatalogStatus = { competitorId: string; size: number; indexedAt: Date | null };

export async function catalogStatus(competitorIds: string[]): Promise<Map<string, CatalogStatus>> {
  const out = new Map<string, CatalogStatus>();
  if (!competitorIds.length) return out;
  const rows = await db
    .select({ competitorId: competitorCatalog.competitorId, size: count(), indexedAt: max(competitorCatalog.indexedAt) })
    .from(competitorCatalog)
    .where(inArray(competitorCatalog.competitorId, competitorIds))
    .groupBy(competitorCatalog.competitorId);
  for (const id of competitorIds) out.set(id, { competitorId: id, size: 0, indexedAt: null });
  for (const r of rows) out.set(r.competitorId, { competitorId: r.competitorId, size: Number(r.size), indexedAt: r.indexedAt ? new Date(r.indexedAt) : null });
  return out;
}

export async function rebuildCatalog(competitor: Pick<Competitor, "id" | "websiteUrl">): Promise<{ size: number }> {
  const entries = await crawlCatalog(competitor.websiteUrl);
  if (!entries.length) return { size: 0 }; // keep the previous index if the catalogue was unreachable
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(competitorCatalog).where(eq(competitorCatalog.competitorId, competitor.id));
    for (let i = 0; i < entries.length; i += INSERT_BATCH) {
      const rows = entries.slice(i, i + INSERT_BATCH).map((e) => {
        // API titles keep the full name; URL slugs can be truncated (PrestaShop) or abbreviated.
        const slugTitle = e.title ? slugText(e.title) || slugTitleFromUrl(e.url) : slugTitleFromUrl(e.url);
        return { competitorId: competitor.id, url: e.url, slugTitle, searchKey: slugTitle.replace(/ /g, ""), imageUrl: e.imageUrl, lastmod: e.lastmod, indexedAt: now };
      });
      await tx.insert(competitorCatalog).values(rows).onConflictDoNothing();
    }
  });
  return { size: entries.length };
}

async function ensureCatalog(competitor: Competitor, status: CatalogStatus | undefined): Promise<void> {
  const fresh = status && status.size > 0 && status.indexedAt && Date.now() - status.indexedAt.getTime() < CATALOG_MAX_AGE_MS;
  if (!fresh) await rebuildCatalog(competitor);
}

// ---------- search ----------

// French shops write capacities as "1to" / "16go"; normalise both sides to that form.
function normaliseUnits(text: string): string {
  return text
    .replace(/(\d+)\s*(?:tb|to)\b/g, "$1to")
    .replace(/(\d+)\s*(?:gb|go)\b/g, "$1go")
    .replace(/(\d+)\s*(?:inch|pouces?)\b/g, "$1pouces");
}

function queryTokens(query: string): string[] {
  const text = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return [...new Set(normaliseUnits(text).split(" ").filter((t) => t.length >= 2))];
}

const STOPWORDS = new Set(["de", "du", "la", "le", "les", "et", "pour", "avec", "en", "the", "for", "and", "with"]);

type CatalogHit = { competitorId: string; url: string; slugTitle: string; imageUrl: string | null; score: number };

export async function searchCatalog(competitorIds: string[], query: string, perCompetitor = 5): Promise<CatalogHit[]> {
  const compact = compactText(query);
  const tokens = queryTokens(query).filter((t) => !STOPWORDS.has(t));
  if (!competitorIds.length || (!tokens.length && compact.length < 3)) return [];

  // Recall: any row containing the whole reference, or any distinctive token. Ranking happens below.
  const distinctive = tokens.filter((t) => /\d/.test(t) || t.length >= 3);
  const conds: SQL[] = [];
  if (compact.length >= 4) conds.push(ilike(competitorCatalog.searchKey, `%${compact}%`));
  for (const t of distinctive.length ? distinctive : tokens) conds.push(ilike(competitorCatalog.slugTitle, `%${t}%`));
  const rows = await db
    .select()
    .from(competitorCatalog)
    .where(and(inArray(competitorCatalog.competitorId, competitorIds), or(...conds)))
    .limit(5000);

  const scored = rows.map((r) => {
    const title = normaliseUnits(r.slugTitle);
    const words = new Set(title.split(" "));
    const key = title.replace(/ /g, "");
    let score = 0;
    if (compact.length >= 4 && (r.searchKey.includes(compact) || key.includes(compact))) score += 60;
    const weight = (t: string) => (/\d/.test(t) ? 2 : 1); // model numbers matter more than words
    const total = tokens.reduce((s, t) => s + weight(t), 0) || 1;
    const exact = tokens.filter((t) => words.has(t)).reduce((s, t) => s + weight(t), 0);
    const partial = tokens.filter((t) => !words.has(t) && t.length >= 3 && key.includes(t)).reduce((s, t) => s + weight(t), 0);
    const coverage = (exact + 0.6 * partial) / total;
    score += 40 * coverage;
    score -= Math.min(8, Math.max(0, words.size - tokens.length - 5) * 0.5); // prefer focused titles
    // Every model number in the query ("990", "4060", "14400f") must appear; capacities stay soft.
    const modelTokens = tokens.filter((t) => /\d/.test(t) && !/^\d+(to|go|pouces|w|hz|mah)$/.test(t));
    const hasModels = modelTokens.every((t) => words.has(t) || (t.length >= 4 && key.includes(t)));
    return { competitorId: r.competitorId, url: r.url, slugTitle: r.slugTitle, imageUrl: r.imageUrl, score, coverage: hasModels ? coverage : 0 };
  });

  const out: CatalogHit[] = [];
  for (const id of competitorIds) {
    out.push(
      ...scored
        .filter((h) => h.competitorId === id && (h.score >= 60 || h.coverage >= 0.6))
        .sort((a, b) => b.score - a.score)
        .slice(0, perCompetitor)
        .map(({ coverage: _c, ...h }) => h),
    );
  }
  return out;
}

// ---------- reference lookup with live verification ----------

// Accessory titles lead with the accessory noun ("Toner …", "Bouteille d'encre …", "Filtre à charbon pour hotte …");
// a real product that merely bundles one ("… + 6 bouteilles d'encre offertes") does not.
const ACCESSORY_LEAD_RE =
  /^(?:\S+\s+){0,2}?(toner|cartouches?|encres?|bouteilles?|ink|ruban|tambour|drum|kit|bac|papier|cables?|chargeurs?|adaptateurs?|supports?|fixations?|housses?|etuis?|coques?|batteries?|alimentations?|filtres?|set de|pieces?|telecommande|tete d'impression|reservoir d'encre)\b/;
const ACCESSORY_ANYWHERE_RE = /\b(compatibles?|pour (?:imprimante|hotte|camera|cameras|dvr|nvr))\b/;

function normTitle(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeAccessory(title: string): boolean {
  const t = normTitle(title);
  return ACCESSORY_LEAD_RE.test(t) || ACCESSORY_ANYWHERE_RE.test(t);
}

/** True when the listing is an accessory/consumable while our product is not (e.g. toner vs printer). */
export function isAccessoryOf(listingTitle: string, productName: string): boolean {
  return looksLikeAccessory(listingTitle) && !looksLikeAccessory(productName);
}

export type ReferenceCandidate = {
  competitorId: string;
  competitorName: string;
  url: string;
  title: string;
  imageUrl: string | null;
  priceTnd: number | null;
  availability: Availability;
  referenceOnPage: boolean;
  matchClass: MatchClass | null;
  confidence: number;
  reason: string;
  alreadyTracked: boolean;
  /** Comparator pages: the shop offering priceTnd. */
  seller?: string | null;
  error?: string;
  /** Compatible ("adaptable") version of the reference, not the original product. */
  compatible?: boolean;
  /** The site refused the request (anti-robot protection, HTTP 403/429). */
  blocked?: boolean;
};


export const BLOCKED_PREFIX = "Accès bloqué";

/**
 * Remembers which competitors refuse our requests (anti-robot protection), so the benchmark can say
 * "accès bloqué" instead of looking empty; cleared as soon as a page from that site is read again.
 */
async function recordAccess(sources: Competitor[], verified: ReferenceCandidate[][]) {
  for (const [i, s] of sources.entries()) {
    const group = verified[i] ?? [];
    if (!group.length) continue;
    const ok = group.some((c) => !c.error);
    const blocked = !ok && group.every((c) => c.blocked);
    const wasBlocked = s.lastError?.startsWith(BLOCKED_PREFIX) ?? false;
    if (blocked && !wasBlocked) {
      await db
        .update(competitors)
        .set({ lastError: `${BLOCKED_PREFIX} : le site refuse les visites automatiques depuis notre serveur (protection anti-robot, HTTP 403).` })
        .where(eq(competitors.id, s.id));
    } else if (ok && wasBlocked) {
      await db.update(competitors).set({ lastError: null }).where(eq(competitors.id, s.id));
    }
  }
}


export type ReferenceSearchResult = {
  reference: string;
  candidates: ReferenceCandidate[];
  catalogs: Array<{ competitorId: string; competitorName: string; size: number; indexedAt: string | null }>;
};

export async function findByReference(
  auth: AuthContext,
  input: { reference: string; productId?: string | null; verifyPerCompetitor?: number; competitorIds?: string[] },
): Promise<ReferenceSearchResult> {
  const reference = input.reference.trim();
  const verifyN = input.verifyPerCompetitor ?? 3;
  const sources = await db
    .select()
    .from(competitors)
    // Explicit ids may include our own (disabled) shop; otherwise every enabled competitor.
    .where(and(eq(competitors.workspaceId, auth.workspace.id), input.competitorIds?.length ? inArray(competitors.id, input.competitorIds) : eq(competitors.enabled, true)));

  let statuses = await catalogStatus(sources.map((s) => s.id));
  await Promise.all(sources.map((s) => ensureCatalog(s, statuses.get(s.id))));
  statuses = await catalogStatus(sources.map((s) => s.id));

  const product = input.productId
    ? (await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.workspaceId, auth.workspace.id))).limit(1))[0]
    : undefined;
  const tracked = product
    ? new Set(
        (await db.select({ url: competitorOffers.url }).from(competitorOffers).where(eq(competitorOffers.productId, product.id)))
          .map((o) => o.url)
          .filter(Boolean) as string[],
      )
    : new Set<string>();

  // Over-fetch, then spend the live checks on real products before accessories (ink bottles, toners…).
  const wantAccessories = looksLikeAccessory(product?.name ?? reference);
  const raw = await searchCatalog(
    sources.map((s) => s.id),
    reference,
    verifyN * 4,
  );
  const hits = sources.flatMap((s) =>
    raw
      .filter((h) => h.competitorId === s.id)
      .sort((a, b) => Number(!wantAccessories && looksLikeAccessory(a.slugTitle)) - Number(!wantAccessories && looksLikeAccessory(b.slugTitle)) || b.score - a.score)
      .slice(0, verifyN),
  );
  const byCompetitor = new Map(sources.map((s) => [s.id, s]));
  const exclusions = await sellerExclusions(auth.workspace.id);

  // Verify per competitor in parallel; requests to the same site stay sequential and spaced.
  const groups = sources.map((s) => hits.filter((h) => h.competitorId === s.id));
  const verified = await Promise.all(
    groups.map(async (group) => {
      const out: ReferenceCandidate[] = [];
      for (const hit of group) {
        const source = byCompetitor.get(hit.competitorId)!;
        const live = await fetchLiveOffer(hit.url, { reference, excludeSellers: exclusions });
        const base = {
          competitorId: source.id,
          competitorName: source.name,
          url: hit.url,
          alreadyTracked: tracked.has(hit.url),
        };
        if (!live.ok) {
          out.push({ ...base, title: hit.slugTitle, imageUrl: hit.imageUrl, priceTnd: null, availability: "unknown", referenceOnPage: false, matchClass: null, confidence: 0, reason: live.error, error: live.error, blocked: live.classification === "blocked" });
          continue;
        }
        const title = live.offer.title ?? hit.slugTitle;
        const refOnPage = Boolean(live.offer.referenceOnPage);
        let matchClass: MatchClass | null = null;
        let confidence = refOnPage ? 85 : Math.round(Math.min(70, hit.score));
        let reason = refOnPage ? `Référence « ${reference} » trouvée sur la page produit` : "Titre proche seulement — référence absente de la page";
        if (product) {
          const m = matchListing({
            productName: product.name,
            brand: product.brand,
            model: product.model,
            manufacturerRef: product.manufacturerRef,
            barcode: product.barcode,
            specifications: product.specifications,
            listingTitle: title,
            listingBrand: null,
            listingModel: null,
            listingRef: refOnPage ? reference : null,
            listingBarcode: null,
            listingCondition: "new",
          });
          matchClass = m.matchClass;
          confidence = refOnPage ? Math.max(m.confidence, 85) : m.confidence;
          reason = refOnPage ? `${reason}. ${m.reason}` : m.reason;
          // A toner "for FS-1025MFP" mentions the printer's reference but is a different product.
          if (isAccessoryOf(title, product.name)) {
            matchClass = "unverified";
            confidence = Math.min(confidence, 20);
            reason = `Semble être un accessoire ou consommable pour ce produit, pas le produit lui-même. ${reason}`;
          }
          // Bundles ("Pack hotte + plaque + four"), refurbished or size/storage variants are not comparable.
          if (m.excluded) {
            matchClass = "unverified";
            confidence = Math.min(confidence, 30);
            reason = m.exclusionReason ?? m.reason;
          }
        }
        const compatible = isCompatibleListing(title, product?.name ?? reference);
        if (compatible) reason = `Produit compatible (adaptable), pas l'original. ${reason}`;
        out.push({ ...base, title, imageUrl: live.offer.imageUrl ?? hit.imageUrl, priceTnd: live.offer.priceTnd, availability: live.offer.availability, referenceOnPage: refOnPage, matchClass, confidence, reason, seller: live.offer.seller ?? null, compatible });
      }
      return out;
    }),
  );

  await recordAccess(sources, verified);

  const candidates = verified
    .flat()
    .sort((a, b) => Number(b.referenceOnPage) - Number(a.referenceOnPage) || Number(b.priceTnd != null) - Number(a.priceTnd != null) || b.confidence - a.confidence);

  return {
    reference,
    candidates,
    catalogs: sources.map((s) => {
      const st = statuses.get(s.id);
      return { competitorId: s.id, competitorName: s.name, size: st?.size ?? 0, indexedAt: st?.indexedAt ? st.indexedAt.toISOString() : null };
    }),
  };
}



// ---------- seller exclusions ----------

/** Shops a comparator's "other sellers" price must ignore: ourselves and competitors tracked directly. */
export async function sellerExclusions(workspaceId: string): Promise<string[]> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const comps = await db.select({ name: competitors.name, slug: competitors.slug }).from(competitors).where(eq(competitors.workspaceId, workspaceId));
  return [ws?.name, ws?.legalName, ...comps.filter((c) => c.slug !== "primini").map((c) => c.name)].filter((x): x is string => Boolean(x && x.trim()));
}

// ---------- automatic matching ----------

function compactLength(s: string): number {
  return compactText(s).length;
}

/** Search terms for a product, most specific first. Very short refs ("580") are too ambiguous alone. */
export function searchTermsForProduct(p: Pick<Product, "manufacturerRef" | "model" | "name" | "brand">): string[] {
  const terms = [p.manufacturerRef, p.model, p.brand && p.model && !p.model.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.brand} ${p.model}` : null, p.name];
  return [...new Set(terms.map((t) => t?.trim()).filter((t): t is string => Boolean(t && compactLength(t) >= 4)))];
}

export type AutoMatchOutcome = {
  productId: string;
  tracked: Array<{ competitorName: string; url: string; priceTnd: number }>;
  review: ReferenceCandidate[];
};

/**
 * Finds a product on every competitor and records confident matches as live-tracked offers:
 * the term must appear on the competitor's product page and the match grade must be exact/strong.
 * Weaker candidates are returned for manual review instead of being tracked.
 */
export async function autoMatchProduct(
  auth: AuthContext,
  product: Product,
  opts?: { competitorIds?: string[]; verifyPerCompetitor?: number },
): Promise<AutoMatchOutcome> {
  const outcome: AutoMatchOutcome = { productId: product.id, tracked: [], review: [] };
  const best = new Map<string, ReferenceCandidate>();
  const reviewByUrl = new Map<string, ReferenceCandidate>();
  let competitorCount = 0;

  // A real competitor rarely sells far below our own purchase cost; such hits are usually the wrong product.
  const costTtc = n(product.purchasePrice) * (n(product.exchangeRate) || 1) * (1 + n(product.vatRate));
  // Likewise nobody resells at 3× our cost: that is usually a bundle or a bigger variant.
  const plausiblePrice = (price: number) => !(costTtc > 0) || (price >= costTtc * 0.5 && price <= costTtc * 3);

  // Only search competitors this product has no accepted offer from yet (tracked offers are refreshed
  // by monitoring). A page the user rejected is never proposed again for this product, but the
  // competitor is still searched in case it lists the right article later.
  const existing = await db
    .select({ competitorId: competitorOffers.competitorId, url: competitorOffers.url, userReview: competitorOffers.userReview, isCompatible: competitorOffers.isCompatible })
    .from(competitorOffers)
    .where(eq(competitorOffers.productId, product.id));
  // A compatible offer does not cover a competitor: the original is still searched there.
  const covered = new Set(existing.filter((o) => o.userReview !== "reject" && !o.isCompatible).map((o) => o.competitorId));
  const compatibleFrom = new Set(existing.filter((o) => o.isCompatible).map((o) => o.competitorId));
  const compatibles = new Map<string, ReferenceCandidate>();
  const rejectedUrls = new Set(existing.filter((o) => o.userReview === "reject" && o.url).map((o) => o.url!));
  const enabled = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(and(eq(competitors.workspaceId, auth.workspace.id), eq(competitors.enabled, true)));
  const targets = enabled.map((c) => c.id).filter((id) => !covered.has(id) && (!opts?.competitorIds || opts.competitorIds.includes(id)));
  if (!targets.length) return outcome;

  for (const term of searchTermsForProduct(product)) {
    const res = await findByReference(auth, { reference: term, productId: product.id, verifyPerCompetitor: opts?.verifyPerCompetitor ?? 2, competitorIds: targets });
    competitorCount = res.catalogs.length;
    for (const c of res.candidates) {
      if (c.priceTnd == null || rejectedUrls.has(c.url)) continue;
      if (c.compatible) {
        // Compatible version of the reference: kept apart (cheapest per competitor), never as the original.
        const prev = compatibles.get(c.competitorId);
        const sane = !(costTtc > 0) || c.priceTnd <= costTtc * 3;
        if (c.referenceOnPage && sane && !compatibleFrom.has(c.competitorId) && !c.alreadyTracked && (!prev || c.priceTnd < prev.priceTnd!)) compatibles.set(c.competitorId, c);
        continue;
      }
      const confident = c.referenceOnPage && (c.matchClass === "exact" || c.matchClass === "strong") && plausiblePrice(c.priceTnd);
      if (c.alreadyTracked) {
        best.set(c.competitorId, c);
      } else if (confident && !best.has(c.competitorId)) {
        best.set(c.competitorId, c);
      } else if (c.referenceOnPage && !best.has(c.competitorId)) {
        reviewByUrl.set(c.url, c);
      }
    }
    if (best.size >= competitorCount) break; // every competitor already covered
  }

  for (const c of best.values()) {
    if (c.alreadyTracked) continue;
    const [offer] = await db
      .insert(competitorOffers)
      .values({
        workspaceId: auth.workspace.id,
        productId: product.id,
        competitorId: c.competitorId,
        title: c.title,
        brand: product.brand,
        model: product.model,
        manufacturerRef: product.manufacturerRef,
        url: c.url,
        imageUrl: c.imageUrl,
        priceTnd: moneyStr(c.priceTnd!),
        sellerName: c.seller ?? null,
        availability: c.availability,
        matchClass: c.matchClass ?? "strong",
        matchConfidence: c.confidence,
        matchReason: `Correspondance automatique : ${c.reason}`,
        excludedFromBenchmark: false,
        isDemo: false,
      })
      .returning();
    await db.insert(priceObservations).values({
      workspaceId: auth.workspace.id,
      offerId: offer.id,
      productId: product.id,
      competitorId: c.competitorId,
      priceTnd: moneyStr(c.priceTnd!),
      availability: c.availability,
      eventType: "unchanged",
      isDemo: false,
    });
    outcome.tracked.push({ competitorName: c.competitorName, url: c.url, priceTnd: c.priceTnd! });
  }
  // Compatibles: shown in their own column, excluded from every price comparison and recommendation.
  for (const c of compatibles.values()) {
    const [offer] = await db
      .insert(competitorOffers)
      .values({
        workspaceId: auth.workspace.id,
        productId: product.id,
        competitorId: c.competitorId,
        title: c.title,
        brand: product.brand,
        model: product.model,
        manufacturerRef: product.manufacturerRef,
        url: c.url,
        imageUrl: c.imageUrl,
        priceTnd: moneyStr(c.priceTnd!),
        sellerName: c.seller ?? null,
        availability: c.availability,
        matchClass: "possible",
        matchConfidence: Math.min(c.confidence, 60),
        matchReason: `Compatible détecté automatiquement : ${c.reason}`,
        excludedFromBenchmark: true,
        isCompatible: true,
        isDemo: false,
      })
      .returning();
    await db.insert(priceObservations).values({
      workspaceId: auth.workspace.id,
      offerId: offer.id,
      productId: product.id,
      competitorId: c.competitorId,
      priceTnd: moneyStr(c.priceTnd!),
      availability: c.availability,
      eventType: "unchanged",
      isDemo: false,
    });
  }
  outcome.review = [...reviewByUrl.values()].filter((c) => !best.has(c.competitorId));
  return outcome;
}

// ---------- our own web shop ----------

export async function ownShopFor(workspaceId: string): Promise<Competitor | null> {
  const [own] = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.workspaceId, workspaceId), eq(competitors.isOwnShop, true)))
    .limit(1);
  return own ?? null;
}

/**
 * Finds (or re-checks) this product on our own web shop, the same way competitors are matched:
 * found = reference on the page and an exact/strong match · review = probable listing to confirm ·
 * missing = not on our site yet (to add). A listing already found is only re-read for its live price.
 */
export async function matchOwnListing(auth: AuthContext, product: Product): Promise<void> {
  const own = await ownShopFor(auth.workspace.id);
  if (!own) return;
  const now = new Date();

  if (product.ownUrl && product.ownStatus === "found") {
    const live = await fetchLiveOffer(product.ownUrl);
    if (live.ok) {
      await db
        .update(products)
        .set({ ownPriceTnd: moneyStr(live.offer.priceTnd), ownAvailability: live.offer.availability, ownTitle: live.offer.title ?? product.ownTitle, ownCheckedAt: now })
        .where(eq(products.id, product.id));
      return;
    }
    if (!/HTTP 404|HTTP 410/.test(live.error)) {
      await db.update(products).set({ ownCheckedAt: now }).where(eq(products.id, product.id)); // temporary error: keep the link
      return;
    }
    // The page was removed from our site: search again below.
  }

  let best: ReferenceCandidate | null = null;
  let review: ReferenceCandidate | null = null;
  for (const term of searchTermsForProduct(product)) {
    const res = await findByReference(auth, { reference: term, productId: product.id, verifyPerCompetitor: 3, competitorIds: [own.id] });
    for (const c of res.candidates) {
      if (c.priceTnd == null) continue;
      if (c.referenceOnPage && (c.matchClass === "exact" || c.matchClass === "strong")) {
        best = c;
        break;
      }
      if (!review && c.referenceOnPage && c.confidence >= 40) review = c;
    }
    if (best) break;
  }
  if (!best && !review) review = await ownFallbackCandidate(own, product);
  const hit = best ?? review;
  await db
    .update(products)
    .set(
      hit
        ? { ownUrl: hit.url, ownTitle: hit.title, ownPriceTnd: moneyStr(hit.priceTnd!), ownAvailability: hit.availability, ownStatus: best ? "found" : "review", ownCheckedAt: now }
        : { ownUrl: null, ownTitle: null, ownPriceTnd: null, ownAvailability: null, ownStatus: "missing", ownCheckedAt: now },
    )
    .where(eq(products.id, product.id));
}

// Spec-like tokens that say nothing about the model: "3en1", "4800x1200pp", "a4", "29ppm", "2mp", "wifi".
const SPEC_TOKEN_RE = /^(?:\d+en\d+|\d+x\d+\w*|a\d|\d+(?:ppm|mp|go|to|gb|tb|w|hz|cm|mm|pouces|dpi)|\d{1,2})$/;

/**
 * Our own pages often omit the supplier reference ("1TJ09A") or spell the model differently
 * ("FX-2190" for "FX-2190II"). Look for the main model number plus the product's other words,
 * and return the best listing as "review" (never auto-confirmed).
 */
async function ownFallbackCandidate(own: Competitor, product: Product): Promise<ReferenceCandidate | null> {
  const refKey = compactText(product.manufacturerRef ?? "");
  const tokens = queryTokens(product.name).filter((t) => !STOPWORDS.has(t) && compactText(t) !== refKey);
  const models = tokens.filter((t) => /\d/.test(t) && !SPEC_TOKEN_RE.test(t)).sort((a, b) => b.length - a.length);
  const words = tokens.filter((t) => !/\d/.test(t) && t.length >= 3);
  if (!models.length) return null;
  // "2190ii" → also try "2190" (trailing letters are often dropped or changed between shops).
  const main = models[0];
  const core = main.replace(/[a-z]+$/, "");
  const variants = [...new Set([main, core.length >= 3 ? core : main])];
  const rows = await db
    .select()
    .from(competitorCatalog)
    .where(and(eq(competitorCatalog.competitorId, own.id), or(...variants.map((v) => ilike(competitorCatalog.slugTitle, `%${v}%`)))))
    .limit(200);
  const scored = rows
    .map((r) => {
      const slugWords = new Set(normaliseUnits(r.slugTitle).split(" "));
      const hasModel = variants.some((v) => slugWords.has(v) || [...slugWords].some((w) => w.startsWith(v)));
      const wordHits = words.filter((w) => slugWords.has(w)).length;
      const otherModels = models.slice(1).filter((m) => r.slugTitle.replace(/ /g, "").includes(m)).length;
      return { r, hasModel, score: (words.length ? wordHits / words.length : 0) + otherModels * 0.2 };
    })
    .filter((x) => x.hasModel && x.score >= 0.5 && !(isAccessoryOf(x.r.slugTitle, product.name)))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return null;
  const live = await fetchLiveOffer(top.r.url);
  if (!live.ok) return null;
  return {
    competitorId: own.id,
    competitorName: own.name,
    url: top.r.url,
    title: live.offer.title ?? top.r.slugTitle,
    imageUrl: live.offer.imageUrl ?? top.r.imageUrl,
    priceTnd: live.offer.priceTnd,
    availability: live.offer.availability,
    referenceOnPage: false,
    matchClass: "possible",
    confidence: Math.round(Math.min(60, 40 + top.score * 20)),
    reason: `Même modèle « ${main} » dans le titre — référence absente de la page, à vérifier`,
    alreadyTracked: false,
  };
}

// Live price extraction from public competitor product pages.
// Polite by design: honours robots.txt, identifies itself, spaces requests per domain,
// and only reads the standard price/stock metadata the shop already publishes.

export const USER_AGENT = "CBE-PricePilot/1.0 (+https://pricepilot.local; price-check)";
const MIN_DOMAIN_GAP_MS = 2000;
const FETCH_TIMEOUT_MS = 15000;

export type Availability = "in_stock" | "out_of_stock" | "limited" | "preorder" | "unknown";

export type ExtractedOffer = {
  url: string;
  title: string | null;
  priceTnd: number;
  availability: Availability;
  imageUrl: string | null;
  source: "meta" | "jsonld" | "pricebox";
  /** Set when a reference was passed: whether it appears in the page's text (title, SKU, specs...). */
  referenceOnPage?: boolean;
  /** Price comparators (Primini): every shop's offer on the page, and the shop behind priceTnd. */
  sellerOffers?: SellerOffer[];
  seller?: string;
};

export type SellerOffer = { seller: string; priceTnd: number; title: string };

export type ExtractResult = { ok: true; offer: ExtractedOffer } | { ok: false; error: string; classification: "blocked" | "network" | "parse" | "no_other_seller" };

// ---------- robots.txt ----------

type RobotsRules = { disallow: string[]; allow: string[] };
const robotsCache = new Map<string, { rules: RobotsRules; fetchedAt: number }>();

function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [] };
  let applies = false;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      const matches = agent === "*" || agent.includes("pricepilot");
      applies = lastWasAgent ? applies || matches : matches;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies || !value) continue;
    if (key === "disallow") rules.disallow.push(value);
    if (key === "allow") rules.allow.push(value);
  }
  return rules;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < 6 * 3600 * 1000) return cached.rules;
  let rules: RobotsRules = { disallow: [], allow: [] };
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`);
    if (res.ok) rules = parseRobots(await res.text());
  } catch {
    // Unreachable robots.txt: treat as no restrictions, like standard crawlers.
  }
  robotsCache.set(origin, { rules, fetchedAt: Date.now() });
  return rules;
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  const rules = await robotsFor(u.origin);
  const path = u.pathname + u.search;
  const longest = (list: string[]) => list.filter((p) => patternMatches(p, path)).reduce((max, p) => Math.max(max, p.length), -1);
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  return disallow < 0 || allow >= disallow;
}

// ---------- fetching ----------

const lastHit = new Map<string, number>();

export async function politeDelay(host: string) {
  const wait = (lastHit.get(host) ?? 0) + MIN_DOMAIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

export async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "fr-TN,fr;q=0.9,en;q=0.6" },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- parsing ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function metaContent(html: string, key: string): string | null {
  const esc = key.replace(/[.:]/g, "\\$&");
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${esc}["'][^>]*content=["']([^"']*)["']`, "i"));
  if (a) return decodeEntities(a[1]);
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${esc}["']`, "i"));
  return b ? decodeEntities(b[1]) : null;
}

function parsePrice(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[^\d.,]/g, "");
  if (!s) return null;
  // "1.299,000" -> 1299.000 ; "1 299,9" -> 1299.9 ; "1299.000" stays
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function normaliseAvailability(raw: string | null | undefined): Availability {
  if (!raw) return "unknown";
  const s = raw.toLowerCase();
  if (/preorder|pre-order|précommande|precommande/.test(s)) return "preorder";
  if (/outofstock|out of stock|out_of_stock|épuisé|epuise|rupture|indisponible|soldout/.test(s)) return "out_of_stock";
  if (/limited|limitedavailability|stock limité/.test(s)) return "limited";
  if (/instock|in stock|in_stock|en stock|disponible|onlineonly|instoreonly/.test(s)) return "in_stock";
  return "unknown";
}

function jsonLdProduct(html: string): { price: number | null; availability: string | null; name: string | null; image: string | null } | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const queue: unknown[] = Array.isArray(data) ? [...data] : [data];
    while (queue.length) {
      const node = queue.shift() as Record<string, unknown> | null;
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node["@graph"])) queue.push(...(node["@graph"] as unknown[]));
      const type = node["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      const offersRaw = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
      const price = parsePrice((offer?.price ?? offer?.lowPrice) as string | undefined);
      const image = Array.isArray(node.image) ? String(node.image[0]) : typeof node.image === "string" ? node.image : null;
      return { price, availability: (offer?.availability as string) ?? null, name: (node.name as string) ?? null, image };
    }
  }
  return null;
}

export function extractFromHtml(html: string, url: string): ExtractedOffer | null {
  const title = metaContent(html, "og:title") ?? decodeEntities(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "") ?? null;
  const imageUrl = metaContent(html, "og:image");
  const availabilityRaw =
    metaContent(html, "product:availability") ??
    html.match(/itemprop=["']availability["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
    html.match(/href=["'](https?:\/\/schema\.org\/[A-Za-z]+)["'][^>]*itemprop=["']availability["']/i)?.[1] ??
    html.match(/class=["']stock[^"']*["'][^>]*>\s*<span>([^<]+)/i)?.[1] ??
    null;

  // 1. Open Graph / product meta (PrestaShop, Magento, Shopify...)
  const metaPrice = parsePrice(metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount"));
  // 2. Microdata itemprop="price" content="..."
  const microPrice = parsePrice(html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i)?.[1]);
  if (metaPrice ?? microPrice) {
    return { url, title: title || null, priceTnd: (metaPrice ?? microPrice)!, availability: normaliseAvailability(availabilityRaw), imageUrl, source: "meta" };
  }

  // 3. JSON-LD Product
  const ld = jsonLdProduct(html);
  if (ld?.price) {
    return { url, title: ld.name ?? title ?? null, priceTnd: ld.price, availability: normaliseAvailability(ld.availability ?? availabilityRaw), imageUrl: ld.image ?? imageUrl, source: "jsonld" };
  }

  // 4. Magento price box inside the main product block
  const mainAt = html.indexOf("product-info-main");
  if (mainAt >= 0) {
    const box = html.slice(mainAt, mainAt + 40000).match(/data-price-type=["']finalPrice["'][^>]*data-price-amount=["']([^"']+)["']|data-price-amount=["']([^"']+)["']/i);
    const price = parsePrice(box?.[1] ?? box?.[2]);
    if (price) return { url, title: title || null, priceTnd: price, availability: normaliseAvailability(availabilityRaw), imageUrl, source: "pricebox" };
  }
  return null;
}

// ---------- public entry point ----------

function networkErrorFr(error: unknown): string {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/abort|timeout/i.test(msg)) return "Délai de réponse dépassé";
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(msg)) return "Site injoignable (DNS)";
  if (/ECONNREFUSED|ECONNRESET|socket/i.test(msg)) return "Connexion interrompue par le site";
  return `Erreur réseau${error instanceof Error && error.message ? ` (${error.message})` : ""}`;
}

export function compactText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Primini offer buttons: aria-label="… Voir l'offre pour <title> à <price> DT chez <shop>"
function comparatorOffers(html: string): SellerOffer[] {
  const out: SellerOffer[] = [];
  for (const m of html.matchAll(/aria-label="[^"]*?Voir l(?:'|&#x27;|&#39;)offre pour ([^"]*?) à ([\d\s.,]+) DT chez ([^"]+)"/g)) {
    const price = parsePrice(m[2]);
    if (price) out.push({ title: decodeEntities(m[1]), priceTnd: price, seller: decodeEntities(m[3]) });
  }
  return out;
}

function sellerKey(name: string): string {
  return compactText(name);
}

export async function fetchLiveOffer(url: string, opts?: { reference?: string; excludeSellers?: string[] }): Promise<ExtractResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return { ok: false, error: "URL invalide", classification: "parse" };
  }
  if (!(await isAllowedByRobots(url))) {
    return { ok: false, error: "Cette URL est interdite par le fichier robots.txt du site", classification: "blocked" };
  }
  await politeDelay(parsed.host);
  let res: Response;
  try {
    res = await fetchWithTimeout(url);
  } catch (error) {
    return { ok: false, error: networkErrorFr(error), classification: "network" };
  }
  if (res.status === 403 || res.status === 429) return { ok: false, error: `HTTP ${res.status} (accès refusé ou trop de requêtes)`, classification: "blocked" };
  if (res.status === 404 || res.status === 410) return { ok: false, error: `HTTP ${res.status} (page produit supprimée)`, classification: "parse" };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, classification: "network" };
  const html = await res.text();
  if (/captcha|cf-challenge|challenge-platform/i.test(html.slice(0, 20000)) && !/product:price:amount/.test(html)) {
    return { ok: false, error: "La page affiche une protection anti-robot (non contournée)", classification: "blocked" };
  }
  const offer = extractFromHtml(html, res.url || url);
  if (!offer) return { ok: false, error: "Aucun prix trouvé sur la page (est-ce bien une page produit ?)", classification: "parse" };
  const sellers = comparatorOffers(html);
  if (sellers.length) {
    // Comparator page: report the cheapest shop that is neither us nor a competitor we already track.
    const excluded = (opts?.excludeSellers ?? []).map(sellerKey).filter(Boolean);
    const others = sellers.filter((o) => !excluded.some((x) => sellerKey(o.seller).includes(x) || x.includes(sellerKey(o.seller))));
    offer.sellerOffers = sellers;
    if (!others.length) return { ok: false, error: "Seuls des vendeurs exclus (vous ou les concurrents déjà suivis) proposent ce produit", classification: "no_other_seller" };
    const best = others.reduce((a, b) => (b.priceTnd < a.priceTnd ? b : a));
    offer.priceTnd = best.priceTnd;
    offer.seller = best.seller;
    offer.availability = "in_stock";
  }
  if (opts?.reference) {
    const ref = compactText(opts.reference);
    // Only the product's own identity: title/meta, h1, sku/mpn/reference fields and JSON-LD.
    // The full page is too noisy — related-product carousels mention other references.
    const parts: string[] = [offer.title ?? "", html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""];
    for (const key of ["description", "og:description", "product:retailer_item_id", "product:mfr_part_no"]) parts.push(metaContent(html, key) ?? "");
    parts.push(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
    for (const m of html.matchAll(/itemprop=["'](?:sku|mpn|gtin\d*|productID)["'][^>]*?(?:content=["']([^"']*)["'][^>]*>|>([^<]*))/gi)) parts.push(m[1] ?? m[2] ?? "");
    for (const m of html.matchAll(/(?:r[ée]f[ée]rence|sku|mpn|part number|ref\.?)\s*(?:<[^>]+>\s*)*:?\s*(?:<[^>]+>\s*)*([A-Za-z0-9][A-Za-z0-9 ._\/-]{2,40})/gi)) parts.push(m[1]);
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) if (/"Product"/.test(m[1])) parts.push(m[1]);
    const text = compactText(decodeEntities(parts.join(" ").replace(/<[^>]+>/g, " ")));
    offer.referenceOnPage = ref.length >= 3 && text.includes(ref);
  }
  return { ok: true, offer };
}

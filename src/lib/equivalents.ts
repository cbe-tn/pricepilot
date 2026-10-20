// Equivalent products: a client asks for a reference we do not sell (or have out of stock); we look up
// what that reference is (our catalogue, supplier price lists, competitor offers and catalogue index),
// read its type and characteristics from the title, and rank our own catalogue against it.
// Deterministic (no AI): same product type is required, then shared characteristics, price and stock.

import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { competitorOffers, competitors, products, supplierQuotes, suppliers, type Product } from "@/db/schema";
import { searchCatalog } from "@/lib/catalog";
import { deriveIdentity, isRefToken } from "@/lib/identity";
import { normalizeBarcode, normalizeRef } from "@/lib/matching";
import { median, n } from "@/lib/money";
import { vatRateFor } from "@/lib/tax";

// ---------- characteristics ----------

function plain(s: string): string {
  return ` ${s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9.,"+/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** Product types, most specific first: a consumable "pour imprimante" is a consumable, not a printer. */
const TYPES: Array<[string, RegExp]> = [
  ["Consommable d'impression", / (toner|cartouches?|encres?|bouteilles? d encre|tambour|drum|ruban|tete d impression|kit de maintenance)s? /],
  ["Smartphone", / (smartphone|telephone portable|iphone|galaxy [asmz]\d*|redmi|gsm) /],
  ["Tablette", / (tablette|ipad|galaxy tab|tab [as]\d*) /],
  ["Montre connectée", / (montre|smartwatch|watch) /],
  ["Imprimante", / (imprimante|multifonctions?|photocopieu[rs]e?|copieur|traceur|printer|ecotank|pixma|maxify|laserjet|deskjet|officejet|smart tank) /],
  // Before laptops: an "HP Pavilion all in one" is a desktop although Pavilion is also a laptop series.
  ["PC de bureau", / (pc de bureau|pc bureau|unite centrale|all in one|aio|mini pc|desktop|imac|mac mini) /],
  ["PC portable", / (pc portable|ordinateur portable|laptop|notebook|ultrabook|macbook|ideapad|vivobook|zenbook|thinkpad|probook|elitebook|pavilion|aspire|inspiron|latitude|victus|tuf gaming) /],
  ["PC de bureau", / tour /],
  ["Écran", / (ecran|moniteur|monitor) /],
  ["Téléviseur", / (tv|televiseur|television|smart tv|led tv) /],
  ["Vidéoprojecteur", / (videoprojecteur|video projecteur|projecteur) /],
  ["Vidéosurveillance", / (camera|dvr|nvr|xvr|enregistreur|videosurveillance|dome|bullet) /],
  ["Onduleur", / (onduleur|ups) /],
  ["Stockage", / (ssd|disque dur|hdd|cle usb|carte memoire|micro sd|flash disk) /],
  ["Réseau", / (routeur|switch|point d acces|repeteur|modem|access point) /],
  ["Clavier / souris", / (clavier|souris|mouse|keyboard) /],
  ["Audio", / (casque|ecouteurs?|airpods|enceinte|haut parleur|barre de son|soundbar) /],
  ["Réfrigérateur", / (refrigerateur|frigo|congelateur) /],
  ["Machine à laver", / (machine a laver|lave linge|lave vaisselle) /],
  ["Climatiseur", / (climatiseur|split) /],
  ["Petit électroménager", / (micro ondes?|four|aspirateur|fer a repasser|cafetiere|blender|mixeur|robot|friteuse|bouilloire) /],
];

export function productType(text: string): string | null {
  const t = plain(text);
  return TYPES.find(([, re]) => re.test(t))?.[0] ?? null;
}

type Feature = { key: string; label: string; weight: number };

/** Named characteristics, matched on the plain title. */
const NAMED: Array<[RegExp, string, string, number]> = [
  [/ (wi ?fi|wifi|sans fil|wireless) /, "wifi", "WiFi", 2],
  [/ (ethernet|reseau|lan) /, "ethernet", "Réseau / Ethernet", 1.5],
  [/ (reservoir|ecotank|ink ?tank|megatank|smart tank) /, "reservoir", "Réservoir d'encre", 3],
  [/ laser /, "laser", "Laser", 3],
  [/ (jet d ?encre|inkjet) /, "jet", "Jet d'encre", 3],
  [/ (couleur|color|colour) /, "couleur", "Couleur", 2],
  [/ (monochrome|mono|noir et blanc|n\/b) /, "mono", "Monochrome", 2],
  [/ (recto ?verso|recto\/verso|duplex) /, "duplex", "Recto-verso", 1.5],
  [/ fax /, "fax", "Fax", 1],
  [/ a3 /, "a3", "Format A3", 2],
  [/ (4k|uhd|ultra hd) /, "4k", "4K UHD", 2],
  [/ (full ?hd|fhd|1080p) /, "fhd", "Full HD", 1.5],
  [/ (smart ?tv|android tv|google tv|webos|tizen) /, "smart", "Smart TV", 1.5],
  [/ oled /, "oled", "OLED", 2],
  [/ qled /, "qled", "QLED", 2],
  [/ (gamer|gaming) /, "gaming", "Gaming", 1.5],
  [/ (tactile|touch) /, "touch", "Tactile", 1.5],
  [/ 5g /, "5g", "5G", 1.5],
  [/ (no ?frost) /, "nofrost", "No Frost", 1.5],
  [/ inverter /, "inverter", "Inverter", 1.5],
  [/ inox /, "inox", "Inox", 1],
  [/ (adaptable|compatible) /, "compatible", "Adaptable", 0.5],
];

// Colours never make a product equivalent or not.
const COLOURS = "noir noire blanc blanche gris grise silver black white bk vert verte bleu bleue rouge rose violet jaune orange dore doree gold argent bronze beige marron".split(" ");

const STOP = new Set([
  ..."de du des la le les un une et en avec pour sans par sur au aux a new nouveau original origine garantie an ans tunisie prix promo pc ordinateur produit".split(" "),
  ...COLOURS,
  // Range words ("milieu de gamme") are read as a price band, not as characteristics.
  ..."gamme milieu moyen entree bas haut".split(" "),
]);

/** Characteristics of a title: named features, capacities/specs and remaining series words (low weight). */
export function features(title: string): Feature[] {
  const t = plain(title);
  const out = new Map<string, Feature>();
  const add = (f: Feature) => out.set(f.key, f);
  for (const [re, key, label, weight] of NAMED) if (re.test(t)) add({ key, label, weight });
  const fn = t.match(/ ([2-6]) ?en ?1 /);
  if (fn) add({ key: `${fn[1]}en1`, label: `${fn[1]} en 1`, weight: 2 });
  else if (/ multifonctions? | mfp /.test(t)) add({ key: "3en1", label: "Multifonction", weight: 2 });
  // "i7-1355U", "/i5-9300H": the processor is often glued to its model number.
  const cpu = t.replace(/[/-]/g, " ").match(/ (?:core )?(i[3579]|ultra [579]|ryzen ?[3579]|celeron|pentium|m[1-5](?: pro| max)?) /);
  if (cpu) add({ key: `cpu:${cpu[1].replace(/\s/g, "")}`, label: cpu[1].toUpperCase().replace("RYZEN", "Ryzen "), weight: 2.5 });
  const ram = t.match(/ (\d{1,3}) ?(?:go|gb) ?(?:de )?(?:ram|ddr\d?|memoire) /) ?? t.match(/ (?:ram|memoire) ?(\d{1,3}) ?(?:go|gb) /);
  if (ram) add({ key: `ram:${ram[1]}`, label: `${ram[1]} Go RAM`, weight: 2 });
  const caps = [...t.matchAll(/(?<= )(\d{1,4}) ?(go|gb|to|tb)(?: ?(ssd|hdd|emmc|nvme))?(?= )/g)].map((m) => ({
    raw: m[1],
    gb: /t/.test(m[2]) ? Number(m[1]) * 1000 : Number(m[1]),
    tb: /t/.test(m[2]),
    kind: m[3],
  }));
  // "8Go 512Go SSD": a first small capacity followed by a larger one is the RAM.
  if (!ram && caps.length >= 2 && caps[0].gb <= 64 && !caps[0].kind && caps[1].gb > caps[0].gb) {
    add({ key: `ram:${caps[0].gb}`, label: `${caps[0].gb} Go RAM`, weight: 2 });
    caps.shift();
  }
  for (const c of caps) {
    if (ram && c.raw === ram[1] && !c.kind) continue;
    if (c.gb >= 32 || c.kind) add({ key: `disk:${c.gb}`, label: `${c.raw} ${c.tb ? "To" : "Go"}${c.kind ? ` ${c.kind.toUpperCase()}` : ""}`, weight: 2 });
  }
  // 15.6", 55 pouces, or a bare laptop size such as "15.6" / "13,3".
  const inch = t.match(/ (\d{2}(?:[.,]\d)?) ?(?:"|pouces?|inch|po) /) ?? t.match(/ (1[0-8][.,]\d) /);
  if (inch) add({ key: `inch:${Math.round(Number(inch[1].replace(",", ".")))}`, label: `${inch[1].replace(".", ",")}"`, weight: 2.5 });
  for (const [re, unit, label] of [
    [/ (\d{2,5}) ?w /, "w", "W"],
    [/ (\d{1,4}) ?(?:l|litres?) /, "l", "L"],
    [/ (\d{1,2}) ?kg /, "kg", "kg"],
    [/ (\d{3,5}) ?va /, "va", "VA"],
    [/ (\d{1,2}) ?(?:ch|canaux|voies) /, "ch", "canaux"],
    [/ (\d{1,2}) ?(?:mp|mpx|megapixels?) /, "mp", "MP"],
  ] as Array<[RegExp, string, string]>) {
    const m = t.match(re);
    if (m) add({ key: `${unit}:${m[1]}`, label: `${m[1]} ${label}`, weight: 1.5 });
  }
  // Remaining words (series names such as "pixma", "ideapad"), without brand-free reference codes.
  for (const w of t.trim().split(" ")) {
    if (w.length < 3 || STOP.has(w) || /\d/.test(w) || isRefToken(w)) continue;
    if (!out.has(`w:${w}`)) add({ key: `w:${w}`, label: w, weight: 0.4 });
  }
  return [...out.values()];
}

// ---------- the requested reference ----------

export type TargetSource = { kind: "catalogue" | "fournisseur" | "concurrent" | "index"; label: string; title: string; priceTtc: number | null; url?: string | null };

export type PriceBand = { label: string; lo: number; hi: number };

export type Target = {
  query: string;
  title: string;
  brand: string | null;
  type: string | null;
  category: string | null;
  priceTtc: number | null;
  /** From "entrée / milieu / haut de gamme" when no price is known: a third of our prices for that type. */
  priceBand: PriceBand | null;
  refKey: string;
  features: Feature[];
  sources: TargetSource[];
  /** Our own catalogue entries for this very reference (possibly out of stock). */
  ours: Product[];
};

const COMPATIBLE_RE = /adaptable|compatible|g[ée]n[ée]rique/i;

function productKeys(p: Product): string[] {
  const keys = [normalizeRef(p.manufacturerRef), normalizeRef(p.sku), normalizeBarcode(p.barcode), normalizeRef(p.model), normalizeRef(deriveIdentity(p.name).reference)];
  return keys.filter((k) => k.length >= 4);
}

// ---------- free description ("xiaomi redmi note 10 smartphone android milieu de gamme 64 go vert") ----------

const TIERS: Array<[RegExp, string, number]> = [
  [/ (entree|bas) de gamme | (pas cher|petit prix|economique) /, "Entrée de gamme", 0],
  [/ (milieu|moyen) de gamme /, "Milieu de gamme", 1],
  [/ haut de gamme | (premium|flagship) /, "Haut de gamme", 2],
];

/** Words that describe a kind of product, not a specific model. */
const GENERIC = new Set(
  ("smartphone telephone portable mobile android ios dual sim tablette montre connectee imprimante multifonction multifonctions laser jet encre couleur " +
    "monochrome wifi ecran moniteur tv televiseur smart pc ordinateur laptop notebook bureau gamer gaming tactile reservoir go gb to tb ram ssd hdd stockage " +
    "memoire processeur intel amd core i3 i5 i7 i9 ryzen celeron pentium pouces pouce inch hz gen generation casque souris clavier sans fil bluetooth " +
    "refrigerateur congelateur machine laver climatiseur onduleur camera routeur disque dur cle usb")
    .split(" "),
);

/** Variant words: a "Note 10 Pro" or a "Note 10 5G" is another product than a "Note 10". */
const VARIANTS = new Set("pro plus max ultra lite mini se fe neo prime 5g 4g".split(" "));

const tokens = (text: string) =>
  plain(text)
    .replace(/ \d+(?:[.,]\d+)? ?(?:go|gb|to|tb|"|pouces?|inch|hz|w|l|kg|va|mp|mpx)(?= )/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Brand and model words of a description; empty for a generic request such as "imprimante laser couleur wifi". */
function modelTokens(text: string): string[] {
  let t = plain(text);
  for (const [re] of TIERS) t = t.replace(re, " ");
  const words = tokens(t).filter((w) => !STOP.has(w) && !GENERIC.has(w) && !/^\d+[.,]\d+$/.test(w));
  return words.length >= 2 || words.some(isRefToken) ? words : [];
}

/** The described product itself: every model word, the same variant, and no different capacity. */
function isSameProduct(title: string, model: string[], spec: Feature[]): boolean {
  const words = new Set(tokens(title));
  if (!model.every((w) => words.has(w))) return false;
  if ([...words].some((w) => VARIANTS.has(w) && !model.includes(w))) return false;
  const own = features(title);
  return spec.every((f) => {
    const [kind] = f.key.split(":");
    if (kind !== "disk" && kind !== "ram") return true;
    const theirs = own.filter((o) => o.key.startsWith(`${kind}:`));
    return !theirs.length || theirs.some((o) => o.key === f.key);
  });
}

const ourPrice = (p: Product) => n(p.ownPriceTnd) || n(p.actualSellingPrice) || null;

/**
 * Can be offered to the client now: in our stock file, or shown in stock on our web shop
 * (most of the catalogue has no stock quantity, only the website availability).
 */
export function isAvailable(p: Product): boolean {
  return p.stockQty > 0 || p.ownAvailability === "in_stock";
}

function priceBandFor(text: string, type: string | null, catalog: Product[]): PriceBand | null {
  const t = plain(text);
  const tier = TIERS.find(([re]) => re.test(t));
  if (!tier || !type) return null;
  const prices = catalog
    .filter((p) => !p.isDemo && productType(`${p.category ?? ""} ${p.name}`) === type)
    .map(ourPrice)
    .filter((v): v is number => !!v && v > 0)
    .sort((a, b) => a - b);
  if (prices.length < 6) return null;
  const at = (q: number) => prices[Math.min(prices.length - 1, Math.floor(q * prices.length))];
  const cuts = [prices[0], at(1 / 3), at(2 / 3), prices[prices.length - 1]];
  return { label: tier[1], lo: cuts[tier[2]], hi: cuts[tier[2] + 1] };
}

async function resolveDescription(workspaceId: string, q: string, catalog: Product[]): Promise<Target> {
  const type = productType(q);
  const asked = features(q);
  const spec = asked.filter((f) => !f.key.startsWith("w:"));
  const model = modelTokens(q);
  const sources: TargetSource[] = [];
  let ours: Product[] = [];

  if (model.length) {
    ours = catalog.filter(
      (p) => !p.isDemo && !COMPATIBLE_RE.test(p.name) && (!type || productType(`${p.category ?? ""} ${p.name}`) === type) && isSameProduct(p.name, model, spec),
    );
    for (const p of ours) sources.push({ kind: "catalogue", label: "Notre catalogue", title: p.name, priceTtc: ourPrice(p) });
    const words = model.filter((w) => w.length >= 2).slice(0, 4);
    const [quotes, offers] = await Promise.all([
      db
        .select({ q: supplierQuotes, supplier: suppliers.name })
        .from(supplierQuotes)
        .innerJoin(suppliers, eq(suppliers.id, supplierQuotes.supplierId))
        .where(and(eq(supplierQuotes.workspaceId, workspaceId), ...words.map((w) => ilike(supplierQuotes.productName, `%${w}%`))))
        .limit(40),
      db
        .select({ o: competitorOffers, competitor: competitors.name })
        .from(competitorOffers)
        .innerJoin(competitors, eq(competitors.id, competitorOffers.competitorId))
        .where(and(eq(competitorOffers.workspaceId, workspaceId), eq(competitorOffers.isDemo, false), ...words.map((w) => ilike(competitorOffers.title, `%${w}%`))))
        .limit(40),
    ]);
    for (const { q: quote, supplier } of quotes) {
      const name = quote.productName ?? "";
      if (!isSameProduct(name, model, spec)) continue;
      const ht = n(quote.quotedPrice);
      sources.push({ kind: "fournisseur", label: supplier, title: name, priceTtc: ht ? Math.round(ht * (1 + vatRateFor({ name })) * 1000) / 1000 : null });
    }
    for (const { o, competitor } of offers) {
      if (o.userReview === "reject" || o.isCompatible || !isSameProduct(o.title, model, spec)) continue;
      sources.push({ kind: "concurrent", label: o.sellerName || competitor, title: o.title, priceTtc: n(o.priceTnd) || null, url: o.url });
    }
  }

  // The client's words are the request; our own listing of that very product may add specs (RAM…).
  const merged = new Map(asked.map((f) => [f.key, f]));
  for (const p of ours.slice(0, 1)) for (const f of features(p.name)) if (!f.key.startsWith("w:") && !merged.has(f.key)) merged.set(f.key, f);
  const prices = sources.map((s) => s.priceTtc).filter((v): v is number => !!v && v > 0);
  const priceTtc = prices.length ? median(prices) : null;
  return {
    query: q,
    title: q,
    brand: deriveIdentity(q).brand,
    type,
    category: ours.find((p) => p.category)?.category ?? null,
    priceTtc,
    priceBand: priceTtc ? null : priceBandFor(q, type, catalog),
    refKey: "",
    features: [...merged.values()],
    sources,
    ours,
  };
}

/** Three words or more is a description; fewer is a reference or a short name. */
const isDescription = (q: string) => q.split(/\s+/).filter(Boolean).length >= 3;

export async function resolveTarget(workspaceId: string, query: string, catalog: Product[]): Promise<Target> {
  const q = query.trim();
  if (isDescription(q)) return resolveDescription(workspaceId, q, catalog);
  const refKey = normalizeRef(q);
  const like = `%${q}%`;
  const sources: TargetSource[] = [];

  // By reference, or by name ("Canon G3410" in "imprimante jet dencre canon pixma g3410 a4…").
  const model = modelTokens(q);
  const ours = catalog.filter(
    (p) => !COMPATIBLE_RE.test(p.name) && ((refKey.length >= 4 && productKeys(p).includes(refKey)) || (model.length > 0 && !p.isDemo && isSameProduct(p.name, model, []))),
  );
  for (const p of ours) {
    const price = n(p.ownPriceTnd) || n(p.actualSellingPrice) || null;
    sources.push({ kind: "catalogue", label: "Notre catalogue", title: p.name, priceTtc: price });
  }

  const [quotes, offers, comps] = await Promise.all([
    db
      .select({ q: supplierQuotes, supplier: suppliers.name })
      .from(supplierQuotes)
      .innerJoin(suppliers, eq(suppliers.id, supplierQuotes.supplierId))
      .where(and(eq(supplierQuotes.workspaceId, workspaceId), or(ilike(supplierQuotes.productRef, like), ilike(supplierQuotes.productName, like))))
      .limit(20),
    db
      .select({ o: competitorOffers, competitor: competitors.name })
      .from(competitorOffers)
      .innerJoin(competitors, eq(competitors.id, competitorOffers.competitorId))
      .where(and(eq(competitorOffers.workspaceId, workspaceId), eq(competitorOffers.isDemo, false), or(ilike(competitorOffers.manufacturerRef, like), ilike(competitorOffers.title, like))))
      .limit(20),
    db.select({ id: competitors.id, name: competitors.name }).from(competitors).where(and(eq(competitors.workspaceId, workspaceId), eq(competitors.enabled, true))),
  ]);
  for (const { q: quote, supplier } of quotes) {
    const name = quote.productName || quote.productRef || q;
    const ht = n(quote.quotedPrice);
    sources.push({ kind: "fournisseur", label: supplier, title: name, priceTtc: ht ? Math.round(ht * (1 + vatRateFor({ name })) * 1000) / 1000 : null });
  }
  for (const { o, competitor } of offers) {
    if (o.userReview === "reject" || o.isCompatible) continue;
    sources.push({ kind: "concurrent", label: o.sellerName || competitor, title: o.title, priceTtc: n(o.priceTnd) || null, url: o.url });
  }
  // Competitor sitemaps: titles only, but they know references we have never seen.
  if (sources.length < 3 && comps.length) {
    const hits = await searchCatalog(comps.map((c) => c.id), q, 2).catch(() => []);
    for (const h of hits.slice(0, 6)) {
      sources.push({ kind: "index", label: comps.find((c) => c.id === h.competitorId)?.name ?? "Concurrent", title: h.slugTitle, priceTtc: null, url: h.url });
    }
  }

  // The most descriptive title wins (our catalogue first), the price is the median of known prices.
  const titled = sources.length ? [...sources].sort((a, b) => Number(b.kind === "catalogue") - Number(a.kind === "catalogue") || features(b.title).length - features(a.title).length)[0].title : q;
  const prices = sources.map((s) => s.priceTtc).filter((v): v is number => !!v && v > 0);
  const merged = new Map<string, Feature>();
  for (const s of [{ title: titled }, ...sources]) for (const f of features(s.title)) if (!merged.has(f.key)) merged.set(f.key, f);
  // Series words only count when they come from the main title (other shops add marketing words).
  const main = new Set(features(titled).map((f) => f.key));
  const feats = [...merged.values()].filter((f) => !f.key.startsWith("w:") || main.has(f.key));
  const category = ours.find((p) => p.category)?.category ?? null;
  return {
    query: q,
    title: titled,
    brand: ours[0]?.brand ?? deriveIdentity(titled).brand,
    type: productType(`${category ?? ""} ${titled}`) ?? productType(sources.map((s) => s.title).join(" ")),
    category,
    priceTtc: prices.length ? median(prices) : null,
    priceBand: null,
    refKey,
    features: feats,
    sources,
    ours,
  };
}

// ---------- ranking our catalogue ----------

const CONFLICTS: Array<[string, string]> = [
  ["couleur", "mono"],
  ["laser", "jet"],
  ["laser", "reservoir"],
  ["4k", "fhd"],
  ["oled", "qled"],
];

const CPU_RANK: Record<string, number> = { celeron: 1, pentium: 2, i3: 3, ryzen3: 3, i5: 5, ryzen5: 5, ultra5: 6, i7: 7, ryzen7: 7, ultra7: 8, i9: 9, ryzen9: 9, ultra9: 10 };

/**
 * How well a candidate covers one requested characteristic: 1 when identical, 0.8 when it offers
 * more (16 Go RAM for 8 Go, 1 To for 512 Go, i7 for i5), 0 otherwise.
 */
function featureMatch(f: Feature, keys: Map<string, Feature>, own: Feature[]): { ratio: number; label: string } {
  if (keys.has(f.key)) return { ratio: 1, label: f.label };
  const [kind, value] = f.key.split(":");
  if (kind === "ram" || kind === "disk") {
    const better = own.find((o) => o.key.startsWith(`${kind}:`) && Number(o.key.split(":")[1]) > Number(value));
    if (better) return { ratio: 0.8, label: `${better.label} (mieux)` };
  }
  if (kind === "cpu" && CPU_RANK[value]) {
    const better = own.find((o) => o.key.startsWith("cpu:") && (CPU_RANK[o.key.slice(4)] ?? 0) > CPU_RANK[value]);
    if (better) return { ratio: 0.8, label: `${better.label} (mieux)` };
  }
  return { ratio: 0, label: f.label };
}

export type Equivalent = {
  product: Product;
  score: number;
  similarity: number;
  priceTtc: number | null;
  priceGap: number | null;
  shared: string[];
  missing: string[];
  sameRef: boolean;
};

export function rankEquivalents(target: Target, catalog: Product[], opts: { inStockOnly: boolean; limit?: number }): Equivalent[] {
  const oursIds = new Set(target.ours.map((p) => p.id));
  const total = target.features.reduce((s, f) => s + f.weight, 0) || 1;
  const out: Equivalent[] = [];
  for (const p of catalog) {
    if (p.archivedAt || oursIds.has(p.id)) continue;
    if (opts.inStockOnly && !isAvailable(p)) continue;
    const text = `${p.name} ${p.description ?? ""}`;
    const type = productType(`${p.category ?? ""} ${p.name}`);
    // Compatible / adaptable consumable carrying the requested reference in its name.
    const sameRef = target.refKey.length >= 4 && normalizeRef(p.name).includes(target.refKey);
    if (!sameRef && target.type && type && type !== target.type) continue;
    if (!sameRef && target.type && !type) continue;
    // A different toner or ink does not fit the client's printer: consumables need the same reference.
    if (!sameRef && target.type === "Consommable d'impression") continue;
    const own = features(text);
    const keys = new Map(own.map((f) => [f.key, f]));
    const shared: string[] = [];
    const missing: string[] = [];
    let got = 0;
    for (const f of target.features) {
      const m = featureMatch(f, keys, own);
      got += f.weight * m.ratio;
      if (f.key.startsWith("w:")) continue;
      if (m.ratio > 0) shared.push(m.label);
      else if (f.weight >= 1.5) missing.push(f.label);
    }
    // Opposite characteristics (colour vs monochrome, laser vs ink tank…) count against the product.
    for (const [a, b] of CONFLICTS) {
      const t = target.features.find((f) => f.key === a || f.key === b);
      const c = t && keys.get(t.key === a ? b : a);
      if (t && c) {
        got -= t.weight;
        missing.push(`${c.label} au lieu de ${t.label}`);
      }
    }
    const similarity = sameRef ? 1 : Math.max(0, got) / total;
    if (!sameRef && similarity < 0.25) continue;
    const priceTtc = ourPrice(p);
    const band = target.priceBand;
    // Inside the requested range counts as the right price; outside, the distance to the nearest edge.
    const priceGap = !priceTtc
      ? null
      : target.priceTtc
        ? priceTtc / target.priceTtc - 1
        : band
          ? priceTtc < band.lo
            ? priceTtc / band.lo - 1
            : priceTtc > band.hi
              ? priceTtc / band.hi - 1
              : 0
          : null;
    // Characteristics first; a price far from the requested product lowers the rank by up to 30 %.
    let score = 100 * similarity * (priceGap === null ? 0.9 : 1 - Math.min(0.3, Math.abs(priceGap) * 0.4));
    if (isAvailable(p)) score += 8;
    if (target.category && p.category === target.category) score += 5;
    // A brand the client named (or the requested product's brand) ranks ahead of other brands.
    if (target.brand && (p.brand ?? deriveIdentity(p.name).brand)?.toLowerCase() === target.brand.toLowerCase()) score += 8;
    out.push({
      product: p,
      score,
      similarity,
      priceTtc,
      priceGap,
      shared,
      missing,
      sameRef,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 20);
}

export async function findEquivalents(workspaceId: string, query: string, inStockOnly: boolean) {
  const catalog = await db.select().from(products).where(and(eq(products.workspaceId, workspaceId), isNull(products.archivedAt)));
  const target = await resolveTarget(workspaceId, query, catalog);
  return { target, equivalents: rankEquivalents(target, catalog, { inStockOnly }) };
}

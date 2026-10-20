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
  ["PC portable", / (pc portable|ordinateur portable|laptop|notebook|ultrabook|macbook|ideapad|vivobook|zenbook|thinkpad|probook|elitebook|pavilion|aspire|inspiron|latitude|victus|tuf gaming) /],
  ["PC de bureau", / (pc de bureau|pc bureau|unite centrale|all in one|aio|mini pc|desktop|imac|mac mini|tour) /],
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
  [/ (jet d encre|inkjet) /, "jet", "Jet d'encre", 3],
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

const STOP = new Set(
  "de du des la le les un une et en avec pour sans par sur au aux a noir blanc gris silver black white bk new nouveau original origine garantie an ans tunisie prix promo pc ordinateur produit".split(" "),
);

/** Characteristics of a title: named features, capacities/specs and remaining series words (low weight). */
export function features(title: string): Feature[] {
  const t = plain(title);
  const out = new Map<string, Feature>();
  const add = (f: Feature) => out.set(f.key, f);
  for (const [re, key, label, weight] of NAMED) if (re.test(t)) add({ key, label, weight });
  const fn = t.match(/ ([2-6]) ?en ?1 /);
  if (fn) add({ key: `${fn[1]}en1`, label: `${fn[1]} en 1`, weight: 2 });
  else if (/ multifonctions? | mfp /.test(t)) add({ key: "3en1", label: "Multifonction", weight: 2 });
  const cpu = t.match(/ (?:core )?(i[3579]|ultra [579]|ryzen ?[3579]|celeron|pentium|m[1-5](?: pro| max)?) /);
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

export type Target = {
  query: string;
  title: string;
  brand: string | null;
  type: string | null;
  category: string | null;
  priceTtc: number | null;
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

export async function resolveTarget(workspaceId: string, query: string, catalog: Product[]): Promise<Target> {
  const q = query.trim();
  const refKey = normalizeRef(q);
  const like = `%${q}%`;
  const sources: TargetSource[] = [];

  const ours = refKey.length >= 4 ? catalog.filter((p) => productKeys(p).includes(refKey) && !COMPATIBLE_RE.test(p.name)) : [];
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
    if (opts.inStockOnly && p.stockQty <= 0) continue;
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
    const priceTtc = n(p.ownPriceTnd) || n(p.actualSellingPrice) || null;
    const priceGap = priceTtc && target.priceTtc ? priceTtc / target.priceTtc - 1 : null;
    // Characteristics first; a price far from the requested product lowers the rank by up to 30 %.
    let score = 100 * similarity * (priceGap === null ? 0.9 : 1 - Math.min(0.3, Math.abs(priceGap) * 0.4));
    if (p.stockQty > 0) score += 8;
    if (target.category && p.category === target.category) score += 5;
    if (target.brand && p.brand && p.brand.toLowerCase() === target.brand.toLowerCase()) score += 3;
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

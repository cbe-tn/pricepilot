// Marketing Studio rules shared by the browser (live preview) and the server (validation before export).
// Commercial values never come from free text: prices are read from the catalogue facts below, and the
// only number the user types is the promo price, which is checked against the 3 % margin floor.

import { eventById, isoDay } from "./events";

/** Design space of the templates (a 1080 square); other formats are laid out from it. */
export const POSTER_SIZE = 1080;

export type PosterFormat = "post" | "portrait" | "story" | "hero" | "strip" | "promo" | "a4";
export const FORMATS: Array<{ value: PosterFormat; label: string; group: string; w: number; h: number }> = [
  { value: "post", label: "Publication carrée", group: "Réseaux sociaux", w: 1080, h: 1080 },
  { value: "portrait", label: "Publication portrait 4:5", group: "Réseaux sociaux", w: 1080, h: 1350 },
  { value: "story", label: "Story / Reel", group: "Réseaux sociaux", w: 1080, h: 1920 },
  { value: "hero", label: "Bannière d’accueil du site", group: "Site web", w: 1920, h: 600 },
  { value: "strip", label: "Bandeau large du site", group: "Site web", w: 2000, h: 400 },
  { value: "promo", label: "Bloc promo du site", group: "Site web", w: 1200, h: 600 },
  { value: "a4", label: "Affiche A4 (impression)", group: "Impression", w: 1240, h: 1754 },
];
export function formatSize(f: PosterFormat | undefined): { w: number; h: number } {
  const hit = FORMATS.find((x) => x.value === f) ?? FORMATS[0];
  return { w: hit.w, h: hit.h };
}
/** square · wide (website banners) · tall (portrait, story, A4): decides the automatic arrangement. */
export function formatFamily(f: PosterFormat | undefined): "square" | "wide" | "tall" {
  const { w, h } = formatSize(f);
  const r = w / h;
  return r > 1.6 ? "wide" : r < 0.9 ? "tall" : "square";
}
export const MAX_POSTER_PRODUCTS = 4;
/** A numedia.tn price older than this is flagged before it is printed as the crossed-out price. */
export const OWN_PRICE_MAX_AGE_DAYS = 3;

export type PosterLang = "fr" | "ar" | "bi";
export type PosterTheme = "studio" | "promo" | "premium" | "podium" | "neon" | "split" | "flash" | "minimal" | "aurora" | "scene";
export type PosterBrand = "numedia" | "cbe";
export type PosterElement = "title" | "products" | "price" | "benefits";

/** Catalogue facts for one product, as loaded from PricePilot (never edited on the client). */
export type PosterProduct = {
  id: string;
  name: string;
  ref: string | null;
  category: string | null;
  stockQty: number;
  /** numedia.tn listing: found = same article · review = probable, to confirm · missing = not online. */
  ownStatus: string | null;
  ownUrl: string | null;
  /** Live price on numedia.tn (TTC), the verified reference for the crossed-out price. */
  ownPrice: number | null;
  ownCheckedAt: string | null;
  /** Purchase cost TTC, as in the benchmark sheet; 0 when unknown. */
  costTtc: number;
  minMargin: number;
  /** Official photo available (only for articles confirmed on numedia.tn). */
  hasPhoto: boolean;
  competitors: Array<{ name: string; price: number; availability: string; url: string | null; checkedAt: string; matchClass: string }>;
};

/** Offset from the template position, uniform scale and rotation (degrees) of a built-in element. */
export type ElementLayout = { dx: number; dy: number; scale: number; rot?: number };

/** Built-in elements that can be hidden from the layers panel (products and price always show). */
export type HideableElement = "title" | "benefits" | "tag" | "logo" | "footer";
export const HIDEABLE: HideableElement[] = ["title", "benefits", "tag", "logo", "footer"];

export const MAX_LAYERS = 24;
/** marketing_assets.prompt of a picture uploaded in the studio (AI scenes hold their prompt). */
export const UPLOAD_PREFIX = "upload:";
/** marketing_assets.prompt of an AI picture made to be placed as a layer ("ai-image:<label>|<prompt>"). */
export const AI_IMAGE_PREFIX = "ai-image:";
export type LayerKind = "image" | "text" | "shape";
export type ShapeKind = "rect" | "ellipse" | "burst" | "ribbon" | "line";
export type LayerFont = "latin" | "display" | "serif" | "arabic";
/** Uploaded pictures are stored for the workspace and served from our origin (the PNG stays exportable). */
export const LAYER_SRC = /^\/api\/marketing\/image\?asset=[0-9a-f-]{36}$/i;

/**
 * Free layer added in the editor (picture, text or shape). x / y are the centre, in poster pixels.
 * Fields that do not apply to a kind are simply ignored.
 */
export type PosterLayer = {
  id: string;
  kind: LayerKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Drawn under the template content (behind products, title and price) instead of on top. */
  behind: boolean;
  shadow: boolean;
  // Picture
  src?: string;
  flipX?: boolean;
  radius?: number;
  /** Remove a plain white background (same cut-out as the product photos). */
  removeBg?: boolean;
  // Text
  text?: string;
  font?: LayerFont;
  size?: number;
  weight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  uppercase?: boolean;
  /** Bar behind the text, "" for none. */
  bg?: string;
  // Shape (and outline for text)
  shape?: ShapeKind;
  fill?: string;
  /** Second gradient colour, "" for a flat fill. */
  fill2?: string;
  stroke?: string;
  strokeW?: number;
};

export type PosterDesign = {
  /** Output size (social post, website banner, A4…). */
  format: PosterFormat;
  brand: PosterBrand;
  lang: PosterLang;
  theme: PosterTheme;
  /** Accent colour, picked from BRAND_COLORS only. */
  accent: string;
  title: string;
  titleAr: string;
  subtitle: string;
  subtitleAr: string;
  /** Short promo tag (PROMO, EXCLUSIF…). */
  tag: string;
  tagAr: string;
  /** Up to three product advantages typed by the user; empty by default (never invented). */
  benefits: string[];
  benefitsAr: string[];
  cta: string;
  ctaAr: string;
  footer: string;
  /** ISO date (yyyy-mm-dd) or "" when the offer has no end date. */
  validUntil: string;
  /** Price printed on the poster (TTC). Required for a pack; defaults to the numedia.tn price for one product. */
  promoPrice: number | null;
  showOldPrice: boolean;
  showDiscount: boolean;
  productOrder: string[];
  layout: Record<PosterElement, ElementLayout>;
  /** Tunisian commercial event (id from TN_EVENTS) or "" for none: decoration and legal checks. */
  event: string;
  /** Background of the "Scène IA" style: an AI scene stored for the workspace (older designs may hold a CC0 stock photo). */
  scene: PosterScene | null;
  /** Mirror reflection of the product on the surface (realistic scene style). */
  reflection: boolean;
  /** Each product photo moved / resized on its own, inside the products block (key = product id). */
  productLayout: Record<string, ElementLayout>;
  hidden: HideableElement[];
  /** Free layers (pictures, texts, shapes), bottom first. */
  layers: PosterLayer[];
};

export type PosterScene = { url: string; thumb: string; title: string; creator: string; landing: string };

export const BRAND_COLORS = [
  { value: "#e30613", label: "Rouge NUMEDIA" },
  { value: "#e52a2f", label: "Rouge CBE" },
  { value: "#a51e35", label: "Bordeaux CBE" },
  { value: "#0b4a56", label: "Bleu PricePilot" },
  { value: "#111111", label: "Noir" },
] as const;

export const THEMES: Array<{ value: PosterTheme; label: string }> = [
  { value: "studio", label: "Studio clair" },
  { value: "promo", label: "Promo jaune" },
  { value: "premium", label: "Premium sombre" },
  { value: "podium", label: "Podium 3D" },
  { value: "neon", label: "Néon tech" },
  { value: "split", label: "Diagonale" },
  { value: "flash", label: "Vente flash" },
  { value: "minimal", label: "Éditorial" },
  { value: "aurora", label: "Aurora" },
  { value: "scene", label: "Scène IA" },
];

const DEFAULT_LAYOUT: Record<PosterElement, ElementLayout> = {
  title: { dx: 0, dy: 0, scale: 1 },
  products: { dx: 0, dy: 0, scale: 1 },
  price: { dx: 0, dy: 0, scale: 1 },
  benefits: { dx: 0, dy: 0, scale: 1 },
};

// Words that describe the kind of product, used for the default headline ("FER À VAPEUR", "IMPRIMANTE").
function splitName(name: string): { kind: string; rest: string } {
  const words = name.trim().split(/\s+/);
  // The kind ends at the first word that looks like a brand/model (has a digit or is fully upper case).
  let cut = words.findIndex((w, i) => i > 0 && (/\d/.test(w) || (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w))));
  if (cut < 0) cut = Math.min(2, words.length);
  return { kind: words.slice(0, cut).join(" "), rest: words.slice(cut).join(" ") };
}

export function defaultDesign(products: PosterProduct[], opts: { brand: PosterBrand; lang: PosterLang; website?: string | null; phone?: string | null }): PosterDesign {
  const single = products.length === 1;
  const first = products[0] ? splitName(products[0].name) : { kind: "", rest: "" };
  const site = (opts.website ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    format: "post",
    brand: opts.brand,
    lang: opts.lang,
    theme: "studio",
    accent: opts.brand === "cbe" ? "#e52a2f" : "#e30613",
    title: single ? first.kind.toUpperCase() : "PACK",
    // Default Arabic copy is Tunisian derja, as spoken by NUMEDIA's customers (editable).
    titleAr: single ? "فرصة ما تتفلتش" : "باك بسوم باهي",
    subtitle: single ? first.rest : products.map((p) => splitName(p.name).kind).join(" + "),
    subtitleAr: "",
    tag: "PROMO",
    tagAr: "بروموسيون",
    benefits: [],
    benefitsAr: [],
    cta: "Commandez maintenant",
    ctaAr: "كوموندي توّا",
    footer: [site, opts.phone].filter(Boolean).join("  ·  "),
    validUntil: "",
    promoPrice: single && products[0]?.ownPrice ? products[0].ownPrice : null,
    showOldPrice: true,
    showDiscount: false,
    productOrder: products.map((p) => p.id),
    layout: structuredClone(DEFAULT_LAYOUT),
    event: "",
    scene: null,
    reflection: true,
    productLayout: {},
    hidden: [],
    layers: [],
  };
}

/** Fills fields missing from a design saved by an older version, so the editor never crashes on it. */
export function normalizeDesign(raw: Partial<PosterDesign>, products: PosterProduct[]): PosterDesign {
  const base = defaultDesign(products, { brand: raw.brand ?? "numedia", lang: raw.lang ?? "fr" });
  const ids = new Set(products.map((p) => p.id));
  const order = (raw.productOrder ?? []).filter((id) => ids.has(id));
  for (const p of products) if (!order.includes(p.id)) order.push(p.id);
  return {
    ...base,
    ...raw,
    benefits: (raw.benefits ?? []).slice(0, 3),
    benefitsAr: (raw.benefitsAr ?? []).slice(0, 3),
    accent: BRAND_COLORS.some((c) => c.value === raw.accent) ? raw.accent! : base.accent,
    theme: THEMES.some((t) => t.value === raw.theme) ? raw.theme! : base.theme,
    format: FORMATS.some((f) => f.value === raw.format) ? raw.format! : "post",
    productOrder: order,
    layout: { ...structuredClone(DEFAULT_LAYOUT), ...(raw.layout ?? {}) },
    productLayout: Object.fromEntries(Object.entries(raw.productLayout ?? {}).filter(([id]) => ids.has(id))),
    hidden: (raw.hidden ?? []).filter((h) => HIDEABLE.includes(h)),
    layers: Array.isArray(raw.layers) ? raw.layers.slice(0, MAX_LAYERS) : [],
  };
}

/** A price or a discount typed in a free text ("499 DT", "-20 %", "٤٩٩ د.ت"): only the checked price block may show them. */
export const PRICE_LIKE = /\d[\d\s.,]*\s*(dt\b|dinars?\b|tnd\b|د\.?\s?ت|دينار|%)|%\s*\d/i;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);
/** Only references confirmed equivalent are compared. */
const comparable = (c: PosterProduct["competitors"][number]) => (c.matchClass === "exact" || c.matchClass === "strong") && c.availability !== "out_of_stock";

export type PosterPricing = {
  /** Price printed in large type. */
  price: number | null;
  /** Crossed-out price (sum of verified numedia.tn prices), null when it cannot be justified. */
  oldPrice: number | null;
  discountPct: number | null;
  /** Lowest price allowed by the minimum margin; null when a purchase cost is missing. */
  floor: number | null;
  marginPct: number | null;
};

export type PosterCheck = { errors: string[]; warnings: string[]; pricing: PosterPricing };

/** Every rule of the "Règles impératives de fiabilité commerciale"; the server runs it again before export. */
export function checkPoster(design: PosterDesign, products: PosterProduct[]): PosterCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!products.length) errors.push("Sélectionnez au moins un produit.");
  if (products.length > MAX_POSTER_PRODUCTS) errors.push(`Une affiche contient au plus ${MAX_POSTER_PRODUCTS} produits.`);

  for (const p of products) {
    if (p.stockQty <= 0) errors.push(`${p.name} : en rupture de stock — il ne peut pas être promu comme disponible.`);
    if (!p.hasPhoto) errors.push(`${p.name} : pas de photo officielle (article non confirmé sur numedia.tn).`);
    if (p.ownStatus === "review") warnings.push(`${p.name} : l'article numedia.tn est à confirmer — son prix n'est pas utilisé comme prix barré.`);
  }

  const verified = products.filter((p) => p.ownStatus === "found" && p.ownPrice != null && p.ownPrice > 0);
  const allVerified = products.length > 0 && verified.length === products.length;
  const oldReference = allVerified ? round3(verified.reduce((s, p) => s + p.ownPrice!, 0)) : null;
  for (const p of verified) {
    const age = daysSince(p.ownCheckedAt);
    if (age > OWN_PRICE_MAX_AGE_DAYS) warnings.push(`${p.name} : prix numedia.tn vérifié il y a ${Math.floor(age)} jours.`);
  }

  const price = design.promoPrice != null && design.promoPrice > 0 ? round3(design.promoPrice) : null;
  if (price == null) {
    errors.push(products.length > 1 ? "Saisissez le prix du pack." : "Saisissez le prix de vente affiché.");
  }

  const costKnown = products.length > 0 && products.every((p) => p.costTtc > 0);
  const cost = round3(products.reduce((s, p) => s + p.costTtc, 0));
  const minMargin = Math.max(0, ...products.map((p) => p.minMargin));
  const floor = costKnown ? Math.ceil((cost / (1 - minMargin)) * 1000) / 1000 : null;
  if (!costKnown) warnings.push("Coût d'achat manquant pour au moins un produit : la marge minimale ne peut pas être vérifiée.");
  if (price != null && floor != null && price < floor) {
    errors.push(`Prix ${fmt(price)} DT sous le plancher de marge (${fmt(floor)} DT pour ${Math.round(minMargin * 100)} % de marge).`);
  }

  let oldPrice: number | null = null;
  if (design.showOldPrice && price != null) {
    if (oldReference == null) warnings.push("Prix barré masqué : il faut le prix numedia.tn confirmé de chaque produit.");
    else if (oldReference < price) warnings.push("Le prix affiché est supérieur au prix numedia.tn : pas de prix barré.");
    else if (oldReference > price) oldPrice = oldReference;
  }
  const discountPct = design.showDiscount && oldPrice != null && price != null ? Math.round((1 - price / oldPrice) * 100) : null;

  const ev = eventById(design.event);
  if (ev?.note) warnings.push(`${ev.label} : ${ev.note}`);
  // Official sales (soldes): at least 20 % off a verified previous price (loi n° 40 de 1998).
  if (ev?.sales && price != null) {
    if (oldPrice == null) errors.push("Soldes : il faut afficher un prix barré vérifié (prix numedia.tn confirmé, supérieur au prix soldé).");
    else {
      // Rounded to 0.01 % so an exact 20 % is not rejected by floating-point error (19.999…).
      const real = Math.round((1 - price / oldPrice) * 10_000) / 100;
      if (real < 20) errors.push(`Soldes : la remise minimale légale est de 20 % (ici ${real.toLocaleString("fr-FR")} %).`);
    }
  }
  for (const l of design.layers) {
    if (l.kind === "text" && l.visible && PRICE_LIKE.test(l.text ?? "")) {
      errors.push(`Calque « ${l.name} » : les prix et les remises s'affichent uniquement dans le bloc Prix (vérifié sur le catalogue).`);
    }
  }
  if (design.layers.some((l) => l.kind === "image" && l.visible && !LAYER_SRC.test(l.src ?? ""))) errors.push("Une image ajoutée n'est pas enregistrée dans le studio : importez-la à nouveau.");

  if (design.theme === "scene" && !design.scene) errors.push("Générez une scène IA (ou choisissez-en une déjà générée) pour le style « Scène IA ».");

  if (!design.hidden.includes("title") && !(design.lang === "ar" ? design.titleAr : design.title).trim()) errors.push("Le titre de l'affiche est vide.");
  if (design.validUntil && new Date(design.validUntil).getTime() < new Date(new Date().toDateString()).getTime()) {
    errors.push("La date de fin de l'offre est déjà passée.");
  }

  return {
    errors,
    warnings,
    pricing: {
      price,
      oldPrice,
      discountPct: discountPct && discountPct > 0 ? discountPct : null,
      floor,
      marginPct: price != null && costKnown ? round3((price - cost) / price) : null,
    },
  };
}

export type ScoreWeights = { price: number; margin: number; stock: number; data: number };
export const DEFAULT_WEIGHTS: ScoreWeights = { price: 35, margin: 25, stock: 20, data: 20 };

export type ProductScore = {
  score: number;
  parts: Record<keyof ScoreWeights, number>;
  cheapest: { name: string; price: number; checkedAt: string } | null;
  marginPct: number | null;
  flags: string[];
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Transparent "opportunité marketing" score (0–100) from data that actually exists; gaps are flagged, not filled. */
export function scoreProduct(p: PosterProduct, w: ScoreWeights = DEFAULT_WEIGHTS): ProductScore {
  const flags: string[] = [];
  const offers = p.competitors.filter(comparable).sort((a, b) => a.price - b.price);
  const cheapest = offers[0] ?? null;
  const own = p.ownStatus === "found" ? p.ownPrice : null;

  let price = 0;
  if (own == null) flags.push("Pas de prix numedia.tn confirmé");
  else if (!cheapest) {
    price = 0.5;
    flags.push("Aucun concurrent comparable");
  } else {
    // 1 when we are ≥ 5 % cheaper than the cheapest competitor, 0 when ≥ 15 % dearer.
    price = clamp01((cheapest.price / own - 0.85) / 0.2);
  }
  if (p.competitors.some((c) => !comparable(c) && c.availability !== "out_of_stock")) flags.push("Correspondance concurrente à vérifier");
  if (offers.some((c) => daysSince(c.checkedAt) > 2)) flags.push("Prix concurrent ancien");

  let marginPct: number | null = null;
  let margin = 0;
  if (own != null && p.costTtc > 0) {
    marginPct = (own - p.costTtc) / own;
    margin = marginPct < p.minMargin ? 0 : clamp01(marginPct / 0.25);
    if (marginPct < p.minMargin) flags.push("Marge sous le minimum");
  } else if (p.costTtc <= 0) flags.push("Coût d'achat manquant");

  const stock = p.stockQty <= 0 ? 0 : p.stockQty >= 10 ? 1 : 0.4 + 0.06 * p.stockQty;
  if (p.stockQty <= 0) flags.push("Rupture");

  const data =
    (p.hasPhoto ? 0.4 : 0) + (own != null && daysSince(p.ownCheckedAt) <= OWN_PRICE_MAX_AGE_DAYS ? 0.3 : 0) + (offers.length ? 0.3 : 0);
  if (!p.hasPhoto) flags.push("Pas de photo officielle");

  const total = w.price + w.margin + w.stock + w.data || 1;
  const score = Math.round(((price * w.price + margin * w.margin + stock * w.stock + data * w.data) / total) * 100);
  return {
    score,
    parts: { price, margin, stock, data },
    cheapest: cheapest ? { name: cheapest.name, price: cheapest.price, checkedAt: cheapest.checkedAt } : null,
    marginPct,
    flags,
  };
}

export function fmt(v: number): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/** File name for the download: "pack-rentree-1080x1080.png". */
export function posterFileName(name: string, w = POSTER_SIZE, h = POSTER_SIZE): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "affiche"}-${w}x${h}.png`;
}

/**
 * Applies a Tunisian event: headline, tag and offer end date from the calendar (all editable after),
 * the product name moves to the subtitle. "" removes the event and restores the product headline.
 */
export function applyEvent(design: PosterDesign, eventId: string, products: PosterProduct[], from = new Date()): PosterDesign {
  const base = defaultDesign(products, { brand: design.brand, lang: design.lang });
  const ev = eventById(eventId);
  if (!ev) return { ...design, event: "", title: base.title, titleAr: base.titleAr, subtitle: base.subtitle, tag: base.tag, tagAr: base.tagAr };
  const next = ev.next(from);
  const year = String((next?.date ?? from).getUTCFullYear());
  const fill = (s: string) => s.replace("{Y}", year);
  const single = products.length === 1;
  return {
    ...design,
    event: ev.id,
    title: fill(ev.fr.title),
    titleAr: fill(ev.ar.title),
    subtitle: single ? (products[0]?.name ?? base.subtitle) : base.subtitle,
    tag: ev.fr.tag,
    tagAr: ev.ar.tag,
    cta: ev.fr.cta ?? design.cta,
    ctaAr: ev.ar.cta ?? design.ctaAr,
    validUntil: next ? isoDay(new Date(next.date.getTime() + (ev.days ?? 0) * 86_400_000)) : design.validUntil,
    theme: ev.theme ?? design.theme,
    showOldPrice: ev.sales ? true : design.showOldPrice,
    showDiscount: ev.sales ? true : design.showDiscount,
  };
}

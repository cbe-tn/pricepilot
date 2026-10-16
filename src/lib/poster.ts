// Marketing Studio rules shared by the browser (live preview) and the server (validation before export).
// Commercial values never come from free text: prices are read from the catalogue facts below, and the
// only number the user types is the promo price, which is checked against the 3 % margin floor.

export const POSTER_SIZE = 1080;
export const MAX_POSTER_PRODUCTS = 4;
/** A numedia.tn price older than this is flagged before it is printed as the crossed-out price. */
export const OWN_PRICE_MAX_AGE_DAYS = 3;

export type PosterLang = "fr" | "ar" | "bi";
export type PosterTheme = "studio" | "promo" | "premium" | "podium" | "neon" | "split" | "flash" | "minimal" | "aurora";
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

export type ElementLayout = { dx: number; dy: number; scale: number };

export type PosterDesign = {
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
};

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
    productOrder: order,
    layout: { ...structuredClone(DEFAULT_LAYOUT), ...(raw.layout ?? {}) },
  };
}

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

  if (!(design.lang === "ar" ? design.titleAr : design.title).trim()) errors.push("Le titre de l'affiche est vide.");
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
export function posterFileName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "affiche"}-1080x1080.png`;
}

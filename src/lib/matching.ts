export type MatchClass = "exact" | "strong" | "possible" | "unverified";

export type MatchResult = {
  matchClass: MatchClass;
  confidence: number;
  reason: string;
  excluded: boolean;
  exclusionReason?: string;
};

const NON_COMPARABLE = [
  "reconditionn",
  "refurbished",
  "occasion",
  "used",
  "ouvert",
  "open box",
  "bundle",
  "pack ",
  "coffret",
  "lot de",
  "avec sac",
  "gift kit",
];

export function normalizeRef(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

export function normalizeBarcode(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

export function tokenize(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function extractCapacity(text: string): string[] {
  const found: string[] = [];
  const re = /(\d+(?:\.\d+)?)\s?(tb|gb|go|ko|hz|hz|inch|"|pouces|w)\b/gi;
  let m: RegExpExecArray | null;
  const src = text.toLowerCase();
  while ((m = re.exec(src))) {
    found.push(`${m[1]}${m[2].toLowerCase().replace("go", "gb").replace("pouces", "inch").replace('"', "inch")}`);
  }
  const ram = src.match(/(\d+)\s?go?\s?(ram|ddr)/i);
  if (ram) found.push(`ram${ram[1]}`);
  return found;
}

export function detectNonComparable(title: string, condition?: string | null): { excluded: boolean; reason?: string } {
  const hay = `${title} ${condition ?? ""}`.toLowerCase();
  for (const token of NON_COMPARABLE) {
    // Match at a word start: "ouvert" (open box) must not fire on "13 couverts", "used" not on "focused";
    // prefixes like "reconditionn" still catch "reconditionné". A trailing space in the token means whole word.
    const word = token.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const end = token.endsWith(" ") ? "($|[^\\p{L}\\p{N}])" : "";
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${word}${end}`, "u").test(hay)) {
      return { excluded: true, reason: `Offre non comparable (« ${token.trim()} ») : exclue du benchmark par défaut` };
    }
  }
  return { excluded: false };
}

export function matchListing(input: {
  productName: string;
  brand?: string | null;
  model?: string | null;
  manufacturerRef?: string | null;
  barcode?: string | null;
  specifications?: Record<string, string> | null;
  listingTitle: string;
  listingBrand?: string | null;
  listingModel?: string | null;
  listingRef?: string | null;
  listingBarcode?: string | null;
  listingCondition?: string | null;
}): MatchResult {
  const nonComp = detectNonComparable(input.listingTitle, input.listingCondition);
  const pRef = normalizeRef(input.manufacturerRef);
  const lRef = normalizeRef(input.listingRef);
  const pBar = normalizeBarcode(input.barcode);
  const lBar = normalizeBarcode(input.listingBarcode);

  if (pBar && lBar && pBar === lBar && pBar.length >= 8) {
    return {
      matchClass: "exact",
      confidence: 99,
      reason: "Code-barres / EAN identique",
      excluded: nonComp.excluded,
      exclusionReason: nonComp.reason,
    };
  }

  if (pRef && lRef && pRef === lRef && pRef.length >= 5) {
    return {
      matchClass: "exact",
      confidence: 97,
      reason: "Référence fabricant identique",
      excluded: nonComp.excluded,
      exclusionReason: nonComp.reason,
    };
  }

  const pBrand = (input.brand ?? "").toLowerCase().trim();
  const lBrand = (input.listingBrand ?? "").toLowerCase().trim();
  const pModel = (input.model ?? "").toLowerCase().trim();
  const lModel = (input.listingModel ?? "").toLowerCase().trim();
  const title = input.listingTitle.toLowerCase();
  const pname = input.productName.toLowerCase();

  const brandOk =
    Boolean(pBrand) &&
    (lBrand === pBrand || title.includes(pBrand) || pname.includes(lBrand || pBrand));

  const modelInTitle = pModel && (title.includes(pModel) || lModel === pModel);
  const refInTitle = pRef && normalizeRef(input.listingTitle).includes(pRef);

  const pCaps = extractCapacity(`${input.productName} ${JSON.stringify(input.specifications ?? {})}`);
  const lCaps = extractCapacity(input.listingTitle);
  const capMismatch =
    pCaps.length > 0 &&
    lCaps.length > 0 &&
    pCaps.some((c) => c.match(/gb|tb|ram/) && lCaps.some((d) => d.replace(/\d+/, "") === c.replace(/\d+/, "") && d !== c));

  if (capMismatch) {
    return {
      matchClass: "possible",
      confidence: 42,
      reason: "Même marque/modèle mais variante différente (capacité, RAM ou taille) — exclue des comparables",
      excluded: true,
      exclusionReason: "Variante incompatible (capacité / RAM / taille)",
    };
  }

  if (brandOk && (modelInTitle || refInTitle) && pCaps.every((c) => lCaps.includes(c) || title.includes(c.replace(/ram/, "")))) {
    return {
      matchClass: "strong",
      confidence: 86,
      reason: "Même marque et même modèle, caractéristiques compatibles",
      excluded: nonComp.excluded,
      exclusionReason: nonComp.reason,
    };
  }

  if (brandOk && modelInTitle) {
    return {
      matchClass: "strong",
      confidence: 78,
      reason: "Même marque et même nom de modèle",
      excluded: nonComp.excluded,
      exclusionReason: nonComp.reason,
    };
  }

  const pTokens = new Set(tokenize(input.productName));
  const lTokens = tokenize(input.listingTitle);
  const overlap = lTokens.filter((t) => pTokens.has(t)).length;
  const ratio = lTokens.length ? overlap / Math.max(pTokens.size, 1) : 0;

  if (brandOk && ratio >= 0.35) {
    return {
      matchClass: "possible",
      confidence: Math.round(55 + ratio * 20),
      reason: "Même marque et noms proches — à confirmer avant d'utiliser ce prix",
      excluded: nonComp.excluded,
      exclusionReason: nonComp.reason,
    };
  }

  if (ratio >= 0.5) {
    return {
      matchClass: "unverified",
      confidence: Math.round(30 + ratio * 20),
      reason: "Seulement un nom proche — jamais utilisé automatiquement",
      excluded: true,
      exclusionReason: "Identification insuffisante (ni référence, ni code-barres, ni modèle confirmé en commun)",
    };
  }

  return {
    matchClass: "unverified",
    confidence: 18,
    reason: "Ni référence fabricant, ni code-barres, ni modèle confirmé en commun",
    excluded: true,
    exclusionReason: "Non vérifiée — à confirmer ou lier manuellement",
  };
}

export function isBenchmarkable(match: Pick<MatchResult, "matchClass" | "excluded">): boolean {
  if (match.excluded) return false;
  return match.matchClass === "exact" || match.matchClass === "strong";
}

// Compatible ("adaptable") versions of a reference are a different product from the original.
const COMPATIBLE_RE = /\b(adaptables?|compatibles?|g[ée]n[ée]riques?|remanufactur[ée]e?s?|reconditionn[ée]e?s?)(?![a-z])/i;
/** A compatible listing ("Toner adaptable Kyocera TK-170") for an original product (and not when we sell a compatible too). */
export function isCompatibleListing(listingTitle: string, productName: string): boolean {
  return COMPATIBLE_RE.test(listingTitle) && !COMPATIBLE_RE.test(productName);
}

// Guesses which columns of a supplier price list hold the reference, the designation, the unit price and
// the quantity. The guess is only a starting point: the purchasing page shows a preview where the columns
// can be changed before saving. No server-only imports: this module also runs in the browser.

export type SourceTable = { name: string; rows: string[][] };

export type ColumnMapping = { ref: number; name: number; price: number; qty: number };

export type DetectedTable = SourceTable & {
  /** Index of the header row in `rows` (-1 = none found, every row is data). */
  headerRow: number;
  mapping: ColumnMapping;
  /** "ttc" when the chosen price column says TTC. */
  basis: "ht" | "ttc";
};

export type ParsedLine = { ref: string; name: string; price: number; qty: number | null };

// ---------- column detection ----------

function key(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type Role = "ref" | "name" | "price" | "qty";

function headerRole(cell: string): Role | null {
  const k = key(cell);
  if (!k || k.length > 40) return null;
  if (/total|montant|remise|discount|tva|vat|tax|taux|pourcent|percent|marge|margin/.test(k)) return null;
  if (/^(ref|refs|reference|references|referencearticle|refarticle|reffabricant|referencefabricant|refconstructeur|code|codearticle|codeproduit|article\s*code|partnumber|pn|sku|codeart|refart|modele|model)$/.test(k) || /^(ref|reference|code)(article|produit|fournisseur|fabricant)?$/.test(k)) return "ref";
  if (/designation|libelle|description|descriptif|produit|article|desig|intitule|nomduproduit/.test(k)) return "name";
  // "PU HT", "Prix revendeur TND", "Dealer Price", "Unit cost", "P.A HT"…
  if (/^(pu|pa|pv)(ht|ttc|net)?$/.test(k) || /prix|price|tarif|cout|cost|paht|pvht/.test(k)) return "price";
  if (/^(qte|qt|quantite|qty|quantity|stock|dispo|disponibilite)/.test(k)) return "qty";
  return null;
}

/**
 * Supplier prices below 1 DT are almost always a VAT rate (0.19), a discount or a coefficient sitting
 * in the price column of some rows: such lines are left out and counted in the preview.
 */
export const MIN_PRICE = 1;

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Median of the parsable numbers of a column (used to reject rate-like columns as price). */
function columnMedian(rows: string[][], col: number): number {
  return medianOf(rows.slice(0, 300).flatMap((r) => {
    const v = parsePrice(r[col]);
    return v === null ? [] : [v];
  }));
}

/** First row (within the top 40) naming a price column plus a reference or designation column. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const roles = new Set(rows[i].map(headerRole));
    if (roles.has("price") && (roles.has("ref") || roles.has("name"))) return i;
  }
  return -1;
}

/**
 * Supplier prices: "1 234,500", "1.234,500", "1234.5", "1,234.50", "450 DT", "TND 89.900".
 * A lone comma is a decimal separator (Tunisian usage, three decimals for millimes).
 */
export function parsePrice(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  let s = String(raw ?? "").replace(/[  \s]/g, "").replace(/(tnd|dt|dinars?|ht|ttc|€|eur|\$|usd)/gi, "");
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? "," : ".";
    s = s.replace(dec === "," ? /\./g : /,/g, "").replace(dec, ".");
  } else if (lastComma >= 0) {
    s = (s.match(/,/g)!.length > 1 ? s.replace(/,(?=.*,)/g, "") : s).replace(",", ".");
  } else if ((s.match(/\./g)?.length ?? 0) > 1) {
    s = s.replace(/\.(?=.*\.)/g, "");
  }
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const REF_TOKEN = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9\-./_#]{2,30}$|^\d{6,14}$/;

function columnCount(rows: string[][]): number {
  return rows.reduce((m, r) => Math.max(m, r.length), 0);
}

/** Without a header: price = mostly numeric column, ref = code-like tokens, name = longest text. */
function guessByContent(rows: string[][]): ColumnMapping {
  const cols = columnCount(rows);
  const sample = rows.slice(0, 300);
  const stats = Array.from({ length: cols }, (_, c) => {
    const vals = sample.map((r) => r[c] ?? "").filter(Boolean);
    const total = vals.length || 1;
    return {
      numeric: vals.filter((v) => parsePrice(v) !== null).length / total,
      decimals: vals.filter((v) => /[.,]\d{1,3}$/.test(v)).length / total,
      refLike: vals.filter((v) => REF_TOKEN.test(v)).length / total,
      avgLen: vals.reduce((a, v) => a + v.length, 0) / total,
      filled: vals.length / Math.max(sample.length, 1),
      integerSmall: vals.filter((v) => /^\d{1,3}$/.test(v)).length / total,
      median: columnMedian(sample, c),
    };
  });
  const pick = (score: (s: (typeof stats)[number], i: number) => number, exclude: number[]) => {
    let best = -1;
    let bestScore = 0.2;
    stats.forEach((s, i) => {
      if (exclude.includes(i)) return;
      const v = score(s, i);
      if (v > bestScore) {
        bestScore = v;
        best = i;
      }
    });
    return best;
  };
  // The unit price is usually the first decimal column; a later one is often the line total.
  const price = pick((s, i) => (s.median < MIN_PRICE ? 0 : (s.numeric * 0.6 + s.decimals * 0.4) * s.filled - i * 0.01), []);
  const ref = pick((s) => s.refLike * s.filled * (s.avgLen < 25 ? 1 : 0.3), [price]);
  const name = pick((s) => (s.numeric < 0.3 ? Math.min(s.avgLen / 30, 1) * s.filled : 0), [price, ref]);
  const qty = pick((s) => s.integerSmall * s.filled * 0.8, [price, ref, name]);
  return { ref, name, price, qty };
}

export function detectTable(table: SourceTable): DetectedTable {
  const headerRow = findHeaderRow(table.rows);
  const basis: "ht" | "ttc" = "ht";
  if (headerRow < 0) return { ...table, headerRow, mapping: guessByContent(table.rows), basis };
  const header = table.rows[headerRow];
  const roles = header.map(headerRole);
  const first = (role: Role) => roles.indexOf(role);
  // Several price columns ("PU HT", "PU TTC", "Prix public"): prefer a unit price HT.
  const priceCols = roles.flatMap((r, i) => (r === "price" ? [i] : []));
  const rank = (i: number) => {
    const k = key(header[i]);
    return (/ht|net|achat|revendeur|unitaire|^pu/.test(k) ? 2 : 0) - (/ttc|public|vente|pv/.test(k) ? 1 : 0);
  };
  const data = table.rows.slice(headerRow + 1);
  // A price-titled column holding rates (median under 1 DT) is not the unit price.
  const price = priceCols.filter((c) => columnMedian(data, c) >= MIN_PRICE).sort((a, b) => rank(b) - rank(a) || a - b)[0] ?? -1;
  let ref = first("ref");
  let name = first("name");
  // Some lists title the code column "Article" and the label column "Désignation".
  if (ref < 0 && name >= 0) {
    const names = roles.flatMap((r, i) => (r === "name" ? [i] : []));
    if (names.length > 1) {
      const refLike = (c: number) => data.slice(0, 100).filter((r) => REF_TOKEN.test(r[c] ?? "")).length;
      const byRef = [...names].sort((a, b) => refLike(b) - refLike(a));
      if (refLike(byRef[0]) > data.slice(0, 100).length * 0.5) {
        ref = byRef[0];
        name = names.find((c) => c !== ref) ?? -1;
      }
    }
  }
  return {
    ...table,
    headerRow,
    mapping: { ref, name, price, qty: first("qty") },
    basis: price >= 0 && /ttc/.test(key(header[price])) ? "ttc" : basis,
  };
}

const SKIP_ROW = /^(sous[- ]?total|total|net a payer|tva|timbre|remise|montant|arrete|base|fodec|cumul)/;

/** Data lines of a table under a mapping: rows with a price and a reference or designation. */
export function linesFromTable(table: SourceTable, headerRow: number, mapping: ColumnMapping): ParsedLine[] {
  if (mapping.price < 0 || (mapping.ref < 0 && mapping.name < 0)) return [];
  const out: ParsedLine[] = [];
  for (const row of table.rows.slice(headerRow + 1)) {
    const ref = mapping.ref >= 0 ? (row[mapping.ref] ?? "").trim() : "";
    const name = mapping.name >= 0 ? (row[mapping.name] ?? "").trim() : "";
    const label = key(name || ref);
    if (!label || SKIP_ROW.test(label)) continue;
    // A repeated header (new PDF page) is not a product.
    if (headerRow >= 0 && ref && ref === table.rows[headerRow][mapping.ref]) continue;
    const price = parsePrice(row[mapping.price]);
    if (price === null || price < MIN_PRICE) continue;
    const qtyRaw = mapping.qty >= 0 ? parsePrice(row[mapping.qty]) : null;
    out.push({ ref, name, price, qty: qtyRaw === null ? null : Math.round(qtyRaw) });
  }
  return out;
}

/** Lines left out because their price is under MIN_PRICE (shown as a warning in the preview). */
export function lowPriceCount(table: SourceTable, headerRow: number, mapping: ColumnMapping): number {
  if (mapping.price < 0) return 0;
  return table.rows.slice(headerRow + 1).filter((row) => {
    const v = parsePrice(row[mapping.price]);
    return v !== null && v < MIN_PRICE;
  }).length;
}

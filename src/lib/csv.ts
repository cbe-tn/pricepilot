import * as XLSX from "xlsx";
import type { Product } from "@/db/schema";
import { n } from "@/lib/money";
import { fr } from "@/lib/labels";

export const PRODUCT_IMPORT_COLUMNS = [
  "name",
  "brand",
  "manufacturer",
  "model",
  "manufacturerRef",
  "barcode",
  "sku",
  "category",
  "subcategory",
  "purchasePrice",
  "purchaseCurrency",
  "exchangeRate",
  "shippingCost",
  "importCost",
  "otherCosts",
  "vatRate",
  "minProfitMargin",
  "targetSellingPrice",
  "actualSellingPrice",
  "stockQty",
  "supplierName",
  "warranty",
  "condition",
  "tags",
  "competitorUrl",
  "description",
] as const;

export type ProductImportRow = Record<(typeof PRODUCT_IMPORT_COLUMNS)[number], string>;

// French / supplier column headers mapped to the product import fields.
const HEADER_ALIASES: Record<string, string> = {
  designation: "name", designations: "name", libelle: "name", produit: "name", article: "name",
  ref: "manufacturerRef", refart: "manufacturerRef", reference: "manufacturerRef", references: "manufacturerRef", referencearticle: "manufacturerRef",
  caracteristiques: "description", caracteristique: "description", description: "description", descriptif: "description",
  codeabarres: "barcode", codebarre: "barcode", codebarres: "barcode", ean: "barcode",
  qte: "stockQty", quantite: "stockQty", stock: "stockQty",
  prixachatht: "purchasePrice", prixachat: "purchasePrice", prixht: "purchasePrice", pa: "purchasePrice",
  // Purchase prices already TTC: kept as written (the HT is derived from them, never the reverse).
  prixachatttc: "purchasePriceTtc", prixdachatttc: "purchasePriceTtc", pattc: "purchasePriceTtc", puttc: "purchasePriceTtc",
  prixunitairettc: "purchasePriceTtc", coutttc: "purchasePriceTtc", coutachatttc: "purchasePriceTtc", prixttc: "purchasePriceTtc",
  prixventettc: "actualSellingPrice", prixdeventettc: "actualSellingPrice", prixdevente: "actualSellingPrice", pdvttc: "actualSellingPrice", cbe: "actualSellingPrice", numedia: "actualSellingPrice",
  marque: "brand", modele: "model", categorie: "category", famille: "category", fournisseur: "supplierName", tva: "vatRate",
  fabricant: "manufacturer", souscategorie: "subcategory", sku: "sku", transport: "shippingCost", fraisdimport: "importCost",
  autrescouts: "otherCosts", margeminimale: "minProfitMargin", prixdeventeciblettc: "targetSellingPrice", garantie: "warranty",
  // Stock exports of the ERP: "ARTICLE _Designation", "Quantité Stock", "Prix unitaire", "Remise", "Référence proposée", "Fiabilité".
  articledesignation: "name", quantitestock: "stockQty", qtestock: "stockQty", stockactuel: "stockQty",
  prixunitaire: "purchasePrice", pu: "purchasePrice", puht: "purchasePrice", prixunitaireht: "purchasePrice",
  referenceproposee: "manufacturerRef", referencefabricant: "manufacturerRef", reffabricant: "manufacturerRef",
  remise: "discountPct", remisepct: "discountPct", fiabilite: "refReliability", dernierachat: "lastPurchase", datedernierachat: "lastPurchase",
};

// Looser matches for headers not listed above (e.g. "Désignation article", "Quantité en stock").
const HEADER_PATTERNS: Array<[RegExp, string]> = [
  [/designation|libelle/, "name"],
  [/^(quantite|qte)/, "stockQty"],
  [/^(reference|ref)(fabricant|constructeur|proposee)?$/, "manufacturerRef"],
  [/^(prix(d)?achat|prixunitaire|pu|cout(d)?achat).*ttc/, "purchasePriceTtc"],
  [/^prix(d)?achat|^prixunitaire/, "purchasePrice"],
];

/** "Fiabilité" values that mean the proposed reference is not a usable manufacturer reference. */
const UNUSABLE_REFERENCE_RE = /generique|non identifiable|pas de ref/i;

/**
 * Splits a proposed reference such as "TK-475 (1T02K30NL0)", "MX-61GTCA / MX-61FTCA" or
 * "CM751A? (OfficeJet Pro 8100)" into the main reference and an alternative one (or model).
 * Returns no reference when the reliability column says there is none.
 */
export function cleanReference(raw: string | undefined, reliability?: string): { ref: string | null; alt: string | null } {
  const text = (raw ?? "").trim();
  if (!text || (reliability && UNUSABLE_REFERENCE_RE.test(reliability.normalize("NFD").replace(/[̀-ͯ]/g, "")))) {
    return { ref: null, alt: null };
  }
  if (/mod[eè]le non pr[eé]cis[eé]/i.test(text)) return { ref: null, alt: null };
  // "Toner e-STUDIO 2309A: T-2309E" → the reference is after the colon.
  const colon = text.match(/:\s*([^:]+)$/);
  if (colon) return cleanReference(colon[1], reliability);
  const paren = text.match(/^(.*?)\s*\(([^)]*)\)/);
  let main = paren ? paren[1] : text;
  let alt = paren ? paren[2] : null;
  const slash = main.split(/\s+\/\s+/);
  if (slash.length > 1) {
    main = slash[0];
    alt = alt ?? slash.slice(1).join(" / ");
  }
  const tidy = (s: string | null) =>
    s
      ?.replace(/\?+/g, "")
      .replace(/\b(adaptable|compatible|type)\b/gi, "")
      .replace(/r[ée]f\.?\s.*confirmer/i, "")
      .replace(/\s{2,}/g, " ")
      .trim() || null;
  return { ref: tidy(main), alt: tidy(alt) };
}

function headerKey(header: string): string {
  return header.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const IMPORT_FIELDS = new Set<string>(PRODUCT_IMPORT_COLUMNS);

/** Import field a header cell maps to (English column name, camelCase or French alias). */
function headerField(header: string): string | undefined {
  const key = headerKey(header);
  if (!key) return undefined;
  return HEADER_ALIASES[key] ?? [...IMPORT_FIELDS].find((f) => f.toLowerCase() === key) ?? HEADER_PATTERNS.find(([re]) => re.test(key))?.[1];
}

/**
 * Supplier price lists often start with a title block, so the header is the first row
 * (within the top 25) that names a product or reference column plus at least one other field.
 */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const fields = new Set(rows[i].map((c) => headerField(String(c ?? ""))).filter(Boolean));
    if ((fields.has("name") || fields.has("manufacturerRef")) && fields.size >= 2) return i;
  }
  return -1;
}

/**
 * Reads every sheet of a CSV/Excel file into import rows. Each row keeps its raw headers,
 * their camelCase form and the mapped import field (HEADER_ALIASES). Catalogue-style sheets
 * where one product spans several lines (reference + price on the first line, one
 * characteristic per following line) are folded into a single row whose characteristics
 * go to `description`; a missing name is built from the reference and first characteristic.
 */
export function parseSpreadsheet(buffer: ArrayBuffer | Buffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const out: Record<string, string>[] = [];
  const namedSheets = wb.SheetNames.length > 1;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
    const h = findHeaderRow(rows);
    if (h < 0) continue; // no recognisable product table on this sheet
    const headers = rows[h].map((c) => String(c ?? "").trim());
    const fields = headers.map((c) => headerField(c));
    const keyCols = fields.flatMap((f, i) => (f === "name" || f === "manufacturerRef" || f === "barcode" || f === "sku" ? [i] : []));
    const descCol = fields.indexOf("description");
    // Sheet tabs like "TV GAMME QLED F 7" or "60 CM" describe the range; "Feuil1"/"Sheet1" do not.
    const sheetCategory = namedSheets && !/^(feuil|sheet|tabelle|hoja)\s*\d*$/i.test(sheetName.trim()) ? sheetName.trim() : "";
    let current: Record<string, string> | null = null;
    let details: string[] = [];
    const flush = () => {
      if (!current) return;
      const desc = [current.description, ...details].filter(Boolean).join("\n");
      if (desc) current.description = desc;
      if (!current.name) {
        const ref = current.manufacturerRef || current.sku || current.barcode;
        const first = desc.split("\n")[0];
        if (ref) current.name = first ? `${ref} – ${first}` : ref;
      }
      if (sheetCategory && !current.category) current.category = sheetCategory;
      out.push(current);
    };
    for (const row of rows.slice(h + 1)) {
      const cells = headers.map((_, i) => String(row[i] ?? "").trim());
      if (cells.every((c) => !c)) continue;
      const startsProduct = keyCols.length === 0 || keyCols.some((i) => cells[i]);
      if (!startsProduct) {
        // Continuation line of the product above: keep its text as a characteristic.
        const extra = descCol >= 0 && cells[descCol] ? [cells[descCol]] : cells.filter(Boolean);
        if (current) details.push(...extra);
        continue;
      }
      flush();
      details = [];
      current = {};
      headers.forEach((key, i) => {
        if (!key) return;
        const v = cells[i];
        current![key] = v;
        const camel = key.replace(/[\s_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^(.)/, (m) => m.toLowerCase());
        current![camel] = v;
        const alias = fields[i];
        if (alias && !current![alias]) current![alias] = v;
      });
    }
    flush();
  }
  return out;
}

export function productsToWorkbook(
  rows: Product[],
  extras?: { sheetName?: string; extraRows?: Record<string, unknown>[] },
): Buffer {
  const data = rows.map((p) => ({
    // French headers that the importer maps back (HEADER_ALIASES), so an export can be re-imported.
    "Désignation": p.name,
    Marque: p.brand,
    Fabricant: p.manufacturer,
    "Modèle": p.model,
    "Réf": p.manufacturerRef,
    "Code a barres": p.barcode,
    SKU: p.sku,
    "Catégorie": p.category,
    "Sous-catégorie": p.subcategory,
    "Prix Achat HT": n(p.purchasePrice),
    Transport: n(p.shippingCost),
    "Frais d'import": n(p.importCost),
    "Autres coûts": n(p.otherCosts),
    TVA: n(p.vatRate),
    "Marge minimale": n(p.minProfitMargin),
    "Prix de vente cible TTC": n(p.targetSellingPrice),
    "Prix de vente TTC": n(p.actualSellingPrice),
    "Qté": p.stockQty,
    "Statut stock": fr(p.stockStatus),
    Fournisseur: p.supplierName,
    Garantie: p.warranty,
    Suivi: fr(p.monitoringStatus),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), extras?.sheetName ?? "Produits");
  if (extras?.extraRows?.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extras.extraRows), "Détails");
  }
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

/** Tags the importer sets itself (replaced on each re-import, user tags are kept). */
export const AUTO_TAG_PREFIXES = ["Réf : ", "Stock négatif ERP", "Remise 100 % ignorée"];

const num = (v: string | undefined) => n(String(v ?? "").replace(/\s/g, "").replace(",", "."));

/**
 * Stock values of one import row, with the rules for ERP exports:
 * - cost = unit price × (1 − discount %); a 100 % discount (free/promo line) is ignored;
 * - negative stock (sold before being entered) counts as 0 and is tagged;
 * - the proposed reference is cleaned; its alternative becomes the model.
 */
export function stockRowFacts(row: Record<string, string>) {
  const { ref, alt } = cleanReference(row.manufacturerRef || row.reference, row.refReliability);
  // An HT column wins; otherwise a TTC purchase column (converted by the import with the article's VAT).
  const purchaseIsTtc = !row.purchasePrice && Boolean(row.purchasePriceTtc);
  const unit = row.purchasePrice ? num(row.purchasePrice) : row.purchasePriceTtc ? num(row.purchasePriceTtc) : null;
  // ERP discounts carry float noise (0,0004 ; 46,4998): keep 2 decimals.
  const rawDiscount = Math.max(0, Math.round(num(row.discountPct) * 100) / 100);
  const discountIgnored = rawDiscount >= 100;
  const discount = discountIgnored ? 0 : Math.min(rawDiscount, 99.99);
  const purchase = unit != null ? Math.round(unit * (1 - discount / 100) * 1000) / 1000 : null;
  const hasQty = row.stockQty !== undefined && row.stockQty !== "";
  const rawQty = hasQty ? Math.round(num(row.stockQty)) : null;
  const tags = [
    row.refReliability ? `Réf : ${row.refReliability.split(/\s[–-]\s|\s\(/)[0].trim()}` : null,
    rawQty != null && rawQty < 0 ? `Stock négatif ERP (${rawQty})` : null,
    discountIgnored ? "Remise 100 % ignorée" : null,
  ].filter((t): t is string => Boolean(t));
  const fmt = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const note =
    unit != null && (rawDiscount > 0 || discountIgnored)
      ? `Prix unitaire ${fmt(unit)} DT, remise ${rawDiscount.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %${discountIgnored ? " (ignorée : ligne gratuite/promo)" : ""} → coût ${fmt(purchase!)} DT`
      : null;
  return {
    ref,
    model: row.model || (alt && alt !== ref ? alt : null),
    purchase,
    purchaseIsTtc,
    stockQty: rawQty == null ? null : Math.max(0, rawQty),
    tags,
    note,
  };
}

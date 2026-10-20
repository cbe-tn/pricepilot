// Reads supplier price lists (Excel/CSV, Word .docx, PDF with a text layer) into tables of text cells.
// Column detection lives in supplier-columns.ts (also used by the browser preview).

import * as XLSX from "xlsx";
import { detectTable, findHeaderRow, linesFromTable, type SourceTable } from "@/lib/supplier-columns";

export { detectTable };

export class UnsupportedFileError extends Error {}

// ---------- file → tables ----------

export async function extractTables(buffer: Buffer, fileName: string): Promise<SourceTable[]> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["xlsx", "xlsm", "xls", "csv", "ods", "txt"].includes(ext)) return spreadsheetTables(buffer);
  if (ext === "docx") return wordTables(buffer);
  if (ext === "pdf") return pdfTables(buffer);
  if (ext === "doc") throw new UnsupportedFileError("Ancien format Word (.doc) : enregistrez le fichier en .docx ou en PDF puis réessayez.");
  throw new UnsupportedFileError("Format non pris en charge. Utilisez un fichier PDF, Word (.docx), Excel (.xlsx, .xls) ou CSV.");
}

function cellText(v: unknown): string {
  return String(v ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function spreadsheetTables(buffer: Buffer): SourceTable[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: true })
      .map((r) => r.map(cellText))
      .filter((r) => r.some(Boolean)),
  })).filter((t) => t.rows.length);
}

function decodeHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function wordTables(buffer: Buffer): Promise<SourceTable[]> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const tables: SourceTable[] = [];
  for (const [i, m] of [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].entries()) {
    const rows = [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((tr) => [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => cellText(decodeHtml(td[1]))))
      .filter((r) => r.some(Boolean));
    if (rows.length) tables.push({ name: `Tableau ${i + 1}`, rows });
  }
  if (tables.length) return tables;
  // No Word table: one line per paragraph, cells split on tabs or wide gaps.
  const { value: text } = await mammoth.extractRawText({ buffer });
  const rows = text
    .split(/\n+/)
    .map((line) => line.split(/\t+|\s{3,}/).map(cellText).filter(Boolean))
    .filter((r) => r.length);
  return rows.length ? [{ name: "Document", rows }] : [];
}

// ---------- PDF ----------

type PdfCell = { text: string; x0: number; x1: number };
type PdfLine = { page: number; y: number; size: number; cells: PdfCell[] };

/**
 * PDF pages have no structure, only positioned text. Items on the same baseline form a line; items
 * separated by a horizontal gap wider than about one character form separate cells. Two readings are
 * tried and the one finding more priced products wins:
 * - a price table (header row, then one line per article), see `pdfTableReading`;
 * - catalogue sheets (one or two products per page: large title, "Référence: …", a "106 HT" price
 *   label placed anywhere on the page), see `pdfCatalogueReading`.
 */
async function pdfTables(buffer: Buffer): Promise<SourceTable[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const lines: PdfLine[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    type Item = { str: string; x: number; y: number; w: number; h: number };
    const items: Item[] = [];
    for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      const [a, b] = it.transform;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h: Math.abs(it.height || Math.hypot(a, b)) || 8 });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const pageRows: Item[][] = [];
    for (const it of items) {
      const row = pageRows[pageRows.length - 1];
      if (row && Math.abs(row[0].y - it.y) <= Math.max(2, row[0].h * 0.4)) row.push(it);
      else pageRows.push([it]);
    }
    for (const row of pageRows) {
      row.sort((a, b) => a.x - b.x);
      const cells: PdfCell[] = [];
      for (const it of row) {
        const last = cells[cells.length - 1];
        const charW = it.w && it.str.length ? it.w / it.str.length : it.h * 0.5;
        if (last && it.x - last.x1 <= Math.max(1.5, charW * 1.2)) {
          last.text += (it.x - last.x1 > charW * 0.25 ? " " : "") + it.str;
          last.x1 = it.x + it.w;
        } else {
          cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
        }
      }
      const clean = cells.map((c) => ({ ...c, text: cellText(c.text) })).filter((c) => c.text);
      if (clean.length) lines.push({ page: p, y: row[0].y, size: Math.max(...row.map((i) => i.h)), cells: clean });
    }
  }
  if (!lines.length) {
    throw new UnsupportedFileError("Ce PDF ne contient pas de texte (document scanné ou image). Demandez au fournisseur une version Excel ou un PDF généré par ordinateur.");
  }
  const table = pdfTableReading(lines);
  const catalogue = pdfCatalogueReading(lines);
  const priced = (t: SourceTable) => {
    const d = detectTable(t);
    return linesFromTable(d, d.headerRow, d.mapping).length;
  };
  return catalogue && priced(catalogue) > priced(table) ? [catalogue] : [table];
}

function pdfTableReading(lines: PdfLine[]): SourceTable {
  const header = findHeaderRow(lines.map((l) => l.cells.map((c) => c.text)));
  if (header < 0) return { name: "PDF", rows: lines.map((l) => l.cells.map((c) => c.text)) };
  const anchors = lines[header].cells;
  const aligned = lines.map((line, i) => {
    if (i <= header) return line.cells.map((c) => c.text);
    const out = anchors.map(() => "");
    for (const c of line.cells) {
      const col = nearestColumn(anchors, c);
      out[col] = out[col] ? `${out[col]} ${c.text}` : c.text;
    }
    return out;
  });
  return { name: "PDF", rows: aligned };
}

function nearestColumn(anchors: PdfCell[], c: PdfCell): number {
  let best = 0;
  let bestScore = -Infinity;
  anchors.forEach((a, i) => {
    const overlap = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0);
    const distance = Math.abs((a.x0 + a.x1) / 2 - (c.x0 + c.x1) / 2);
    const score = overlap > 0 ? 1000 + overlap : -distance;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** "106 HT", "629HT", "1 649 HT", "1.299,000 DT", "450 TTC". */
const PRICE_LABEL = /(\d{1,3}(?:[   .]\d{3})+|\d+)(?:[.,](\d{1,3}))?\s*(HT|TTC|DT|TND)\b/i;
const REF_LABEL = /r[ée]f(?:[ée]rence)?s?\.?\s*(?:fabricant|article|produit)?\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-./]{3,30})/i;
const MONTH = /^(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+\d{4}$/;

function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Catalogue sheets: each price label is paired with the nearest product title on the same page,
 * closest pairs first. A title is a line set at least about as large as the price, with a model
 * number or several words, and not repeated across pages like "Octobre 2025" or a section banner.
 * Each "Référence: …" goes to the title printed just above it.
 */
function pdfCatalogueReading(lines: PdfLine[]): SourceTable | null {
  const lineText = (l: PdfLine) => l.cells.map((c) => c.text).join(" ");
  const pageCount = new Set(lines.map((l) => l.page)).size;
  const seenOn = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = plain(lineText(l));
    seenOn.set(k, (seenOn.get(k) ?? new Set()).add(l.page));
  }
  const repeated = (k: string) => (seenOn.get(k)?.size ?? 0) >= Math.max(3, pageCount * 0.25);

  type Price = { y: number; size: number; text: string };
  type Title = { y: number; size: number; text: string };
  type Ref = { y: number; ref: string };
  const out: string[][] = [];
  let ttc = 0;
  for (const page of new Set(lines.map((l) => l.page))) {
    const prices: Price[] = [];
    const refs: Ref[] = [];
    const titles: Title[] = [];
    for (const l of lines.filter((x) => x.page === page)) {
      for (const c of l.cells) {
        const m = c.text.match(PRICE_LABEL);
        if (m) {
          prices.push({ y: l.y, size: l.size, text: m[0] });
          if (/ttc/i.test(m[3])) ttc++;
        }
        const r = c.text.match(REF_LABEL);
        if (r && /\d/.test(r[1])) refs.push({ y: l.y, ref: r[1] });
      }
      const text = l.cells
        .map((c) => c.text)
        .filter((t) => !PRICE_LABEL.test(t))
        .join(" ")
        .trim();
      const k = plain(text);
      if (!/[a-z]/.test(k) || text.includes(":") || repeated(plain(lineText(l))) || MONTH.test(k)) continue;
      // Section banners such as "Jet d'encre" have neither a model number nor three words.
      if (!/\d/.test(k) && k.split(" ").length < 3) continue;
      titles.push({ y: l.y, size: l.size, text });
    }
    if (!prices.length) continue;
    const pairs: Array<{ p: Price; t: Title; d: number }> = [];
    for (const p of prices) {
      for (const t of titles) if (t.size >= p.size * 0.7) pairs.push({ p, t, d: Math.abs(t.y - p.y) });
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedP = new Set<Price>();
    const usedT = new Set<Title>();
    const found: Array<{ p: Price; t: Title }> = [];
    for (const pair of pairs) {
      if (usedP.has(pair.p) || usedT.has(pair.t)) continue;
      usedP.add(pair.p);
      usedT.add(pair.t);
      found.push(pair);
    }
    found.sort((a, b) => b.t.y - a.t.y);
    for (const { t, p } of found) {
      // PDF y grows upwards: the reference is the closest one below this title and above the next one.
      const next = found.map((f) => f.t.y).filter((y) => y < t.y).sort((a, b) => b - a)[0] ?? -Infinity;
      const ref = refs.filter((r) => r.y <= t.y && r.y > next).sort((a, b) => b.y - a.y)[0];
      out.push([ref?.ref ?? "", t.text, p.text]);
    }
  }
  if (!out.length) return null;
  return { name: "Fiches produits (PDF)", rows: [["Référence", "Désignation", ttc > out.length / 2 ? "Prix TTC" : "Prix HT"], ...out] };
}

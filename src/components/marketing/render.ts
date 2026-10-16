// Deterministic poster composer. The same function paints the on-screen preview and the exported PNG
// (one 1080 × 1080 canvas), so what is validated is exactly what is downloaded. Prices come from the
// checked pricing object, never from free text; Arabic is shaped by the browser (direction = "rtl").
import { POSTER_SIZE, type ElementLayout, type PosterDesign, type PosterElement, type PosterPricing, type PosterProduct } from "@/lib/poster";

const S = POSTER_SIZE;

export type PosterAssets = {
  photos: Map<string, HTMLImageElement | null>;
  logo: HTMLImageElement | null;
  fonts: { latin: string; arabic: string };
};

export type Box = { el: PosterElement; x: number; y: number; w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };

const AR = /[؀-ۿ]/;

type Palette = { text: string; muted: string; strike: string };
const PALETTES: Record<PosterDesign["theme"], Palette> = {
  studio: { text: "#121212", muted: "#3a3a3a", strike: "#121212" },
  promo: { text: "#121212", muted: "#2b2b2b", strike: "#121212" },
  premium: { text: "#ffffff", muted: "#d9d9d9", strike: "#f2f2f2" },
};

/** Price as printed on Tunisian posters: "669", "1 978", "89,500". */
export function priceText(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  const int = Math.trunc(r)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = Math.round((r - Math.trunc(r)) * 1000);
  return frac ? `${int},${String(frac).padStart(3, "0")}` : int;
}

function font(assets: PosterAssets, weight: number, size: number, text: string, italic = false) {
  const family = AR.test(text) ? assets.fonts.arabic : assets.fonts.latin;
  return `${italic ? "italic " : ""}${weight} ${Math.round(size)}px ${family}`;
}

function setDir(ctx: CanvasRenderingContext2D, text: string) {
  // Right-to-left only for purely Arabic lines; a bilingual line keeps the French reading order.
  ctx.direction = AR.test(text) && !/[A-Za-z]/.test(text) ? "rtl" : "ltr";
}

/** Word-wraps `text` into at most `maxLines`, shrinking from `size` to `minSize`. */
function fit(ctx: CanvasRenderingContext2D, assets: PosterAssets, text: string, weight: number, size: number, minSize: number, maxW: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let s = size;
  for (;;) {
    ctx.font = font(assets, weight, s, text);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width <= maxW || !line) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    const widest = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
    const ok = lines.length <= maxLines && widest <= maxW;
    if (ok || s <= minSize) return { lines: lines.slice(0, maxLines), size: s, overflow: !ok };
    s = Math.max(minSize, s - 4);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function withLayout(ctx: CanvasRenderingContext2D, area: Rect, l: ElementLayout, draw: () => void): Rect {
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  ctx.save();
  ctx.translate(cx + l.dx, cy + l.dy);
  ctx.scale(l.scale, l.scale);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
  const w = area.w * l.scale;
  const h = area.h * l.scale;
  return { x: cx + l.dx - w / 2, y: cy + l.dy - h / 2, w, h };
}

function drawBackground(ctx: CanvasRenderingContext2D, d: PosterDesign) {
  if (d.theme === "studio") {
    const g = ctx.createRadialGradient(540, 420, 60, 540, 520, 900);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.55, "#efede9");
    g.addColorStop(1, "#d8d4ce");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // Soft light beams, like a shop aisle out of focus.
    for (const [x, w, a] of [[60, 120, 0.35], [250, 60, 0.25], [820, 90, 0.3], [980, 140, 0.35]] as const) {
      const beam = ctx.createLinearGradient(0, 0, 0, S);
      beam.addColorStop(0, `rgba(255,255,255,${a})`);
      beam.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = beam;
      ctx.fillRect(x, 0, w, S);
    }
  } else if (d.theme === "promo") {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, "#fbf0bd");
    g.addColorStop(1, "#efd479");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ffffff";
    for (let i = -2; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 200, S);
      ctx.lineTo(i * 200 + 90, S);
      ctx.lineTo(i * 200 + 500, 0);
      ctx.lineTo(i * 200 + 410, 0);
      ctx.fill();
    }
    ctx.restore();
  } else {
    const g = ctx.createRadialGradient(540, 560, 40, 540, 540, 820);
    g.addColorStop(0, "#2c2c31");
    g.addColorStop(1, "#0c0c0e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const glow = ctx.createRadialGradient(540, 620, 20, 540, 620, 520);
    glow.addColorStop(0, hexA(d.accent, 0.45));
    glow.addColorStop(1, hexA(d.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);
  }
  // Decorative "+" marks and dot grids, kept to the margins so they never cover products or prices.
  ctx.save();
  ctx.strokeStyle = d.accent;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  for (const [x, y] of [[46, 350], [1034, 372], [46, 770]] as const) {
    ctx.beginPath();
    ctx.moveTo(x - 13, y);
    ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x, y + 13);
    ctx.stroke();
  }
  ctx.fillStyle = d.theme === "premium" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)";
  for (const [ox, oy] of [[40, 560], [1010, 250]] as const)
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      ctx.beginPath();
      ctx.arc(ox + c * 14, oy + r * 14, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.restore();
}

function hexA(hex: string, a: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

const whiteLogoCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();
function whiteLogo(img: HTMLImageElement): HTMLCanvasElement {
  const hit = whiteLogoCache.get(img);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, c.width, c.height);
  whiteLogoCache.set(img, c);
  return c;
}

function drawLogo(ctx: CanvasRenderingContext2D, d: PosterDesign, assets: PosterAssets) {
  const img = assets.logo;
  if (!img || !img.naturalWidth) return;
  const ratio = img.naturalWidth / img.naturalHeight;
  if (d.brand === "numedia") {
    // Official logo in white on the brand-red pill, as on NUMEDIA's posters.
    const h = 40;
    const w = h * ratio;
    roundRect(ctx, 44, 40, w + 56, h + 34, (h + 34) / 2);
    ctx.fillStyle = d.accent;
    ctx.fill();
    ctx.drawImage(whiteLogo(img), 72, 57, w, h);
  } else {
    const h = 58;
    const w = h * ratio;
    roundRect(ctx, 44, 36, w + 40, h + 28, 18);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.drawImage(img, 64, 50, w, h);
  }
}

function drawTag(ctx: CanvasRenderingContext2D, d: PosterDesign, assets: PosterAssets, text: string) {
  if (!text.trim()) return;
  if (d.theme === "promo") {
    // Tilted ribbon, as on the yellow "PROMOWET" posters.
    ctx.save();
    setDir(ctx, text);
    ctx.font = font(assets, 900, 50, text, !AR.test(text));
    const w = ctx.measureText(text).width + 56;
    ctx.translate(S - 44 - w / 2, 82);
    ctx.rotate(-0.07);
    ctx.fillStyle = d.accent;
    ctx.fillRect(-w / 2, -38, w, 72);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 16);
    ctx.restore();
    ctx.direction = "ltr";
    return;
  }
  ctx.font = font(assets, 800, 30, text);
  setDir(ctx, text);
  const w = ctx.measureText(text).width + 48;
  roundRect(ctx, S - 44 - w, 46, w, 60, 30);
  ctx.fillStyle = d.theme === "premium" ? "#ffffff" : "#121212";
  ctx.fill();
  ctx.fillStyle = d.theme === "premium" ? "#121212" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, S - 44 - w / 2, 77);
}

export type DrawResult = { boxes: Box[]; warnings: string[] };

export function drawPoster(
  ctx: CanvasRenderingContext2D,
  d: PosterDesign,
  products: PosterProduct[],
  pricing: PosterPricing,
  assets: PosterAssets,
): DrawResult {
  const warnings: string[] = [];
  const boxes: Box[] = [];
  const pal = PALETTES[d.theme];
  const ar = d.lang === "ar";
  const bi = d.lang === "bi";
  ctx.save();
  ctx.clearRect(0, 0, S, S);
  ctx.textBaseline = "alphabetic";
  drawBackground(ctx, d);
  drawLogo(ctx, d, assets);
  drawTag(ctx, d, assets, ar ? d.tagAr : d.tag);

  const benefits = (ar ? d.benefitsAr : d.benefits).map((b) => b.trim()).filter(Boolean);
  const benefitsAr = bi ? d.benefitsAr.map((b) => b.trim()).filter(Boolean) : [];
  const hasBenefits = benefits.length > 0 || benefitsAr.length > 0;

  // ---------- Title block ----------
  const titleArea: Rect = { x: 90, y: 128, w: 900, h: 250 };
  const titleBox = withLayout(ctx, titleArea, d.layout.title, () => {
    const main = ar ? d.titleAr : d.title;
    const sub = ar ? d.subtitleAr || d.subtitle : d.subtitle;
    ctx.textAlign = "center";
    ctx.fillStyle = pal.text;
    let y = titleArea.y;
    const t = fit(ctx, assets, main, 900, 100, 52, titleArea.w, 2);
    if (t.overflow) warnings.push("Le titre est trop long : il est coupé.");
    setDir(ctx, main);
    ctx.font = font(assets, 900, t.size, main);
    for (const line of t.lines) {
      y += t.size * 0.95;
      ctx.fillText(line, 540, y);
    }
    if (bi && d.titleAr.trim()) {
      const a = fit(ctx, assets, d.titleAr, 800, 54, 34, titleArea.w, 1);
      setDir(ctx, d.titleAr);
      ctx.font = font(assets, 800, a.size, d.titleAr);
      y += a.size * 1.2 + 6;
      ctx.fillText(a.lines[0] ?? "", 540, y);
    }
    if (sub.trim()) {
      const s = fit(ctx, assets, sub, 600, 46, 28, titleArea.w, 2);
      y += 16; // breathing room under the heavy headline
      if (s.overflow) warnings.push("Le sous-titre est trop long : il est coupé.");
      setDir(ctx, sub);
      ctx.font = font(assets, 600, s.size, sub);
      ctx.fillStyle = pal.muted;
      for (const line of s.lines) {
        y += s.size * 1.15;
        ctx.fillText(line, 540, y);
      }
    }
    if (y > titleArea.y + titleArea.h + 12) warnings.push("Le bloc titre déborde sur les produits : raccourcissez le titre ou le sous-titre.");
    ctx.direction = "ltr";
  });
  boxes.push({ el: "title", ...titleBox });

  // ---------- Products ----------
  const prodArea: Rect = { x: 70, y: 390, w: hasBenefits ? 770 : 940, h: 450 };
  const ordered = d.productOrder.map((id) => products.find((p) => p.id === id)).filter((p): p is PosterProduct => Boolean(p));
  const prodBox = withLayout(ctx, prodArea, d.layout.products, () => {
    const cells = productCells(prodArea, ordered.length);
    ordered.forEach((p, i) => {
      const cell = cells[i];
      const img = assets.photos.get(p.id);
      if (d.theme === "premium") {
        roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 32);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 40;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
      if (img && img.naturalWidth) {
        const pad = d.theme === "premium" ? 22 : 0;
        const r = Math.min((cell.w - pad * 2) / img.naturalWidth, (cell.h - pad * 2) / img.naturalHeight);
        const w = img.naturalWidth * r;
        const h = img.naturalHeight * r;
        ctx.save();
        // The official photos have a white background: "multiply" blends it into light backgrounds.
        if (d.theme !== "premium") ctx.globalCompositeOperation = "multiply";
        ctx.drawImage(img, cell.x + (cell.w - w) / 2, cell.y + (cell.h - h) / 2, w, h);
        ctx.restore();
      } else {
        roundRect(ctx, cell.x + 20, cell.y + 20, cell.w - 40, cell.h - 40, 24);
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.fill();
        ctx.fillStyle = "#8a8a8a";
        ctx.textAlign = "center";
        ctx.font = font(assets, 600, 26, "Photo");
        ctx.fillText("Photo officielle manquante", cell.x + cell.w / 2, cell.y + cell.h / 2);
      }
    });
    // "+" between pack items.
    ctx.fillStyle = d.accent;
    ctx.textAlign = "center";
    ctx.font = font(assets, 900, 96, "+");
    for (const [x, y] of plusMarks(prodArea, ordered.length)) ctx.fillText("+", x, y + 34);
  });
  boxes.push({ el: "products", ...prodBox });

  // ---------- Benefits (bubbles on the right) ----------
  if (hasBenefits) {
    const items = bi ? benefits.map((b, i) => [b, benefitsAr[i] ?? ""] as const) : benefits.map((b) => [b, ""] as const);
    if (bi) for (let i = benefits.length; i < benefitsAr.length; i++) items.push(["", benefitsAr[i]]);
    const area: Rect = { x: 850, y: 430, w: 190, h: 190 * items.length + 16 * (items.length - 1) };
    const b = withLayout(ctx, area, d.layout.benefits, () => {
      items.forEach(([fr, arTxt], i) => {
        const cy = area.y + 95 + i * 206;
        ctx.beginPath();
        ctx.arc(945, cy, 95, 0, Math.PI * 2);
        ctx.fillStyle = d.accent;
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        const lines: Array<[string, number]> = [];
        for (const t of [fr, arTxt].filter(Boolean)) {
          const f = fit(ctx, assets, t, 800, 30, 18, 150, fr && arTxt ? 2 : 3);
          if (f.overflow) warnings.push(`Avantage trop long : « ${t} ».`);
          for (const l of f.lines) lines.push([l, f.size]);
        }
        const total = lines.reduce((s, [, sz]) => s + sz * 1.1, 0);
        let y = cy - total / 2;
        for (const [l, sz] of lines) {
          y += sz * 1.1;
          setDir(ctx, l);
          ctx.font = font(assets, 800, sz, l);
          ctx.fillText(l, 945, y - sz * 0.18);
        }
        ctx.direction = "ltr";
      });
    });
    boxes.push({ el: "benefits", ...b });
  }

  // ---------- Price block (bottom right) ----------
  if (pricing.price != null) {
    const area: Rect = { x: 540, y: 800, w: 500, h: 230 };
    const p = withLayout(ctx, area, d.layout.price, () => {
      const right = area.x + area.w;
      const big = priceText(pricing.price!);
      ctx.direction = "ltr";
      ctx.font = font(assets, 900, 76, "DT");
      const wDt = ctx.measureText("DT").width;
      // Column right of the big number: "DT" on top, crossed-out old price below (as on NUMEDIA posters).
      const old = pricing.oldPrice != null ? priceText(pricing.oldPrice) : null;
      ctx.font = font(assets, 800, 64, old ?? "0");
      const wOld = old ? ctx.measureText(old).width : 0;
      ctx.font = font(assets, 800, 30, "DT");
      const wOldDt = ctx.measureText("DT").width;
      const colW = Math.max(wDt, old ? wOld + 6 + wOldDt : 0);
      // As large as the block allows: "89" gets 220 px, "1 978,500" shrinks to fit.
      let bigSize = 190;
      ctx.font = font(assets, 900, bigSize, big);
      while (bigSize > 100 && ctx.measureText(big).width > area.w - colW - 12) {
        bigSize -= 6;
        ctx.font = font(assets, 900, bigSize, big);
      }
      const wBig = ctx.measureText(big).width;
      const baseline = area.y + 178;
      const x0 = right - colW - 12 - wBig;
      const colX = right - colW;
      if (d.theme !== "premium") {
        // White outline keeps the price readable over any part of the photo.
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 14;
        ctx.font = font(assets, 900, bigSize, big);
        ctx.textAlign = "left";
        ctx.strokeText(big, x0, baseline);
      }
      ctx.fillStyle = d.accent;
      ctx.textAlign = "left";
      ctx.font = font(assets, 900, bigSize, big);
      ctx.fillText(big, x0, baseline);
      ctx.font = font(assets, 900, 76, "DT");
      // Keep "DT" clear of the crossed-out price below it, whatever the size of the number.
      ctx.fillText("DT", colX, old ? Math.min(baseline - bigSize * 0.5, baseline - 80) : baseline - bigSize * 0.5);
      if (old) {
        const oy = baseline;
        const ox = colX;
        ctx.fillStyle = pal.strike;
        ctx.font = font(assets, 800, 64, old);
        ctx.fillText(old, ox, oy);
        ctx.font = font(assets, 800, 30, "DT");
        ctx.fillText("DT", ox + wOld + 6, oy);
        ctx.strokeStyle = d.accent;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(ox - 4, oy - 10);
        ctx.lineTo(ox + wOld + 8, oy - 38);
        ctx.stroke();
      }
      if (pricing.discountPct != null) {
        const label = `-${pricing.discountPct}%`;
        // Sticker just above the number, so it never covers a digit or the bottom-left texts.
        const cx = x0 + 62;
        const cy = baseline - bigSize * 0.72 - 74;
        ctx.beginPath();
        ctx.arc(cx, cy, 62, 0, Math.PI * 2);
        ctx.fillStyle = d.theme === "premium" ? "#ffffff" : "#121212";
        ctx.fill();
        ctx.fillStyle = d.theme === "premium" ? "#121212" : "#ffffff";
        ctx.textAlign = "center";
        ctx.font = font(assets, 900, 40, label);
        ctx.fillText(label, cx, cy + 14);
      }
    });
    boxes.push({ el: "price", ...p });
  }

  // ---------- Bottom left: call to action, contact, validity ----------
  let y = S - 40;
  ctx.textAlign = "left";
  const validity: string[] = [];
  if (d.validUntil) {
    const [yy, mm, dd] = d.validUntil.split("-");
    const date = `${dd}-${mm}-${yy}`;
    if (!ar) validity.push(`Offre valable jusqu'au ${date}`);
    // The date is isolated (LRI … PDI) so it keeps its order inside the right-to-left sentence.
    if (ar || bi) validity.push(`العرض صالح لين ⁦${date}⁩`);
  }
  for (const v of validity.reverse()) {
    ctx.fillStyle = pal.text;
    setDir(ctx, v);
    ctx.textAlign = AR.test(v) ? "right" : "left";
    const vf = fit(ctx, assets, v, 800, 28, 18, 450, 1);
    ctx.font = font(assets, 800, vf.size, v);
    ctx.fillText(vf.lines[0] ?? "", AR.test(v) ? 498 : 48, y);
    y -= 38;
  }
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  if (d.footer.trim()) {
    ctx.fillStyle = pal.muted;
    const f = fit(ctx, assets, d.footer, 600, 24, 16, 460, 1);
    ctx.font = font(assets, 600, f.size, d.footer);
    ctx.fillText(f.lines[0] ?? "", 48, y);
    y -= 44;
  }
  const cta = [ar ? d.ctaAr : d.cta, bi ? d.ctaAr : ""].map((s) => s.trim()).filter(Boolean).join("  ·  ");
  if (cta) {
    const f = fit(ctx, assets, cta, 800, 28, 18, 400, 1);
    if (f.overflow) warnings.push("L'appel à l'action est trop long.");
    ctx.font = font(assets, 800, f.size, cta);
    const w = Math.min(ctx.measureText(cta).width, 400) + 48;
    roundRect(ctx, 44, y - 40, w, 56, 28);
    ctx.fillStyle = pal.text === "#ffffff" ? "#ffffff" : "#121212";
    ctx.fill();
    ctx.fillStyle = pal.text === "#ffffff" ? "#121212" : "#ffffff";
    ctx.textAlign = "center";
    setDir(ctx, cta);
    ctx.fillText(f.lines[0] ?? "", 44 + w / 2, y - 3);
    ctx.direction = "ltr";
  }

  ctx.restore();
  return { boxes, warnings: [...new Set(warnings)] };
}

function productCells(a: Rect, count: number): Rect[] {
  if (count <= 1) return [a];
  if (count === 4) {
    const w = (a.w - 60) / 2;
    const h = (a.h - 30) / 2;
    return [0, 1, 2, 3].map((i) => ({ x: a.x + (i % 2) * (w + 60), y: a.y + Math.floor(i / 2) * (h + 30), w, h }));
  }
  const gap = 70;
  const w = (a.w - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ x: a.x + i * (w + gap), y: a.y + 40, w, h: a.h - 80 }));
}

function plusMarks(a: Rect, count: number): Array<[number, number]> {
  if (count <= 1) return [];
  if (count === 4) return [[a.x + a.w / 2, a.y + a.h / 2]];
  const cells = productCells(a, count);
  return cells.slice(1).map((c) => [c.x - 35, c.y + c.h / 2]);
}

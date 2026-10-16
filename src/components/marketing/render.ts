// Deterministic poster composer. The same function paints the on-screen preview and the exported PNG
// (one 1080 × 1080 canvas), so what is validated is exactly what is downloaded. Prices come from the
// checked pricing object, never from free text; Arabic is shaped by the browser (direction = "rtl").
// Each style (template) changes the layout, typography, photo treatment, price treatment and decor.
import { eventById, type EventDecor } from "@/lib/events";
import { POSTER_SIZE, type ElementLayout, type PosterDesign, type PosterElement, type PosterPricing, type PosterProduct, type PosterTheme } from "@/lib/poster";

const S = POSTER_SIZE;

export type FontKind = "latin" | "display" | "serif";
export type PosterAssets = {
  photos: Map<string, HTMLImageElement | null>;
  logo: HTMLImageElement | null;
  /** CSS font-family values: Montserrat, Cairo (Arabic), Anton (condensed display), Playfair Display (serif). */
  fonts: { latin: string; arabic: string; display: string; serif: string };
  /** Realistic background photo for the "scene" style (same-origin, so the canvas stays exportable). */
  scene?: HTMLImageElement | null;
};

export type Box = { el: PosterElement; x: number; y: number; w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };
type Ctx = CanvasRenderingContext2D;

const AR = /[؀-ۿ]/;
const FLASH_YELLOW = "#ffd400";

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

type PriceStyle = "classic" | "burst" | "box" | "neon";
type PhotoStyle = "multiply" | "card" | "podium" | "circle" | "tilt" | "glass" | "cutout";
type TagStyle = "pill" | "ribbon" | "outline" | "line" | "none";
type BenefitStyle = { kind: "bubbles"; cx: number; y: number; r: number } | { kind: "pills"; x: number; y: number; w: number; onAccent?: boolean };

type Template = {
  dark: boolean;
  text: string;
  muted: string;
  strike: string;
  titleKind: FontKind;
  titleUpper: boolean;
  titleSize: number;
  align: "center" | "left";
  title: Rect;
  products: (hasBenefits: boolean) => Rect;
  price: Rect;
  priceStyle: PriceStyle;
  priceKind: FontKind;
  photo: PhotoStyle;
  tag: TagStyle;
  benefits: BenefitStyle;
  /** Bottom-left texts sit on the accent colour (diagonal style). */
  footOnAccent?: boolean;
  /** Logo drawn in colour on a white pill (when the corner is already the brand colour). */
  logoOnWhite?: boolean;
  background: (ctx: Ctx, d: PosterDesign, assets: PosterAssets) => void;
};

const CLASSIC_TITLE: Rect = { x: 90, y: 128, w: 900, h: 250 };
const CLASSIC_PRICE: Rect = { x: 540, y: 800, w: 500, h: 230 };
const classicProducts = (b: boolean): Rect => ({ x: 70, y: 390, w: b ? 770 : 940, h: 450 });
const BUBBLES: BenefitStyle = { kind: "bubbles", cx: 945, y: 430, r: 95 };

export const TEMPLATES: Record<PosterTheme, Template> = {
  studio: {
    dark: false,
    text: "#121212",
    muted: "#3a3a3a",
    strike: "#121212",
    titleKind: "latin",
    titleUpper: false,
    titleSize: 100,
    align: "center",
    title: CLASSIC_TITLE,
    products: classicProducts,
    price: CLASSIC_PRICE,
    priceStyle: "classic",
    priceKind: "latin",
    photo: "multiply",
    tag: "pill",
    benefits: BUBBLES,
    background: (ctx, d) => {
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
      plusMarks(ctx, d.accent);
      dotGrid(ctx, "rgba(255,255,255,0.9)");
    },
  },
  promo: {
    dark: false,
    text: "#121212",
    muted: "#2b2b2b",
    strike: "#121212",
    titleKind: "latin",
    titleUpper: false,
    titleSize: 100,
    align: "center",
    title: CLASSIC_TITLE,
    products: classicProducts,
    price: CLASSIC_PRICE,
    priceStyle: "classic",
    priceKind: "latin",
    photo: "multiply",
    tag: "ribbon",
    benefits: BUBBLES,
    background: (ctx, d) => {
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
      plusMarks(ctx, d.accent);
      dotGrid(ctx, "rgba(255,255,255,0.9)");
    },
  },
  premium: {
    dark: true,
    text: "#ffffff",
    muted: "#d9d9d9",
    strike: "#f2f2f2",
    titleKind: "latin",
    titleUpper: false,
    titleSize: 100,
    align: "center",
    title: CLASSIC_TITLE,
    products: classicProducts,
    price: CLASSIC_PRICE,
    priceStyle: "classic",
    priceKind: "latin",
    photo: "card",
    tag: "pill",
    benefits: BUBBLES,
    background: (ctx, d) => {
      const g = ctx.createRadialGradient(540, 560, 40, 540, 540, 820);
      g.addColorStop(0, "#2c2c31");
      g.addColorStop(1, "#0c0c0e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      glow(ctx, 540, 620, 520, hexA(d.accent, 0.45));
      plusMarks(ctx, d.accent);
      dotGrid(ctx, "rgba(255,255,255,0.35)");
    },
  },
  podium: {
    dark: false,
    text: "#141414",
    muted: "#3d3d3d",
    strike: "#141414",
    titleKind: "display",
    titleUpper: true,
    titleSize: 120,
    align: "center",
    title: { x: 90, y: 120, w: 900, h: 240 },
    products: () => ({ x: 50, y: 350, w: 700, h: 500 }),
    price: { x: 740, y: 640, w: 320, h: 320 },
    priceStyle: "burst",
    priceKind: "latin",
    photo: "podium",
    tag: "pill",
    benefits: { kind: "pills", x: 790, y: 400, w: 250 },
    background: (ctx, d) => {
      const g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, mix(d.accent, "#ffffff", 0.86));
      g.addColorStop(0.7, "#fbfaf8");
      g.addColorStop(1, mix(d.accent, "#ffffff", 0.9));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      // Large arch behind the podium, a staple of e-commerce product ads.
      ctx.save();
      ctx.fillStyle = hexA(d.accent, 0.1);
      ctx.beginPath();
      ctx.arc(410, 760, 420, Math.PI, 0);
      ctx.lineTo(830, 1080);
      ctx.lineTo(-10, 1080);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      sparkles(ctx, [[120, 400, 22], [60, 600, 14], [980, 300, 18], [1030, 1030, 16]], d.accent);
    },
  },
  neon: {
    dark: true,
    text: "#ffffff",
    muted: "#c9d3ff",
    strike: "#dfe5ff",
    titleKind: "latin",
    titleUpper: true,
    titleSize: 96,
    align: "center",
    title: CLASSIC_TITLE,
    products: classicProducts,
    price: CLASSIC_PRICE,
    priceStyle: "neon",
    priceKind: "latin",
    photo: "circle",
    tag: "outline",
    benefits: BUBBLES,
    background: (ctx, d) => {
      const g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, "#050816");
      g.addColorStop(1, "#0d1640");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      // Perspective grid floor.
      ctx.save();
      ctx.strokeStyle = hexA(d.accent, 0.35);
      ctx.lineWidth = 2;
      const horizon = 700;
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(540 + i * 30, horizon);
        ctx.lineTo(540 + i * 160, S);
        ctx.stroke();
      }
      for (let k = 0; k < 9; k++) {
        const y = horizon + Math.pow(k / 8, 1.8) * (S - horizon);
        ctx.globalAlpha = 0.25 + k * 0.08;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(S, y);
        ctx.stroke();
      }
      ctx.restore();
      glow(ctx, 540, 600, 480, hexA(d.accent, 0.35));
      glow(ctx, 900, 150, 300, "rgba(80,120,255,0.25)");
    },
  },
  split: {
    dark: false,
    text: "#121212",
    muted: "#3a3a3a",
    strike: "#ffffff",
    titleKind: "display",
    titleUpper: true,
    titleSize: 120,
    align: "left",
    title: { x: 56, y: 150, w: 420, h: 330 },
    products: () => ({ x: 505, y: 220, w: 535, h: 540 }),
    price: { x: 600, y: 830, w: 480, h: 250 },
    priceStyle: "box",
    priceKind: "display",
    photo: "tilt",
    tag: "pill",
    benefits: { kind: "pills", x: 56, y: 520, w: 330, onAccent: true },
    footOnAccent: true,
    logoOnWhite: true,
    background: (ctx, d) => {
      ctx.fillStyle = "#f7f6f3";
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = d.accent;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(620, 0);
      ctx.lineTo(420, S);
      ctx.lineTo(0, S);
      ctx.closePath();
      ctx.fill();
      // Thin parallel stripe for depth.
      ctx.fillStyle = hexA(d.accent, 0.25);
      ctx.beginPath();
      ctx.moveTo(640, 0);
      ctx.lineTo(670, 0);
      ctx.lineTo(470, S);
      ctx.lineTo(440, S);
      ctx.closePath();
      ctx.fill();
      dotGrid(ctx, "rgba(0,0,0,0.18)", [[1000, 120]]);
    },
  },
  flash: {
    dark: true,
    text: "#ffffff",
    muted: "#d6d6d6",
    strike: "#ffffff",
    titleKind: "display",
    titleUpper: true,
    titleSize: 140,
    align: "center",
    title: { x: 60, y: 110, w: 960, h: 250 },
    products: () => ({ x: 50, y: 480, w: 660, h: 390 }),
    price: { x: 710, y: 620, w: 340, h: 340 },
    priceStyle: "burst",
    priceKind: "display",
    photo: "tilt",
    tag: "none",
    benefits: { kind: "pills", x: 760, y: 486, w: 280 },
    background: (ctx, d, assets) => {
      ctx.fillStyle = "#0b0b0b";
      ctx.fillRect(0, 0, S, S);
      glow(ctx, 380, 650, 450, hexA(d.accent, 0.35));
      // Hazard band with the promo word repeated, Black-Friday style.
      const word = (d.lang === "ar" ? d.tagAr : d.tag).trim() || "PROMO";
      ctx.save();
      ctx.translate(540, 420);
      ctx.rotate(-0.05);
      ctx.fillStyle = FLASH_YELLOW;
      ctx.fillRect(-700, -38, 1400, 76);
      ctx.fillStyle = "#0b0b0b";
      ctx.font = font(assets, 400, 50, word, "display");
      ctx.textBaseline = "middle";
      setDir(ctx, word);
      const w = ctx.measureText(word).width + 60;
      for (let x = -700; x < 700; x += w) ctx.fillText(word, x, 3);
      ctx.restore();
      ctx.textBaseline = "alphabetic";
      ctx.direction = "ltr";
      bolts(ctx, [[70, 880, 1], [1010, 300, 0.8]], FLASH_YELLOW);
    },
  },
  minimal: {
    dark: false,
    text: "#1a1a1a",
    muted: "#555049",
    strike: "#1a1a1a",
    titleKind: "serif",
    titleUpper: false,
    titleSize: 96,
    align: "left",
    title: { x: 90, y: 150, w: 900, h: 220 },
    products: (b) => ({ x: 70, y: 390, w: b ? 720 : 940, h: 440 }),
    price: CLASSIC_PRICE,
    priceStyle: "classic",
    priceKind: "serif",
    photo: "multiply",
    tag: "line",
    benefits: { kind: "pills", x: 800, y: 440, w: 240 },
    background: (ctx, d) => {
      ctx.fillStyle = "#f5f1ea";
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2;
      ctx.strokeRect(28, 28, S - 56, S - 56);
      ctx.fillStyle = d.accent;
      ctx.fillRect(90, 140, 70, 6);
    },
  },
  aurora: {
    dark: true,
    text: "#ffffff",
    muted: "#e4dcff",
    strike: "#ece6ff",
    titleKind: "latin",
    titleUpper: false,
    titleSize: 100,
    align: "center",
    title: CLASSIC_TITLE,
    products: classicProducts,
    price: CLASSIC_PRICE,
    priceStyle: "neon",
    priceKind: "latin",
    photo: "glass",
    tag: "outline",
    benefits: BUBBLES,
    background: (ctx) => {
      ctx.fillStyle = "#170b33";
      ctx.fillRect(0, 0, S, S);
      glow(ctx, 180, 220, 520, "rgba(124,58,237,0.75)");
      glow(ctx, 950, 380, 480, "rgba(20,184,166,0.55)");
      glow(ctx, 640, 1000, 560, "rgba(236,72,153,0.45)");
      glow(ctx, 540, 560, 380, "rgba(255,255,255,0.08)");
      // Fine noise of stars.
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < 70; i++) {
        const x = (i * 397) % S;
        const y = (i * 613) % S;
        ctx.fillRect(x, y, 2, 2);
      }
    },
  },
  scene: {
    dark: true,
    text: "#ffffff",
    muted: "#f2f2f2",
    strike: "#ffffff",
    titleKind: "latin",
    titleUpper: false,
    titleSize: 100,
    align: "center",
    title: CLASSIC_TITLE,
    products: (b) => ({ x: 70, y: 370, w: b ? 770 : 940, h: 480 }),
    price: CLASSIC_PRICE,
    priceStyle: "classic",
    priceKind: "latin",
    photo: "cutout",
    tag: "pill",
    benefits: BUBBLES,
    background: (ctx, d, assets) => {
      const img = assets.scene;
      if (img && img.naturalWidth) {
        // Cover-fit the photo, then darken top and bottom so texts and price stay readable.
        const r = Math.max(S / img.naturalWidth, S / img.naturalHeight);
        const w = img.naturalWidth * r;
        const h = img.naturalHeight * r;
        ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      } else {
        const g = ctx.createLinearGradient(0, 0, S, S);
        g.addColorStop(0, "#3b3f46");
        g.addColorStop(1, "#15171a");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
      }
      const top = ctx.createLinearGradient(0, 0, 0, 470);
      top.addColorStop(0, "rgba(0,0,0,0.62)");
      top.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, S, 470);
      const bottom = ctx.createLinearGradient(0, 700, 0, S);
      bottom.addColorStop(0, "rgba(0,0,0,0)");
      bottom.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.fillStyle = bottom;
      ctx.fillRect(0, 700, S, S - 700);
      glow(ctx, 540, 640, 420, hexA(d.accent, 0.12));
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Product cut-out (white studio background removed) for realistic scenes
// ---------------------------------------------------------------------------------------------

type Cutout = { canvas: HTMLCanvasElement; ok: boolean };
const cutoutCache = new WeakMap<HTMLImageElement, Cutout>();

/**
 * Removes the white background of an official product photo by flood-filling near-white pixels from
 * the edges (the product itself is never touched, even where it is white inside), feathers the edge
 * and trims to the product. Falls back (ok = false) when the photo is not on a plain white background.
 */
export function cutout(img: HTMLImageElement): Cutout {
  const hit = cutoutCache.get(img);
  if (hit) return hit;
  const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  let result: Cutout = { canvas: c, ok: false };
  try {
    const data = x.getImageData(0, 0, w, h);
    const px = data.data;
    const n = w * h;
    const bg = new Uint8Array(n);
    const lum = (i: number) => (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
    const whiteish = (i: number, min: number) => {
      const lo = Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      return lo >= min && Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) - lo < 18;
    };
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    // Seeds: pure-white border pixels only.
    const seed = (i: number) => {
      if (!bg[i] && whiteish(i, 244)) {
        bg[i] = 1;
        queue[tail++] = i;
      }
    };
    // Edge-aware growth: spread only to almost identical neighbours, so the fill stops at the product's
    // outline instead of leaking into white panels of the product itself.
    const grow = (from: number, i: number) => {
      if (!bg[i] && whiteish(i, 228) && Math.abs(lum(i) - lum(from)) <= 5) {
        bg[i] = 1;
        queue[tail++] = i;
      }
    };
    for (let i = 0; i < w; i++) {
      seed(i);
      seed((h - 1) * w + i);
    }
    for (let j = 0; j < h; j++) {
      seed(j * w);
      seed(j * w + w - 1);
    }
    while (head < tail) {
      const i = queue[head++];
      const cx = i % w;
      if (cx > 0) grow(i, i - 1);
      if (cx < w - 1) grow(i, i + 1);
      if (i >= w) grow(i, i - w);
      if (i < n - w) grow(i, i + w);
    }
    const share = tail / n;
    if (share > 0.06 && share < 0.97) {
      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;
      for (let i = 0; i < n; i++) {
        if (bg[i]) {
          px[i * 4 + 3] = 0;
          continue;
        }
        const cx = i % w;
        const cy = (i - cx) / w;
        // Feather: light pixels touching the removed background become partly transparent.
        const edge = (cx > 0 && bg[i - 1]) || (cx < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < n - w && bg[i + w]);
        if (edge) {
          const lo = Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
          px[i * 4 + 3] = lo > 200 ? Math.round(255 * Math.min(1, (255 - lo) / 55)) : 255;
        }
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
      x.putImageData(data, 0, 0);
      const t = document.createElement("canvas");
      t.width = maxX - minX + 1;
      t.height = maxY - minY + 1;
      t.getContext("2d")!.drawImage(c, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
      result = { canvas: t, ok: true };
    }
  } catch {
    // Unreadable pixels (cross-origin image): keep the photo on a card instead.
  }
  cutoutCache.set(img, result);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Event decorations (drawn behind all content, kept to the margins)
// ---------------------------------------------------------------------------------------------

function prng(seedText: string) {
  let s = 0;
  for (const ch of seedText) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random points in the margins only (top band and side strips), never behind products or prices. */
function marginPoints(rand: () => number, count: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  while (out.length < count) {
    const zone = rand();
    if (zone < 0.4) out.push([330 + rand() * 420, 10 + rand() * 110]);
    else if (zone < 0.7) out.push([10 + rand() * 60, 130 + rand() * 640]);
    else out.push([1010 + rand() * 60, 130 + rand() * 480]);
  }
  return out;
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.fill();
}

function flower(ctx: Ctx, x: number, y: number, r: number, petal: string) {
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f5c518";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function lantern(ctx: Ctx, x: number, top: number, len: number, gold: string) {
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, top);
  ctx.stroke();
  glow(ctx, x, top + 42, 70, "rgba(255,190,80,0.45)");
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.moveTo(x - 14, top + 12);
  ctx.lineTo(x, top);
  ctx.lineTo(x + 14, top + 12);
  ctx.fill();
  roundRect(ctx, x - 20, top + 12, 40, len, 10);
  ctx.fillStyle = "rgba(255,200,90,0.85)";
  ctx.fill();
  ctx.strokeStyle = gold;
  ctx.lineWidth = 3;
  ctx.stroke();
  for (const dx of [-7, 7]) {
    ctx.beginPath();
    ctx.moveTo(x + dx, top + 16);
    ctx.lineTo(x + dx, top + 8 + len);
    ctx.stroke();
  }
  ctx.fillStyle = gold;
  ctx.fillRect(x - 12, top + 12 + len, 24, 6);
}

function crescent(ctx: Ctx, x: number, y: number, r: number, color: string) {
  // Outer disc clipped by an offset inner disc (without erasing the background behind it).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S, S);
  ctx.arc(x + r * 0.42, y - r * 0.18, r * 0.86, 0, Math.PI * 2);
  ctx.clip("evenodd");
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function pencil(ctx: Ctx, x: number, y: number, len: number, angle: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#f6c12d";
  ctx.fillRect(0, -9, len, 18);
  ctx.fillStyle = "#e88aa0";
  ctx.fillRect(-14, -9, 14, 18);
  ctx.fillStyle = "#b9b9b9";
  ctx.fillRect(-4, -9, 6, 18);
  ctx.fillStyle = "#f1d9b5";
  ctx.beginPath();
  ctx.moveTo(len, -9);
  ctx.lineTo(len + 24, 0);
  ctx.lineTo(len, 9);
  ctx.fill();
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(len + 16, -3);
  ctx.lineTo(len + 24, 0);
  ctx.lineTo(len + 16, 3);
  ctx.fill();
  ctx.restore();
}

function drawEventDecor(ctx: Ctx, d: PosterDesign, decor: EventDecor, seed: string) {
  const rand = prng(seed);
  const gold = "#d4a017";
  ctx.save();
  if (decor === "confetti") {
    const colors = [d.accent, gold, "#ffffff", "#1f9bd1"];
    for (const [x, y] of marginPoints(rand, 70)) {
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rand() * Math.PI);
      if (rand() < 0.6) ctx.fillRect(-4, -10, 8, 20);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  } else if (decor === "hearts") {
    for (const [x, y] of marginPoints(rand, 16)) {
      ctx.globalAlpha = 0.6 + rand() * 0.4;
      ctx.fillStyle = rand() < 0.6 ? d.accent : "#ff7aa2";
      heart(ctx, x, y - 16, 22 + rand() * 26);
    }
  } else if (decor === "flowers") {
    for (const [x, y] of marginPoints(rand, 12)) flower(ctx, x, y, 18 + rand() * 18, rand() < 0.5 ? "#f7a1c4" : "#ffffff");
  } else if (decor === "crescent") {
    lantern(ctx, 360, 20, 62, gold);
    lantern(ctx, 720, 6, 52, gold);
    crescent(ctx, 1010, 200, 44, gold);
    sparkles(ctx, [[960, 260, 10], [1040, 290, 7], [60, 260, 12], [40, 420, 8], [620, 50, 9], [470, 90, 7]], gold);
  } else if (decor === "flag") {
    // Red and white bunting, the national colours, strung across the top.
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(320, 14);
    ctx.quadraticCurveTo(540, 60, 760, 14);
    ctx.stroke();
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const x = 320 + t * 440;
      const y = 14 + Math.sin(t * Math.PI) * 23;
      ctx.fillStyle = i % 2 ? "#ffffff" : "#e70013";
      ctx.beginPath();
      ctx.moveTo(x - 18, y);
      ctx.lineTo(x + 18, y);
      ctx.lineTo(x, y + 40);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (decor === "percent") {
    ctx.fillStyle = hexA(d.accent, 0.16);
    ctx.textAlign = "center";
    for (const [x, y] of marginPoints(rand, 8)) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.3 + rand() * 0.6);
      ctx.font = `900 ${Math.round(50 + rand() * 50)}px sans-serif`;
      ctx.fillText("%", 0, 20);
      ctx.restore();
    }
  } else if (decor === "sun") {
    ctx.fillStyle = "rgba(255,201,60,0.85)";
    ctx.beginPath();
    ctx.arc(560, -10, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,201,60,0.8)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const a = (Math.PI * (i + 0.5)) / 9;
      ctx.beginPath();
      ctx.moveTo(560 + Math.cos(a) * 88, -10 + Math.sin(a) * 88);
      ctx.lineTo(560 + Math.cos(a) * 118, -10 + Math.sin(a) * 118);
      ctx.stroke();
    }
  } else if (decor === "school") {
    pencil(ctx, 360, 70, 150, -0.12);
    pencil(ctx, 620, 40, 120, 0.1);
    pencil(ctx, 30, 520, 140, 1.3);
    pencil(ctx, 1050, 300, 140, 1.8);
  } else if (decor === "bolts") {
    bolts(ctx, [[400, 70, 0.8], [700, 60, 0.7], [40, 640, 1], [1040, 520, 0.8]], d.theme === "flash" ? FLASH_YELLOW : d.accent);
  } else {
    sparkles(ctx, marginPoints(rand, 10).map(([x, y]) => [x, y, 8 + rand() * 14] as [number, number, number]), gold);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Price as printed on Tunisian posters: "669", "1 978", "89,500". */
export function priceText(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  const int = Math.trunc(r)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = Math.round((r - Math.trunc(r)) * 1000);
  return frac ? `${int},${String(frac).padStart(3, "0")}` : int;
}

function font(assets: PosterAssets, weight: number, size: number, text: string, kind: FontKind = "latin", italic = false) {
  const arabic = AR.test(text);
  const family = arabic ? assets.fonts.arabic : assets.fonts[kind];
  // Anton exists in one weight only.
  const w = !arabic && kind === "display" ? 400 : weight;
  return `${italic ? "italic " : ""}${w} ${Math.round(size)}px ${family}`;
}

function setDir(ctx: Ctx, text: string) {
  // Right-to-left only for purely Arabic lines; a bilingual line keeps the French reading order.
  ctx.direction = AR.test(text) && !/[A-Za-z]/.test(text) ? "rtl" : "ltr";
}
const isRtl = (text: string) => AR.test(text) && !/[A-Za-z]/.test(text);

/** Word-wraps `text` into at most `maxLines`, shrinking from `size` to `minSize`. */
function fit(ctx: Ctx, assets: PosterAssets, text: string, weight: number, size: number, minSize: number, maxW: number, maxLines: number, kind: FontKind = "latin") {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let s = size;
  for (;;) {
    ctx.font = font(assets, weight, s, text, kind);
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

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function withLayout(ctx: Ctx, area: Rect, l: ElementLayout, draw: () => void): Rect {
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

function hexA(hex: string, a: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** Mix of two hex colours; t = share of `b`. */
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function plusMarks(ctx: Ctx, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
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
  ctx.restore();
}

function dotGrid(ctx: Ctx, color: string, origins: Array<[number, number]> = [[40, 560], [1010, 250]]) {
  ctx.save();
  ctx.fillStyle = color;
  for (const [ox, oy] of origins)
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) {
        ctx.beginPath();
        ctx.arc(ox + c * 14, oy + r * 14, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
  ctx.restore();
}

function sparkles(ctx: Ctx, items: Array<[number, number, number]>, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  for (const [x, y, r] of items) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 ? r * 0.28 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function bolts(ctx: Ctx, items: Array<[number, number, number]>, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  for (const [x, y, s] of items) {
    ctx.beginPath();
    for (const [px, py] of [[10, -60], [-24, 6], [-2, 6], [-12, 60], [26, -10], [4, -10], [18, -60]]) ctx.lineTo(x + px * s, y + py * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function starburst(ctx: Ctx, cx: number, cy: number, r: number, points = 18, inner = 0.86) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
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

function drawLogo(ctx: Ctx, d: PosterDesign, t: Template, assets: PosterAssets) {
  const img = assets.logo;
  if (!img || !img.naturalWidth) return;
  const ratio = img.naturalWidth / img.naturalHeight;
  if (d.brand === "numedia" && !t.logoOnWhite) {
    // Official logo in white on the brand-red pill, as on NUMEDIA's posters.
    const h = 40;
    const w = h * ratio;
    roundRect(ctx, 44, 40, w + 56, h + 34, (h + 34) / 2);
    ctx.fillStyle = d.accent;
    ctx.fill();
    ctx.drawImage(whiteLogo(img), 72, 57, w, h);
  } else if (d.brand === "numedia") {
    // On a red corner: the logo in its own colours (light grey + red) on a dark pill.
    const h = 40;
    const w = h * ratio;
    roundRect(ctx, 44, 40, w + 56, h + 34, (h + 34) / 2);
    ctx.fillStyle = "#121212";
    ctx.fill();
    ctx.drawImage(img, 72, 57, w, h);
  } else {
    const h = 58;
    const w = h * ratio;
    roundRect(ctx, 44, 36, w + 40, h + 28, 18);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.drawImage(img, 64, 50, w, h);
  }
}

function drawTag(ctx: Ctx, d: PosterDesign, t: Template, assets: PosterAssets, text: string) {
  if (!text.trim() || t.tag === "none") return;
  ctx.save();
  setDir(ctx, text);
  if (t.tag === "ribbon") {
    // Tilted ribbon, as on the yellow "PROMOWET" posters.
    ctx.font = font(assets, 900, 50, text, "latin", !AR.test(text));
    const w = ctx.measureText(text).width + 56;
    ctx.translate(S - 44 - w / 2, 82);
    ctx.rotate(-0.07);
    ctx.fillStyle = d.accent;
    ctx.fillRect(-w / 2, -38, w, 72);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 16);
  } else if (t.tag === "line") {
    ctx.font = font(assets, 700, 26, text);
    ctx.letterSpacing = "6px";
    ctx.textAlign = "right";
    ctx.fillStyle = t.text;
    ctx.fillText(text.toUpperCase(), S - 70, 84);
    const w = ctx.measureText(text.toUpperCase()).width;
    ctx.fillStyle = d.accent;
    ctx.fillRect(S - 70 - w, 98, w, 4);
  } else {
    ctx.font = font(assets, 800, 30, text);
    const w = ctx.measureText(text).width + 48;
    roundRect(ctx, S - 44 - w, 46, w, 60, 30);
    if (t.tag === "outline") {
      ctx.strokeStyle = d.accent;
      ctx.lineWidth = 4;
      ctx.shadowColor = d.accent;
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = t.dark ? "#ffffff" : "#121212";
      ctx.fill();
      ctx.fillStyle = t.dark ? "#121212" : "#ffffff";
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, S - 44 - w / 2, 77);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------

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

function plusPositions(a: Rect, count: number): Array<[number, number]> {
  if (count <= 1) return [];
  if (count === 4) return [[a.x + a.w / 2, a.y + a.h / 2]];
  return productCells(a, count)
    .slice(1)
    .map((c) => [c.x - 35, c.y + c.h / 2]);
}

function fitImage(img: HTMLImageElement, box: Rect) {
  const r = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
  const w = img.naturalWidth * r;
  const h = img.naturalHeight * r;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function drawProduct(ctx: Ctx, d: PosterDesign, t: Template, assets: PosterAssets, img: HTMLImageElement | null | undefined, cell: Rect, index: number) {
  const ok = img && img.naturalWidth;
  ctx.save();
  if (t.photo === "card" || t.photo === "tilt" || t.photo === "glass") {
    if (t.photo === "tilt") {
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(index % 2 ? 0.05 : -0.045);
      ctx.translate(-cx, -cy);
    }
    roundRect(ctx, cell.x, cell.y, cell.w, cell.h, t.photo === "glass" ? 40 : 32);
    ctx.fillStyle = t.photo === "glass" ? "rgba(255,255,255,0.94)" : "#ffffff";
    ctx.shadowColor = t.photo === "glass" ? hexA(d.accent, 0.45) : "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 14;
    ctx.fill();
    ctx.shadowColor = "transparent";
    if (t.photo === "glass") {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (ok) {
      const p = fitImage(img, { x: cell.x + 24, y: cell.y + 24, w: cell.w - 48, h: cell.h - 48 });
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
  } else if (t.photo === "cutout" && ok) {
    const cut = cutout(img);
    if (cut.ok) {
      // Product standing in the scene: bottom on the floor line, soft contact shadow, slight drop shadow.
      const src = cut.canvas;
      const r = Math.min(cell.w / src.width, (cell.h - 20) / src.height);
      const w = src.width * r;
      const h = src.height * r;
      const x0 = cell.x + (cell.w - w) / 2;
      const floor = cell.y + cell.h - 10;
      const shadow = ctx.createRadialGradient(x0 + w / 2, floor, 0, x0 + w / 2, floor, w * 0.55);
      shadow.addColorStop(0, "rgba(0,0,0,0.55)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.translate(x0 + w / 2, floor);
      ctx.scale(1, 0.12);
      ctx.translate(-(x0 + w / 2), -floor);
      ctx.fillStyle = shadow;
      ctx.fillRect(x0 - w * 0.1, floor - w * 0.6, w * 1.2, w * 1.2);
      ctx.restore();
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 12;
      ctx.drawImage(src, x0, floor - h, w, h);
    } else {
      // Not on a plain white background: present it on a white card instead.
      roundRect(ctx, cell.x + 40, cell.y + 20, cell.w - 80, cell.h - 40, 32);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 40;
      ctx.fill();
      ctx.shadowColor = "transparent";
      const p = fitImage(img, { x: cell.x + 64, y: cell.y + 44, w: cell.w - 128, h: cell.h - 88 });
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
  } else if (t.photo === "circle") {
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    const r = Math.min(cell.w, cell.h) / 2 - 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = d.accent;
    ctx.shadowBlur = 50;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 8;
    ctx.strokeStyle = d.accent;
    ctx.stroke();
    if (ok) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
      ctx.clip();
      const side = r * 1.45;
      const p = fitImage(img, { x: cx - side / 2, y: cy - side / 2, w: side, h: side });
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
  } else if (t.photo === "podium") {
    const cx = cell.x + cell.w / 2;
    const rx = Math.min(cell.w * 0.46, 300);
    const ry = rx * 0.2;
    const topY = cell.y + cell.h - 70;
    // Floor shadow, cylinder body, then the top face.
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(cx, topY + 66, rx * 1.08, ry * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    body.addColorStop(0, "#e9e5df");
    body.addColorStop(0.5, "#ffffff");
    body.addColorStop(1, "#dcd7d0");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, topY + 56, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(cx - rx, topY);
    ctx.ellipse(cx, topY, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fdfcfa";
    ctx.beginPath();
    ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(d.accent, 0.5);
    ctx.lineWidth = 3;
    ctx.stroke();
    if (ok) {
      const p = fitImage(img, { x: cell.x + 10, y: cell.y, w: cell.w - 20, h: topY - cell.y + ry * 0.6 });
      ctx.globalCompositeOperation = "multiply";
      // Sit the product on the podium.
      ctx.drawImage(img, p.x, topY + ry * 0.6 - p.h, p.w, p.h);
    }
  } else if (ok) {
    const p = fitImage(img, cell);
    // The official photos have a white background: "multiply" blends it into light backgrounds.
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(img, p.x, p.y, p.w, p.h);
  }
  ctx.restore();
  if (!ok) {
    ctx.save();
    ctx.fillStyle = "#8a8a8a";
    ctx.textAlign = "center";
    ctx.font = font(assets, 600, 26, "Photo");
    ctx.fillText("Photo officielle manquante", cell.x + cell.w / 2, cell.y + cell.h / 2);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------------------------

function drawPrice(ctx: Ctx, d: PosterDesign, t: Template, assets: PosterAssets, pricing: PosterPricing, area: Rect) {
  const big = priceText(pricing.price!);
  const old = pricing.oldPrice != null ? priceText(pricing.oldPrice) : null;
  const k = t.priceKind;
  ctx.direction = "ltr";

  if (t.priceStyle === "burst") {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const r = Math.min(area.w, area.h) / 2;
    const fill = d.theme === "flash" ? FLASH_YELLOW : d.accent;
    const ink = d.theme === "flash" ? "#0b0b0b" : "#ffffff";
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.08);
    ctx.translate(-cx, -cy);
    starburst(ctx, cx, cy, r);
    ctx.fillStyle = fill;
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.fillStyle = ink;
    let size = 150;
    ctx.font = font(assets, 900, size, big, k);
    while (size > 60 && ctx.measureText(big).width > r * 1.45) {
      size -= 6;
      ctx.font = font(assets, 900, size, big, k);
    }
    const baseY = cy + size * 0.32 + (old ? 14 : 0);
    ctx.fillText(big, cx, baseY);
    ctx.font = font(assets, 900, 44, "DT", k);
    ctx.fillText("DT", cx, baseY + 50);
    if (old) {
      ctx.font = font(assets, 800, 40, old, k);
      const w = ctx.measureText(`${old} DT`).width;
      const oy = cy - size * 0.55;
      ctx.globalAlpha = 0.85;
      ctx.fillText(`${old} DT`, cx, oy);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2 - 4, oy - 6);
      ctx.lineTo(cx + w / 2 + 4, oy - 22);
      ctx.stroke();
    }
    ctx.restore();
    if (pricing.discountPct != null) sticker(ctx, d, t, assets, `-${pricing.discountPct}%`, cx - r * 0.78, cy - r * 0.72);
    return;
  }

  if (t.priceStyle === "box") {
    // Solid corner block, flush with the poster edge.
    ctx.fillStyle = "#121212";
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = d.accent;
    ctx.fillRect(area.x, area.y, area.w, 10);
    const left = area.x + 44;
    let size = 170;
    ctx.font = font(assets, 900, size, big, k);
    ctx.font = font(assets, 900, 60, "DT", k);
    const wDt = ctx.measureText("DT").width;
    ctx.font = font(assets, 900, size, big, k);
    // Fits the width, and the height left under the crossed-out price.
    const maxH = old ? area.h - 42 - 52 - 22 : area.h - 70;
    size = Math.min(size, maxH);
    ctx.font = font(assets, 900, size, big, k);
    while (size > 70 && ctx.measureText(big).width > area.w - 88 - wDt - 14) {
      size -= 6;
      ctx.font = font(assets, 900, size, big, k);
    }
    const baseline = area.y + area.h - 42;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(big, left, baseline);
    const wBig = ctx.measureText(big).width;
    ctx.fillStyle = d.accent;
    ctx.font = font(assets, 900, 60, "DT", k);
    ctx.fillText("DT", left + wBig + 14, baseline - size * 0.42);
    if (old) {
      ctx.font = font(assets, 700, 34, old);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      const label = `${old} DT`;
      const w = ctx.measureText(label).width;
      const oy = area.y + 52;
      ctx.fillText(label, left, oy);
      ctx.strokeStyle = d.accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(left - 4, oy - 8);
      ctx.lineTo(left + w + 4, oy - 22);
      ctx.stroke();
    }
    if (pricing.discountPct != null) sticker(ctx, d, t, assets, `-${pricing.discountPct}%`, area.x + area.w - 80, area.y + 10);
    return;
  }

  // classic / neon: big number, then a column with "DT" on top and the crossed-out price below.
  const right = area.x + area.w;
  ctx.font = font(assets, 900, 76, "DT", k);
  const wDt = ctx.measureText("DT").width;
  ctx.font = font(assets, 800, 64, old ?? "0", k);
  const wOld = old ? ctx.measureText(old).width : 0;
  ctx.font = font(assets, 800, 30, "DT", k);
  const wOldDt = ctx.measureText("DT").width;
  const colW = Math.max(wDt, old ? wOld + 6 + wOldDt : 0);
  let bigSize = 190;
  ctx.font = font(assets, 900, bigSize, big, k);
  while (bigSize > 100 && ctx.measureText(big).width > area.w - colW - 12) {
    bigSize -= 6;
    ctx.font = font(assets, 900, bigSize, big, k);
  }
  const wBig = ctx.measureText(big).width;
  const baseline = area.y + 178;
  const x0 = right - colW - 12 - wBig;
  const colX = right - colW;
  ctx.textAlign = "left";
  if (t.priceStyle === "neon") {
    ctx.save();
    ctx.shadowColor = d.accent;
    ctx.shadowBlur = 36;
    ctx.fillStyle = "#ffffff";
    // Two passes build a stronger glow (an outline would show glyph-overlap artefacts).
    ctx.fillText(big, x0, baseline);
    ctx.fillText(big, x0, baseline);
    ctx.restore();
  } else {
    if (!t.dark) {
      // White outline keeps the price readable over any part of the photo.
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 14;
      ctx.strokeText(big, x0, baseline);
    }
    ctx.fillStyle = d.accent;
    ctx.fillText(big, x0, baseline);
  }
  ctx.fillStyle = d.accent;
  ctx.font = font(assets, 900, 76, "DT", k);
  // Keep "DT" clear of the crossed-out price below it, whatever the size of the number.
  ctx.fillText("DT", colX, old ? Math.min(baseline - bigSize * 0.5, baseline - 80) : baseline - bigSize * 0.5);
  if (old) {
    ctx.fillStyle = t.strike;
    ctx.font = font(assets, 800, 64, old, k);
    ctx.fillText(old, colX, baseline);
    ctx.font = font(assets, 800, 30, "DT", k);
    ctx.fillText("DT", colX + wOld + 6, baseline);
    ctx.strokeStyle = d.accent;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(colX - 4, baseline - 10);
    ctx.lineTo(colX + wOld + 8, baseline - 38);
    ctx.stroke();
  }
  // Sticker just above the number, so it never covers a digit or the bottom-left texts.
  if (pricing.discountPct != null) sticker(ctx, d, t, assets, `-${pricing.discountPct}%`, x0 + 62, baseline - bigSize * 0.72 - 74);
}

function sticker(ctx: Ctx, d: PosterDesign, t: Template, assets: PosterAssets, label: string, cx: number, cy: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 60, 0, Math.PI * 2);
  ctx.fillStyle = t.dark ? "#ffffff" : "#121212";
  ctx.fill();
  ctx.fillStyle = t.dark ? "#121212" : "#ffffff";
  ctx.textAlign = "center";
  ctx.font = font(assets, 900, 38, label);
  ctx.fillText(label, cx, cy + 13);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Poster
// ---------------------------------------------------------------------------------------------

export type DrawResult = { boxes: Box[]; warnings: string[] };

export function drawPoster(ctx: Ctx, d: PosterDesign, products: PosterProduct[], pricing: PosterPricing, assets: PosterAssets): DrawResult {
  const warnings: string[] = [];
  const boxes: Box[] = [];
  const t = TEMPLATES[d.theme] ?? TEMPLATES.studio;
  const ar = d.lang === "ar";
  const bi = d.lang === "bi";
  ctx.save();
  ctx.clearRect(0, 0, S, S);
  ctx.textBaseline = "alphabetic";
  ctx.direction = "ltr";
  t.background(ctx, d, assets);
  const ev = eventById(d.event);
  if (ev) drawEventDecor(ctx, d, ev.decor, ev.id);
  drawLogo(ctx, d, t, assets);
  drawTag(ctx, d, t, assets, ar ? d.tagAr : d.tag);

  const benefits = (ar ? d.benefitsAr : d.benefits).map((b) => b.trim()).filter(Boolean);
  const benefitsAr = bi ? d.benefitsAr.map((b) => b.trim()).filter(Boolean) : [];
  const hasBenefits = benefits.length > 0 || benefitsAr.length > 0;
  const titleColor = t.footOnAccent ? "#ffffff" : t.text;
  const subColor = t.footOnAccent ? "rgba(255,255,255,0.9)" : t.muted;

  // ---------- Title block ----------
  const titleArea = t.title;
  const titleBox = withLayout(ctx, titleArea, d.layout.title, () => {
    const rawMain = ar ? d.titleAr : d.title;
    const main = t.titleUpper && !AR.test(rawMain) ? rawMain.toUpperCase() : rawMain;
    const sub = ar ? d.subtitleAr || d.subtitle : d.subtitle;
    const anchor = (text: string) => {
      if (t.align === "center") return { x: titleArea.x + titleArea.w / 2, align: "center" as const };
      // Left-aligned layouts: Arabic lines hang from the right edge of the same block.
      return isRtl(text) ? { x: titleArea.x + titleArea.w, align: "right" as const } : { x: titleArea.x, align: "left" as const };
    };
    let y = titleArea.y;
    const maxLines = t.titleKind === "display" ? 3 : 2;
    const tf = fit(ctx, assets, main, 900, t.titleSize, 48, titleArea.w, maxLines, t.titleKind);
    if (tf.overflow) warnings.push("Le titre est trop long : il est coupé.");
    setDir(ctx, main);
    ctx.font = font(assets, 900, tf.size, main, t.titleKind);
    ctx.fillStyle = titleColor;
    if (d.theme === "neon") {
      ctx.shadowColor = d.accent;
      ctx.shadowBlur = 28;
    } else if (d.theme === "scene") {
      // Soft shadow keeps white text readable on any photo.
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 18;
    }
    // Serif capitals carry tall accents (É, È): give their lines more room.
    const lineH = t.titleKind === "display" ? 1.0 : t.titleKind === "serif" ? 1.12 : 0.95;
    for (const line of tf.lines) {
      y += tf.size * lineH;
      const a = anchor(line);
      ctx.textAlign = a.align;
      ctx.fillText(line, a.x, y);
    }
    ctx.shadowBlur = 0;
    if (bi && d.titleAr.trim()) {
      const af = fit(ctx, assets, d.titleAr, 800, 54, 34, titleArea.w, 1);
      setDir(ctx, d.titleAr);
      ctx.font = font(assets, 800, af.size, d.titleAr);
      y += af.size * 1.2 + 6;
      const a = anchor(d.titleAr);
      ctx.textAlign = a.align;
      ctx.fillStyle = d.theme === "split" ? "#ffffff" : t.dark ? "#ffffff" : d.accent;
      ctx.fillText(af.lines[0] ?? "", a.x, y);
    }
    if (sub.trim()) {
      const sf = fit(ctx, assets, sub, 600, 46, 26, titleArea.w, 2);
      y += 16; // breathing room under the heavy headline
      if (sf.overflow) warnings.push("Le sous-titre est trop long : il est coupé.");
      setDir(ctx, sub);
      ctx.font = font(assets, 600, sf.size, sub);
      ctx.fillStyle = subColor;
      for (const line of sf.lines) {
        y += sf.size * 1.15;
        const a = anchor(line);
        ctx.textAlign = a.align;
        ctx.fillText(line, a.x, y);
      }
    }
    if (y > titleArea.y + titleArea.h + 12) warnings.push("Le bloc titre déborde : raccourcissez le titre ou le sous-titre.");
    ctx.direction = "ltr";
  });
  boxes.push({ el: "title", ...titleBox });

  // ---------- Products ----------
  const prodArea = t.products(hasBenefits && t.benefits.kind === "bubbles");
  const ordered = d.productOrder.map((id) => products.find((p) => p.id === id)).filter((p): p is PosterProduct => Boolean(p));
  const prodBox = withLayout(ctx, prodArea, d.layout.products, () => {
    const cells = productCells(prodArea, ordered.length);
    ordered.forEach((p, i) => drawProduct(ctx, d, t, assets, assets.photos.get(p.id), cells[i], i));
    // "+" between pack items.
    ctx.fillStyle = d.theme === "flash" ? FLASH_YELLOW : d.accent;
    ctx.textAlign = "center";
    ctx.font = font(assets, 900, 96, "+");
    for (const [x, y] of plusPositions(prodArea, ordered.length)) ctx.fillText("+", x, y + 34);
  });
  boxes.push({ el: "products", ...prodBox });

  // ---------- Benefits ----------
  if (hasBenefits) {
    const items = bi ? benefits.map((b, i) => [b, benefitsAr[i] ?? ""] as [string, string]) : benefits.map((b) => [b, ""] as [string, string]);
    if (bi) for (let i = benefits.length; i < benefitsAr.length; i++) items.push(["", benefitsAr[i]]);
    const bs = t.benefits;
    if (bs.kind === "bubbles") {
      const area: Rect = { x: bs.cx - bs.r, y: bs.y, w: bs.r * 2, h: bs.r * 2 * items.length + 16 * (items.length - 1) };
      const b = withLayout(ctx, area, d.layout.benefits, () => {
        items.forEach(([fr, arTxt], i) => {
          const cy = bs.y + bs.r + i * (bs.r * 2 + 16);
          ctx.beginPath();
          ctx.arc(bs.cx, cy, bs.r, 0, Math.PI * 2);
          ctx.fillStyle = d.accent;
          ctx.shadowColor = d.theme === "neon" || d.theme === "aurora" ? d.accent : "rgba(0,0,0,0.25)";
          ctx.shadowBlur = 18;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          const lines: Array<[string, number]> = [];
          for (const txt of [fr, arTxt].filter(Boolean)) {
            const f = fit(ctx, assets, txt, 800, 30, 18, bs.r * 1.55, fr && arTxt ? 2 : 3);
            if (f.overflow) warnings.push(`Avantage trop long : « ${txt} ».`);
            for (const l of f.lines) lines.push([l, f.size]);
          }
          const total = lines.reduce((s, [, sz]) => s + sz * 1.1, 0);
          let y = cy - total / 2;
          for (const [l, sz] of lines) {
            y += sz * 1.1;
            setDir(ctx, l);
            ctx.font = font(assets, 800, sz, l);
            ctx.fillText(l, bs.cx, y - sz * 0.18);
          }
          ctx.direction = "ltr";
        });
      });
      boxes.push({ el: "benefits", ...b });
    } else {
      // Bilingual pills carry two lines: French above, Arabic below (never cut mid-sentence).
      const two = items.some(([fr, arTxt]) => fr && arTxt);
      const pillH = two ? 84 : 54;
      const step = pillH + 12;
      const area: Rect = { x: bs.x, y: bs.y, w: bs.w, h: items.length * step - 12 };
      const b = withLayout(ctx, area, d.layout.benefits, () => {
        items.forEach((pair, i) => {
          const y = bs.y + i * step;
          const lines = pair.filter(Boolean).map((txt) => {
            const f = fit(ctx, assets, txt, 800, 26, 15, bs.w - 70, 1);
            if (f.overflow) warnings.push(`Avantage trop long : « ${txt} ».`);
            ctx.font = font(assets, 800, f.size, txt);
            return { txt: f.lines[0] ?? "", size: f.size, width: ctx.measureText(f.lines[0] ?? "").width };
          });
          const w = Math.min(bs.w, Math.max(...lines.map((l) => l.width)) + 78);
          roundRect(ctx, bs.x, y, w, pillH, 27);
          if (bs.onAccent) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            ctx.stroke();
          } else {
            ctx.fillStyle = d.theme === "flash" ? "#1c1c1c" : t.dark ? "rgba(255,255,255,0.12)" : "#ffffff";
            ctx.shadowColor = "rgba(0,0,0,0.12)";
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
          // Check-mark dot.
          ctx.beginPath();
          ctx.arc(bs.x + 28, y + pillH / 2, 11, 0, Math.PI * 2);
          ctx.fillStyle = bs.onAccent ? "#ffffff" : d.theme === "flash" ? FLASH_YELLOW : d.accent;
          ctx.fill();
          ctx.fillStyle = bs.onAccent || t.dark ? "#ffffff" : "#121212";
          lines.forEach((l, j) => {
            const baseline = lines.length === 2 ? y + 36 + j * 34 : y + pillH / 2 + l.size * 0.36;
            setDir(ctx, l.txt);
            ctx.textAlign = isRtl(l.txt) ? "right" : "left";
            ctx.font = font(assets, 800, l.size, l.txt);
            ctx.fillText(l.txt, isRtl(l.txt) ? bs.x + w - 20 : bs.x + 50, baseline);
          });
          ctx.direction = "ltr";
        });
      });
      boxes.push({ el: "benefits", ...b });
    }
  }

  // ---------- Price ----------
  if (pricing.price != null) {
    const p = withLayout(ctx, t.price, d.layout.price, () => drawPrice(ctx, d, t, assets, pricing, t.price));
    boxes.push({ el: "price", ...p });
  }

  // ---------- Bottom left: call to action, contact, validity ----------
  const footText = t.footOnAccent ? "#ffffff" : t.text;
  const footMuted = t.footOnAccent ? "rgba(255,255,255,0.88)" : t.muted;
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
  const footW = t.footOnAccent ? 360 : 450;
  for (const v of validity.reverse()) {
    ctx.fillStyle = footText;
    setDir(ctx, v);
    ctx.textAlign = AR.test(v) ? "right" : "left";
    const vf = fit(ctx, assets, v, 800, 28, 16, footW, 1);
    ctx.font = font(assets, 800, vf.size, v);
    ctx.fillText(vf.lines[0] ?? "", AR.test(v) ? 48 + footW : 48, y);
    y -= 38;
  }
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  if (d.footer.trim()) {
    ctx.fillStyle = footMuted;
    const f = fit(ctx, assets, d.footer, 600, 24, 15, footW, 1);
    ctx.font = font(assets, 600, f.size, d.footer);
    ctx.fillText(f.lines[0] ?? "", 48, y);
    y -= 44;
  }
  const cta = [ar ? d.ctaAr : d.cta, bi ? d.ctaAr : ""].map((s) => s.trim()).filter(Boolean).join("  ·  ");
  if (cta) {
    const f = fit(ctx, assets, cta, 800, 28, 16, footW - 50, 1);
    if (f.overflow) warnings.push("L'appel à l'action est trop long.");
    ctx.font = font(assets, 800, f.size, cta);
    const w = Math.min(ctx.measureText(f.lines[0] ?? "").width, footW - 50) + 48;
    roundRect(ctx, 44, y - 40, w, 56, 28);
    const light = t.dark || t.footOnAccent;
    ctx.fillStyle = d.theme === "flash" ? FLASH_YELLOW : light ? "#ffffff" : "#121212";
    ctx.fill();
    ctx.fillStyle = d.theme === "flash" ? "#0b0b0b" : t.footOnAccent ? d.accent : light ? "#121212" : "#ffffff";
    ctx.textAlign = "center";
    setDir(ctx, cta);
    ctx.fillText(f.lines[0] ?? "", 44 + w / 2, y - 3);
    ctx.direction = "ltr";
  }

  ctx.restore();
  return { boxes, warnings: [...new Set(warnings)] };
}

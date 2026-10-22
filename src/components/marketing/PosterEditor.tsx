"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  BringToFront,
  CalendarDays,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  FlipHorizontal,
  ImagePlus,
  Images,
  Layers,
  LayoutTemplate,
  Lock,
  LockOpen,
  Maximize,
  Minus,
  MousePointer2,
  Redo2,
  RotateCcw,
  Save,
  SendToBack,
  Shapes,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Square,
  Star,
  Tag,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { drawPoster, type Box, type PosterAssets } from "@/components/marketing/render";
import { deleteUploadAction, generateSceneAction, refreshPhotoAction, saveCampaignAction, uploadImageAction, validateCampaignAction } from "@/lib/marketing-actions";
import {
  BRAND_COLORS,
  checkPoster,
  fmt,
  applyEvent,
  MAX_LAYERS,
  normalizeDesign,
  POSTER_SIZE,
  posterFileName,
  THEMES,
  type ElementLayout,
  type HideableElement,
  type LayerFont,
  type PosterDesign,
  type PosterElement,
  type PosterLayer,
  type PosterProduct,
  type ShapeKind,
} from "@/lib/poster";
import { formatWhen, relativeTime } from "@/lib/money";
import { eventById, upcomingEvents } from "@/lib/events";

type Version = { at: string; design: PosterDesign };
type Upload = { id: string; url: string; name: string };
type Pt = { x: number; y: number };
type Tab = "layers" | "style" | "texts" | "price" | "images" | "export";
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const S = POSTER_SIZE;
const RAD = Math.PI / 180;
const HOME: ElementLayout = { dx: 0, dy: 0, scale: 1, rot: 0 };
const BUILTINS: PosterElement[] = ["title", "products", "price", "benefits"];
const ELEMENT_LABELS: Record<PosterElement, string> = { title: "Titre", products: "Produits (bloc)", price: "Prix", benefits: "Avantages" };
const HIDE_LABELS: Record<HideableElement, string> = { title: "Titre", benefits: "Avantages", tag: "Étiquette", logo: "Logo", footer: "Pied d’affiche (contact, appel à l’action)" };
const SWATCHES = ["#ffffff", "#111111", "#e30613", "#a51e35", "#ffd400", "#0b4a56", "#0b8fa3", "#16a34a", "#7c3aed", "#f97316"];
const FONTS: Array<{ value: LayerFont; label: string }> = [
  { value: "latin", label: "Montserrat" },
  { value: "display", label: "Anton (affiche)" },
  { value: "serif", label: "Playfair (élégant)" },
  { value: "arabic", label: "Cairo (arabe)" },
];
const SHAPES: Array<{ value: ShapeKind; label: string; icon: ReactNode }> = [
  { value: "rect", label: "Rectangle", icon: <Square size={16} /> },
  { value: "ellipse", label: "Cercle", icon: <Circle size={16} /> },
  { value: "burst", label: "Pastille étoilée", icon: <Star size={16} /> },
  { value: "ribbon", label: "Ruban", icon: <Tag size={16} /> },
  { value: "line", label: "Ligne", icon: <Minus size={16} /> },
];
const HANDLES: Array<{ h: Handle; x: number; y: number; cursor: string }> = [
  { h: "nw", x: -1, y: -1, cursor: "nwse-resize" },
  { h: "n", x: 0, y: -1, cursor: "ns-resize" },
  { h: "ne", x: 1, y: -1, cursor: "nesw-resize" },
  { h: "e", x: 1, y: 0, cursor: "ew-resize" },
  { h: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { h: "s", x: 0, y: 1, cursor: "ns-resize" },
  { h: "sw", x: -1, y: 1, cursor: "nesw-resize" },
  { h: "w", x: -1, y: 0, cursor: "ew-resize" },
];

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const normDeg = (d: number) => {
  let r = ((d + 180) % 360) - 180;
  if (r < -180) r += 360;
  return Math.round(r * 10) / 10;
};
const rotate = (p: Pt, deg: number): Pt => {
  const a = deg * RAD;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};
const centerOf = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function hitBox(b: Box, p: Pt) {
  const c = centerOf(b);
  const l = rotate({ x: p.x - c.x, y: p.y - c.y }, -b.rot);
  return Math.abs(l.x) <= b.w / 2 + 6 && Math.abs(l.y) <= b.h / 2 + 6;
}

/** Shrinks a picture in the browser before upload (≤ 1600 px, WebP keeps transparency). */
async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!img) throw new Error("Image illisible.");
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const webp = c.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Gesture = {
  type: "move" | "resize" | "rotate";
  key: string;
  handle?: Handle;
  start: Pt;
  box: Box;
  design: PosterDesign;
  moved: boolean;
};

export function PosterEditor({
  campaign,
  initialProducts,
  uploads: initialUploads,
  fonts,
  ai,
}: {
  campaign: { id: string; name: string; status: string; validatedAt: string | null; design: PosterDesign; versions: Version[] };
  initialProducts: PosterProduct[];
  uploads: Upload[];
  fonts: PosterAssets["fonts"];
  ai: { enabled: boolean; perDay: number; ambiances: Array<{ id: string; label: string }>; generated: SceneResult[] };
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [design, setDesign] = useState<PosterDesign>(campaign.design);
  // Latest design for event handlers (kept in sync after each render and on every commit).
  const designRef = useRef(design);
  useEffect(() => {
    designRef.current = design;
  }, [design]);
  const [name, setName] = useState(campaign.name);
  const [products, setProducts] = useState(initialProducts);
  const [versions, setVersions] = useState<Version[]>(campaign.versions);
  const [status, setStatus] = useState(campaign.status);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [renderWarnings, setRenderWarnings] = useState<string[]>([]);
  const [serverMsg, setServerMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Tab>("layers");
  const [uploads, setUploads] = useState<Upload[]>(initialUploads);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(560);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [shapeMenu, setShapeMenu] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const past = useRef<PosterDesign[]>([]);
  const future = useRef<PosterDesign[]>([]);
  const lastPush = useRef<{ tag: string; at: number }>({ tag: "", at: 0 });
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const syncHistory = useCallback(() => setHistory({ undo: past.current.length, redo: future.current.length }), []);

  const [assets, setAssets] = useState<PosterAssets | null>(null);
  const [layerImages, setLayerImages] = useState<Map<string, HTMLImageElement | null>>(new Map());
  const drawAssets = useMemo(() => (assets ? { ...assets, layerImages } : null), [assets, layerImages]);

  const check = useMemo(() => {
    const c = checkPoster(design, products);
    // The catalogue says "photo available" but the image itself may be missing on numedia.tn.
    if (assets) for (const p of products) if (p.hasPhoto && !assets.photos.get(p.id)) c.errors.push(`${p.name} : la photo officielle n'a pas pu être chargée.`);
    return c;
  }, [design, products, assets]);

  // ---------- history ----------
  const pushHistory = useCallback((prev: PosterDesign, tag = "") => {
    const now = Date.now();
    // Typing in one field is a single undo step.
    if (tag && lastPush.current.tag === tag && now - lastPush.current.at < 800) {
      lastPush.current.at = now;
      return;
    }
    lastPush.current = { tag, at: now };
    past.current = [...past.current.slice(-59), prev];
    future.current = [];
    syncHistory();
  }, [syncHistory]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setStatus("draft");
    setServerMsg(null);
  }, []);

  const commit = useCallback(
    (next: PosterDesign, tag = "") => {
      pushHistory(designRef.current, tag);
      designRef.current = next;
      setDesign(next);
      markDirty();
    },
    [pushHistory, markDirty],
  );
  const update = useCallback((patch: Partial<PosterDesign>, tag = "") => commit({ ...designRef.current, ...patch }, tag), [commit]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current = [designRef.current, ...future.current];
    designRef.current = prev;
    setDesign(prev);
    markDirty();
    syncHistory();
  }, [markDirty, syncHistory]);
  const redo = useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    past.current = [...past.current, designRef.current];
    future.current = rest;
    designRef.current = next;
    setDesign(next);
    markDirty();
    syncHistory();
  }, [markDirty, syncHistory]);

  // ---------- assets ----------
  const sceneUrl = design.scene?.url ?? null;
  // Fonts and images must be ready before painting, or the canvas would fall back to system fonts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all(
        [fonts.latin, fonts.arabic, fonts.display, fonts.serif].flatMap((f) => [500, 600, 800, 900].map((w) => document.fonts.load(`${w} 40px ${f}`, "Aa عربي 0123").catch(() => []))),
      );
      const logoSrc = design.brand === "cbe" ? "/brand/logo-full.png" : "/brand/numedia-logo.webp";
      const [logo, scene, ...photos] = await Promise.all([
        loadImage(logoSrc),
        sceneUrl
          ? loadImage(sceneUrl.startsWith("/api/") ? sceneUrl : `/api/marketing/image?scene=${encodeURIComponent(sceneUrl)}`)
          : Promise.resolve(null),
        ...products.map((p) => (p.hasPhoto ? loadImage(`/api/marketing/image?product=${p.id}&v=${photoVersion}`) : Promise.resolve(null))),
      ]);
      if (!cancelled) setAssets({ fonts, logo, scene, photos: new Map(products.map((p, i) => [p.id, photos[i]])) });
    })();
    return () => {
      cancelled = true;
    };
  }, [design.brand, sceneUrl, fonts, products, photoVersion]);

  const layerSrcKey = [...new Set(design.layers.map((l) => l.src).filter(Boolean))].sort().join("|");
  useEffect(() => {
    const wanted = layerSrcKey ? layerSrcKey.split("|") : [];
    const missing = wanted.filter((src) => !layerImages.has(src));
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(async (src) => [src, await loadImage(src)] as const)).then((loaded) => {
      if (cancelled) return;
      setLayerImages((m) => {
        const next = new Map(m);
        for (const [src, img] of loaded) next.set(src, img);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [layerSrcKey, layerImages]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !drawAssets) return;
    const res = drawPoster(ctx, design, products, check.pricing, drawAssets);
    setBoxes(res.boxes);
    setRenderWarnings(res.warnings);
  }, [design, products, check.pricing, drawAssets]);

  // ---------- zoom ----------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFit(Math.max(240, Math.min(width - 48, height - 48, S)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const display = fit * zoom;
  const k = display / S;

  const toPoster = (clientX: number, clientY: number): Pt => {
    const r = sheetRef.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) * S) / r.width, y: ((clientY - r.top) * S) / r.height };
  };

  // ---------- selection helpers ----------
  const layerOf = (key: string | null) => (key?.startsWith("layer:") ? design.layers.find((l) => l.id === key.slice(6)) ?? null : null);
  const selLayer = layerOf(selected);
  const selBox = boxes.find((b) => b.key === selected) ?? null;

  const setLayer = (id: string, patch: Partial<PosterLayer>, tag = "") =>
    update({ layers: designRef.current.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }, tag);

  const layoutFor = (d: PosterDesign, key: string): ElementLayout =>
    key.startsWith("product:") ? { ...HOME, ...(d.productLayout[key.slice(8)] ?? {}) } : { ...HOME, ...d.layout[key as PosterElement] };

  const withLayoutFor = (d: PosterDesign, key: string, l: ElementLayout): PosterDesign =>
    key.startsWith("product:") ? { ...d, productLayout: { ...d.productLayout, [key.slice(8)]: l } } : { ...d, layout: { ...d.layout, [key]: l } };

  // ---------- gestures (move / resize / rotate) ----------
  const beginGesture = (type: Gesture["type"], key: string, start: Pt, handle?: Handle) => {
    const box = boxes.find((b) => b.key === key);
    if (!box) return;
    gesture.current = { type, key, start, box, handle, design: designRef.current, moved: false };
  };

  const snap = (b: Box, dx: number, dy: number, off: boolean) => {
    if (off) return { dx, dy, v: [] as number[], h: [] as number[] };
    const th = 8 / Math.max(k, 0.2);
    const targets = [0, S / 2, S];
    const v: number[] = [];
    const h: number[] = [];
    for (const xs of [b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx]) {
      const t = targets.find((t) => Math.abs(xs - t) < th);
      if (t != null && !v.length) {
        dx += t - xs;
        v.push(t);
      }
    }
    for (const ys of [b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy]) {
      const t = targets.find((t) => Math.abs(ys - t) < th);
      if (t != null && !h.length) {
        dy += t - ys;
        h.push(t);
      }
    }
    return { dx, dy, v, h };
  };

  const applyGesture = (pt: Pt, e: { shiftKey: boolean; altKey: boolean }) => {
    const g = gesture.current;
    if (!g) return;
    const d0 = g.design;
    const c = centerOf(g.box);
    let dx = pt.x - g.start.x;
    let dy = pt.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < 2) return;
    if (!g.moved) {
      g.moved = true;
      pushHistory(d0);
    }
    const angle = (Math.atan2(pt.y - c.y, pt.x - c.x) - Math.atan2(g.start.y - c.y, g.start.x - c.x)) / RAD;
    const snapAngle = (a: number) => (e.shiftKey ? Math.round(a / 15) * 15 : a);

    if (g.key.startsWith("layer:")) {
      const id = g.key.slice(6);
      const l0 = d0.layers.find((l) => l.id === id);
      if (!l0) return;
      let next: PosterLayer = l0;
      if (g.type === "move") {
        const s = snap(g.box, dx, dy, e.altKey);
        setGuides({ v: s.v, h: s.h });
        next = { ...l0, x: Math.round(l0.x + s.dx), y: Math.round(l0.y + s.dy) };
      } else if (g.type === "rotate") {
        next = { ...l0, rot: normDeg(snapAngle(l0.rot + angle)) };
      } else if (g.handle) {
        const hd = HANDLES.find((x) => x.h === g.handle)!;
        const local = rotate({ x: dx, y: dy }, -l0.rot);
        const corner = hd.x !== 0 && hd.y !== 0;
        let w = l0.w;
        let h = g.box.h;
        let size = l0.size;
        if (l0.kind === "text") {
          if (corner) {
            const f = Math.max(0.1, 1 + (hd.x * local.x) / l0.w);
            w = l0.w * f;
            size = clamp((l0.size ?? 64) * f, 8, 600);
          } else w = Math.max(40, l0.w + hd.x * local.x);
        } else if (corner && !e.shiftKey) {
          // Corners keep the proportions (Shift to stretch freely), like Photopea.
          const f = Math.max(0.05, 1 + ((hd.x * local.x) / l0.w + (hd.y * local.y) / l0.h) / 2);
          w = l0.w * f;
          h = l0.h * f;
        } else {
          if (hd.x) w = Math.max(10, l0.w + hd.x * local.x);
          if (hd.y) h = Math.max(4, l0.h + hd.y * local.y);
        }
        const shift = rotate({ x: (hd.x * (w - l0.w)) / 2, y: l0.kind === "text" ? 0 : (hd.y * (h - l0.h)) / 2 }, l0.rot);
        next = {
          ...l0,
          w: Math.round(w),
          h: l0.kind === "text" ? l0.h : Math.round(h),
          size: size != null ? Math.round(size) : size,
          x: Math.round(l0.x + shift.x),
          y: Math.round(l0.y + shift.y),
        };
      }
      setDesign({ ...d0, layers: d0.layers.map((l) => (l.id === id ? next : l)) });
    } else {
      const l0 = layoutFor(d0, g.key);
      let l: ElementLayout = l0;
      if (g.type === "move") {
        const s = snap(g.box, dx, dy, e.altKey);
        setGuides({ v: s.v, h: s.h });
        dx = s.dx;
        dy = s.dy;
        let delta: Pt = { x: dx, y: dy };
        // A product photo moves inside the products block: convert to the block's own frame.
        if (g.key.startsWith("product:")) {
          const parent = layoutFor(d0, "products");
          delta = rotate(delta, -(parent.rot ?? 0));
          delta = { x: delta.x / parent.scale, y: delta.y / parent.scale };
        }
        l = { ...l0, dx: clamp(Math.round(l0.dx + delta.x), -1080, 1080), dy: clamp(Math.round(l0.dy + delta.y), -1080, 1080) };
      } else if (g.type === "rotate") {
        l = { ...l0, rot: normDeg(snapAngle((l0.rot ?? 0) + angle)) };
      } else {
        const ratio = Math.hypot(pt.x - c.x, pt.y - c.y) / Math.max(1, Math.hypot(g.start.x - c.x, g.start.y - c.y));
        l = { ...l0, scale: clamp(Math.round(l0.scale * ratio * 100) / 100, 0.15, 4) };
      }
      setDesign(withLayoutFor(d0, g.key, l));
    }
    markDirty();
  };

  const endGesture = () => {
    gesture.current = null;
    setGuides({ v: [], h: [] });
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!gesture.current || !sheetRef.current) return;
      applyGesture(toPoster(e.clientX, e.clientY), e);
    };
    const up = () => endGesture();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  const onSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = toPoster(e.clientX, e.clientY);
    const lockedIds = new Set(design.layers.filter((l) => l.locked).map((l) => `layer:${l.id}`));
    const hit = [...boxes].reverse().find((b) => !lockedIds.has(b.key) && hitBox(b, p));
    setSelected(hit?.key ?? null);
    if (!hit) return;
    e.preventDefault();
    if (hit.key.startsWith("layer:")) setTab("layers");
    beginGesture("move", hit.key, p);
  };

  // ---------- layers ----------
  const addLayer = (l: Omit<PosterLayer, "id" | "rot" | "opacity" | "visible" | "locked" | "behind" | "shadow"> & Partial<PosterLayer>) => {
    if (design.layers.length >= MAX_LAYERS) return setServerMsg({ tone: "bad", text: `${MAX_LAYERS} calques au plus par affiche.` });
    const layer: PosterLayer = { rot: 0, opacity: 1, visible: true, locked: false, behind: false, shadow: false, ...l, id: uid() };
    update({ layers: [...designRef.current.layers, layer] });
    setSelected(`layer:${layer.id}`);
    setTab("layers");
  };

  const addText = (preset: "title" | "body" | "badge" | "arabic" = "title") => {
    const dark = ["premium", "neon", "aurora", "scene", "split"].includes(design.theme);
    const base = { kind: "text" as const, x: S / 2, y: S / 2, w: 720, h: 100, align: "center" as const, uppercase: false, strokeW: 0, stroke: "#000000", bg: "" };
    if (preset === "body") addLayer({ ...base, name: "Texte", text: "Votre texte ici", font: "latin", size: 44, weight: 600, color: dark ? "#ffffff" : "#111111" });
    else if (preset === "badge") addLayer({ ...base, name: "Étiquette", w: 420, text: "NOUVEAU", font: "latin", size: 48, weight: 900, color: "#ffffff", bg: design.accent, uppercase: true, shadow: true });
    else if (preset === "arabic") addLayer({ ...base, name: "نص عربي", text: "عرض خاص", font: "arabic", size: 72, weight: 800, color: dark ? "#ffffff" : design.accent });
    else addLayer({ ...base, name: "Titre", text: "TITRE", font: "display", size: 110, weight: 900, color: dark ? "#ffffff" : design.accent, uppercase: true });
  };

  const addShape = (shape: ShapeKind) => {
    setShapeMenu(false);
    const dims: Record<ShapeKind, [number, number]> = { rect: [420, 260], ellipse: [300, 300], burst: [280, 280], ribbon: [620, 110], line: [520, 10] };
    const [w, h] = dims[shape];
    const label = SHAPES.find((s) => s.value === shape)!.label;
    addLayer({ kind: "shape", name: label, shape, x: S / 2, y: S / 2, w, h, fill: shape === "burst" ? "#ffd400" : design.accent, fill2: "", stroke: "#ffffff", strokeW: 0, radius: shape === "rect" ? 28 : 0, shadow: shape !== "line" });
  };

  const addImage = async (img: Upload) => {
    const el = layerImages.get(img.url) ?? (await loadImage(img.url));
    if (el) setLayerImages((m) => new Map(m).set(img.url, el));
    const ratio = el && el.naturalWidth ? el.naturalHeight / el.naturalWidth : 1;
    const w = Math.min(520, el?.naturalWidth || 520);
    addLayer({ kind: "image", name: img.name || "Image", src: img.url, x: S / 2, y: S / 2, w, h: Math.round(w * ratio), radius: 0, flipX: false, removeBg: false });
  };

  const onFiles = async (files: FileList | File[] | null) => {
    const list = [...(files ?? [])].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type)).slice(0, 6);
    if (!list.length) return setServerMsg({ tone: "bad", text: "Choisissez des images PNG, JPG ou WebP." });
    setUploading(true);
    try {
      for (const f of list) {
        const data = await fileToDataUrl(f);
        const res = await uploadImageAction(campaign.id, data, f.name.replace(/\.[a-z0-9]+$/i, ""));
        if (!res.ok) {
          setServerMsg({ tone: "bad", text: res.error });
          continue;
        }
        setUploads((u) => [res.image, ...u]);
        await addImage(res.image);
      }
    } catch (err) {
      setServerMsg({ tone: "bad", text: err instanceof Error ? err.message : "Import impossible." });
    } finally {
      setUploading(false);
    }
  };

  const removeSelected = () => {
    if (!selLayer) return;
    update({ layers: design.layers.filter((l) => l.id !== selLayer.id) });
    setSelected(null);
  };
  const duplicate = (id: string) => {
    const l = design.layers.find((x) => x.id === id);
    if (!l || design.layers.length >= MAX_LAYERS) return;
    const copy = { ...l, id: uid(), name: `${l.name} (copie)`.slice(0, 60), x: l.x + 30, y: l.y + 30, locked: false };
    const i = design.layers.indexOf(l);
    update({ layers: [...design.layers.slice(0, i + 1), copy, ...design.layers.slice(i + 1)] });
    setSelected(`layer:${copy.id}`);
  };
  const reorder = (id: string, dir: 1 | -1) => {
    const list = [...design.layers];
    const i = list.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    update({ layers: list });
  };
  const toggleHidden = (el: HideableElement) =>
    update({ hidden: design.hidden.includes(el) ? design.hidden.filter((h) => h !== el) : [...design.hidden, el] });

  const resetElement = (key: string) => update(withLayoutFor(design, key, { ...HOME }));
  const setElementLayout = (key: string, patch: Partial<ElementLayout>, tag = "") => update(withLayoutFor(design, key, { ...layoutFor(design, key), ...patch }), tag);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d" && selLayer) {
        e.preventDefault();
        duplicate(selLayer.id);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selLayer) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") setSelected(null);
      else if (selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (selLayer) {
          if (!selLayer.locked) setLayer(selLayer.id, { x: selLayer.x + dx, y: selLayer.y + dy }, `nudge-${selLayer.id}`);
        } else {
          const l = layoutFor(design, selected);
          setElementLayout(selected, { dx: l.dx + dx, dy: l.dy + dy }, `nudge-${selected}`);
        }
      } else if (!mod && e.key.toLowerCase() === "t") addText("title");
      else if (!mod && e.key.toLowerCase() === "i") fileRef.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- template-level actions (kept from the previous editor) ----------
  // Random style and brand colour, layout back to the template defaults.
  const surprise = () => {
    // "Scène IA" needs a generated background first, so the surprise picks among the other styles.
    const others = THEMES.filter((t) => t.value !== design.theme && t.value !== "scene");
    const theme = others[Math.floor(Math.random() * others.length)].value;
    const accent = Math.random() < 0.6 ? design.accent : BRAND_COLORS[Math.floor(Math.random() * BRAND_COLORS.length)].value;
    update({ theme, accent, layout: { title: HOME, products: HOME, price: HOME, benefits: HOME }, productLayout: {} });
  };

  const moveProduct = (i: number, dir: -1 | 1) => {
    const order = [...design.productOrder];
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    update({ productOrder: order });
  };

  const setList = (key: "benefits" | "benefitsAr", i: number, v: string) => {
    const list = [...design[key]];
    list[i] = v;
    while (list.length && !list[list.length - 1]) list.pop();
    update({ [key]: list } as Partial<PosterDesign>, `${key}-${i}`);
  };

  const save = () =>
    start(async () => {
      const res = await saveCampaignAction(campaign.id, design, name);
      if (!res.ok) return setServerMsg({ tone: "bad", text: res.error });
      setVersions(res.versions);
      setDirty(false);
      setServerMsg({ tone: "ok", text: "Brouillon enregistré." });
      router.refresh();
    });

  const validate = () =>
    start(async () => {
      const res = await validateCampaignAction(campaign.id, design, name);
      if (res.error) return setServerMsg({ tone: "bad", text: res.error });
      setProducts(res.products);
      setDirty(false);
      if (res.ok) {
        setStatus("validated");
        setServerMsg({ tone: "ok", text: "Affiche validée avec les données du catalogue à jour : le téléchargement est disponible." });
      } else {
        setStatus("draft");
        setServerMsg({ tone: "bad", text: "Validation refusée : corrigez les points bloquants (onglet Export)." });
        setTab("export");
      }
      router.refresh();
    });

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = posterFileName(name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };

  const refreshPhoto = (productId: string) =>
    start(async () => {
      const res = await refreshPhotoAction(productId);
      setServerMsg(res.ok ? { tone: "ok", text: "Photo officielle rechargée depuis numedia.tn." } : { tone: "bad", text: "Aucune photo officielle trouvée sur numedia.tn." });
      setPhotoVersion((v) => v + 1);
    });

  const removeUpload = (u: Upload) =>
    start(async () => {
      await deleteUploadAction(u.id);
      setUploads((list) => list.filter((x) => x.id !== u.id));
    });

  // ---------- derived ----------
  const ar = design.lang === "ar";
  const bi = design.lang === "bi";
  const showFr = !ar;
  const showAr = ar || bi;
  const canDownload = status === "validated" && !dirty && check.errors.length === 0;
  const ordered = design.productOrder.map((id) => products.find((p) => p.id === id)).filter((p): p is PosterProduct => Boolean(p));
  const ownSum = ordered.every((p) => p.ownStatus === "found" && p.ownPrice) ? ordered.reduce((s, p) => s + (p.ownPrice ?? 0), 0) : null;
  const productName = (key: string) => products.find((p) => p.id === key.slice(8))?.name ?? "Produit";
  const labelOf = (key: string) =>
    key.startsWith("layer:") ? (layerOf(key)?.name ?? "Calque") : key.startsWith("product:") ? `Photo · ${productName(key)}` : ELEMENT_LABELS[key as PosterElement];
  const issues = check.errors.length;

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode; badge?: number }> = [
    { id: "layers", label: "Calques", icon: <Layers size={15} /> },
    { id: "style", label: "Style", icon: <LayoutTemplate size={15} /> },
    { id: "texts", label: "Textes", icon: <Type size={15} /> },
    { id: "price", label: "Prix", icon: <Tag size={15} /> },
    { id: "images", label: "Images", icon: <Images size={15} /> },
    { id: "export", label: "Export", icon: <ShieldCheck size={15} />, badge: issues || undefined },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-[#262a31] bg-[#16181d] shadow-xl">
      {/* ---------- top bar ---------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#262a31] bg-[#1d2026] px-3 py-2 text-[#d9dde3]">
        <input
          value={name}
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
          className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-white outline-none hover:border-[#3a3f47] focus:border-[#0b8fa3] sm:max-w-xs"
          aria-label="Nom de la campagne"
        />
        <div className="flex items-center gap-1">
          <DarkIcon title="Annuler (Ctrl+Z)" disabled={!history.undo} onClick={undo}>
            <Undo2 size={16} />
          </DarkIcon>
          <DarkIcon title="Rétablir (Ctrl+Y)" disabled={!history.redo} onClick={redo}>
            <Redo2 size={16} />
          </DarkIcon>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-[#262a31] px-1">
          <DarkIcon title="Dézoomer" onClick={() => setZoom((z) => clamp(Math.round((z - 0.1) * 10) / 10, 0.3, 2.5))}>
            <ZoomOut size={15} />
          </DarkIcon>
          <button type="button" onClick={() => setZoom(1)} className="w-12 text-center text-xs tabular-nums text-[#aeb4bd] hover:text-white" title="Ajuster à l’écran">
            {Math.round(display / 10.8)} %
          </button>
          <DarkIcon title="Zoomer" onClick={() => setZoom((z) => clamp(Math.round((z + 0.1) * 10) / 10, 0.3, 2.5))}>
            <ZoomIn size={15} />
          </DarkIcon>
          <DarkIcon title="Ajuster à l’écran" onClick={() => setZoom(1)}>
            <Maximize size={14} />
          </DarkIcon>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status === "validated" && !dirty ? "bg-[#0c6b4d]/30 text-[#6ee7b7]" : "bg-[#8a6100]/30 text-[#fcd34d]"}`}>
            {status === "validated" && !dirty ? "Validée" : dirty ? "Non enregistrée" : "Brouillon"}
          </span>
          <button type="button" disabled={pending} onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2b3038] px-3 text-sm text-white hover:bg-[#353b44] disabled:opacity-50">
            <Save size={15} /> Enregistrer
          </button>
          <button
            type="button"
            disabled={pending || issues > 0}
            onClick={validate}
            title={issues ? "Corrigez les points bloquants (onglet Export)" : ""}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#0b8fa3] px-3 text-sm font-semibold text-white hover:bg-[#0a7d8f] disabled:opacity-50"
          >
            <ShieldCheck size={15} /> {pending ? "Vérification…" : "Valider"}
          </button>
          <button
            type="button"
            disabled={!canDownload}
            onClick={download}
            title={canDownload ? "PNG 1080 × 1080" : "Validez l'affiche pour la télécharger"}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#d4a017] px-3 text-sm font-semibold text-[#3b2a00] hover:bg-[#c09210] disabled:opacity-40"
          >
            <Download size={15} /> PNG
          </button>
        </div>
      </div>
      {serverMsg ? (
        <div className={`border-b border-[#262a31] px-4 py-1.5 text-xs ${serverMsg.tone === "ok" ? "bg-[#0c6b4d]/25 text-[#a7f3d0]" : "bg-[#b42323]/25 text-[#fecaca]"}`}>{serverMsg.text}</div>
      ) : null}

      <div className="grid lg:grid-cols-[52px_minmax(0,1fr)_360px]">
        {/* ---------- tool rail ---------- */}
        <div className="relative flex gap-1 border-b border-[#262a31] bg-[#1d2026] p-1.5 lg:flex-col lg:border-b-0 lg:border-r">
          <RailButton title="Sélection et déplacement (Échap pour désélectionner)" active={!shapeMenu} onClick={() => setSelected(null)}>
            <MousePointer2 size={18} />
          </RailButton>
          <RailButton title="Ajouter une image (I)" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={18} />
          </RailButton>
          <RailButton title="Ajouter un texte (T)" onClick={() => addText("title")}>
            <Type size={18} />
          </RailButton>
          <RailButton title="Ajouter une forme" active={shapeMenu} onClick={() => setShapeMenu((v) => !v)}>
            <Shapes size={18} />
          </RailButton>
          <RailButton title="Étiquette (texte sur fond)" onClick={() => addText("badge")}>
            <Tag size={18} />
          </RailButton>
          <div className="mx-1 my-1 border-l border-[#30353d] lg:mx-0 lg:border-l-0 lg:border-t" />
          <RailButton title="Surprends-moi : style et couleur au hasard" onClick={surprise}>
            <Shuffle size={18} />
          </RailButton>
          {shapeMenu ? (
            <div className="absolute left-1.5 top-12 z-30 grid w-48 gap-0.5 rounded-lg border border-[#30353d] bg-[#23272e] p-1 shadow-2xl lg:left-12 lg:top-40">
              {SHAPES.map((s) => (
                <button key={s.value} type="button" onClick={() => addShape(s.value)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[#d9dde3] hover:bg-[#30353d]">
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* ---------- stage ---------- */}
        <div
          ref={stageRef}
          className="relative grid h-[min(78vh,820px)] min-h-[420px] place-items-center overflow-auto bg-[#111317] [background-image:radial-gradient(#22262d_1px,transparent_1px)] [background-size:22px_22px]"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
          onWheel={(e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom((z) => clamp(Math.round((z - Math.sign(e.deltaY) * 0.1) * 10) / 10, 0.3, 2.5));
          }}
        >
          <div className="p-6">
            <div ref={sheetRef} className="relative shadow-[0_20px_60px_rgba(0,0,0,0.55)]" style={{ width: display, height: display }} onPointerDown={onSheetPointerDown}>
              <canvas ref={canvasRef} width={S} height={S} className="block h-full w-full touch-none select-none" aria-label="Aperçu de l'affiche 1080 × 1080" />
              {/* Snapping guides */}
              {guides.v.map((x) => (
                <div key={`v${x}`} className="pointer-events-none absolute top-0 h-full w-px bg-[#ff3ea5]" style={{ left: x * k }} />
              ))}
              {guides.h.map((y) => (
                <div key={`h${y}`} className="pointer-events-none absolute left-0 h-px w-full bg-[#ff3ea5]" style={{ top: y * k }} />
              ))}
              {selBox && !selLayer?.locked ? (
                <SelectionFrame
                  box={selBox}
                  k={k}
                  textLayer={selLayer?.kind === "text"}
                  onHandle={(h, e) => {
                    e.stopPropagation();
                    beginGesture("resize", selBox.key, toPoster(e.clientX, e.clientY), h);
                  }}
                  onRotate={(e) => {
                    e.stopPropagation();
                    beginGesture("rotate", selBox.key, toPoster(e.clientX, e.clientY));
                  }}
                />
              ) : null}
              {!assets ? <div className="absolute inset-0 grid place-items-center bg-[#111317]/80 text-sm text-[#aeb4bd]">Chargement des polices et des photos…</div> : null}
              {uploading ? <div className="absolute inset-x-0 top-0 bg-[#0b8fa3] py-1 text-center text-xs text-white">Import de l’image…</div> : null}
            </div>
          </div>
          {selected ? (
            <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[#30353d] bg-[#23272e]/95 px-2 py-1 text-xs text-[#d9dde3] shadow-2xl">
              <span className="max-w-[180px] truncate px-1 font-semibold">{labelOf(selected)}</span>
              {selLayer ? (
                <>
                  <DarkIcon title="Dupliquer (Ctrl+D)" onClick={() => duplicate(selLayer.id)}>
                    <Copy size={14} />
                  </DarkIcon>
                  <DarkIcon title={selLayer.behind ? "Passer devant les produits" : "Passer derrière les produits"} onClick={() => setLayer(selLayer.id, { behind: !selLayer.behind })}>
                    {selLayer.behind ? <BringToFront size={14} /> : <SendToBack size={14} />}
                  </DarkIcon>
                  <DarkIcon title={selLayer.locked ? "Déverrouiller" : "Verrouiller"} onClick={() => setLayer(selLayer.id, { locked: !selLayer.locked })}>
                    {selLayer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                  </DarkIcon>
                  <DarkIcon title="Supprimer (Suppr)" onClick={removeSelected}>
                    <Trash2 size={14} />
                  </DarkIcon>
                </>
              ) : (
                <DarkIcon title="Position et taille d’origine" onClick={() => resetElement(selected)}>
                  <RotateCcw size={14} />
                </DarkIcon>
              )}
            </div>
          ) : (
            <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full bg-[#23272e]/90 px-3 py-1 text-[11px] text-[#8f96a0] md:block">
              Cliquez un élément pour le déplacer · poignées pour redimensionner et pivoter · Maj = proportions libres / pivot par 15° · Alt = sans aimantation
            </div>
          )}
        </div>

        {/* ---------- right panel ---------- */}
        <div className="flex max-h-[min(78vh,820px)] min-h-[420px] flex-col border-t border-[#262a31] bg-[#f6f8f9] lg:border-l lg:border-t-0">
          <div className="grid grid-cols-6 border-b border-[#dfe7ea] bg-white">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${tab === t.id ? "text-[#0b4a56]" : "text-[#7b9096] hover:text-[#0b4a56]"}`}
              >
                {t.icon}
                {t.label}
                {tab === t.id ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-[#0b8fa3]" /> : null}
                {t.badge ? <span className="absolute right-1.5 top-1 rounded-full bg-[#c53d3d] px-1 text-[9px] text-white">{t.badge}</span> : null}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "layers" ? (
              <div className="grid gap-3">
                {selected ? (
                  <Section title={labelOf(selected)} onClose={() => setSelected(null)}>
                    {selLayer ? (
                      <LayerProperties layer={selLayer} accent={design.accent} uploads={uploads} onChange={(patch, tag) => setLayer(selLayer.id, patch, tag)} />
                    ) : (
                      <BuiltinProperties
                        layout={layoutFor(design, selected)}
                        onChange={(patch, tag) => setElementLayout(selected, patch, tag)}
                        onReset={() => resetElement(selected)}
                        hint={selected === "title" || selected === "benefits" ? "Le contenu se modifie dans l’onglet Textes." : selected === "price" ? "Le prix se règle dans l’onglet Prix (vérifié sur le catalogue)." : undefined}
                      />
                    )}
                  </Section>
                ) : (
                  <p className="rounded-lg border border-dashed border-[#cfdde1] bg-white p-3 text-xs text-[#4d6a72]">
                    Sélectionnez un élément sur l’affiche ou dans la liste. Ajoutez des images, textes et formes avec la barre d’outils à gauche, ou glissez une image sur l’affiche.
                  </p>
                )}
                <Section title={`Calques (${design.layers.length}/${MAX_LAYERS})`}>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                      <Upload size={13} /> Image
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => addText("title")}>
                      <Type size={13} /> Titre
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => addText("body")}>
                      <Type size={13} /> Texte
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => addText("arabic")}>
                      ع
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setShapeMenu(true)}>
                      <Shapes size={13} /> Forme
                    </Button>
                  </div>
                  <ul className="grid gap-1">
                    {[...design.layers.filter((l) => !l.behind)].reverse().map((l) => (
                      <LayerRow
                        key={l.id}
                        layer={l}
                        active={selected === `layer:${l.id}`}
                        onSelect={() => setSelected(`layer:${l.id}`)}
                        onChange={(patch) => setLayer(l.id, patch)}
                        onUp={() => reorder(l.id, 1)}
                        onDown={() => reorder(l.id, -1)}
                        onDuplicate={() => duplicate(l.id)}
                        onDelete={() => {
                          update({ layers: design.layers.filter((x) => x.id !== l.id) });
                          if (selected === `layer:${l.id}`) setSelected(null);
                        }}
                      />
                    ))}
                    <li className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#7b9096]">Contenu de l’affiche</li>
                    {(["price", "benefits", "products", "title"] as PosterElement[]).map((el) => (
                      <BuiltinRow
                        key={el}
                        label={ELEMENT_LABELS[el]}
                        active={selected === el}
                        hidden={el === "title" || el === "benefits" ? design.hidden.includes(el) : undefined}
                        onToggle={el === "title" || el === "benefits" ? () => toggleHidden(el) : undefined}
                        onSelect={() => setSelected(el)}
                      >
                        {el === "products"
                          ? ordered.map((p) => (
                              <BuiltinRow key={p.id} sub label={p.name} active={selected === `product:${p.id}`} onSelect={() => setSelected(`product:${p.id}`)} />
                            ))
                          : null}
                      </BuiltinRow>
                    ))}
                    {(["tag", "logo", "footer"] as HideableElement[]).map((el) => (
                      <BuiltinRow key={el} label={HIDE_LABELS[el]} hidden={design.hidden.includes(el)} onToggle={() => toggleHidden(el)} />
                    ))}
                    {design.layers.some((l) => l.behind) ? <li className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#7b9096]">Derrière le contenu</li> : null}
                    {[...design.layers.filter((l) => l.behind)].reverse().map((l) => (
                      <LayerRow
                        key={l.id}
                        layer={l}
                        active={selected === `layer:${l.id}`}
                        onSelect={() => setSelected(`layer:${l.id}`)}
                        onChange={(patch) => setLayer(l.id, patch)}
                        onUp={() => reorder(l.id, 1)}
                        onDown={() => reorder(l.id, -1)}
                        onDuplicate={() => duplicate(l.id)}
                        onDelete={() => {
                          update({ layers: design.layers.filter((x) => x.id !== l.id) });
                          if (selected === `layer:${l.id}`) setSelected(null);
                        }}
                      />
                    ))}
                    <li className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-xs text-[#7b9096]">
                      <LayoutTemplate size={13} /> Fond : {THEMES.find((t) => t.value === design.theme)?.label}
                    </li>
                  </ul>
                </Section>
              </div>
            ) : null}

            {tab === "style" ? (
              <div className="grid gap-3">
                <Section title="Marque, langue et couleur">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Langue">
                      <Select value={design.lang} onChange={(e) => update({ lang: e.target.value as PosterDesign["lang"] })}>
                        <option value="fr">Français</option>
                        <option value="ar">Arabe</option>
                        <option value="bi">Bilingue français + arabe</option>
                      </Select>
                    </Field>
                    <Field label="Marque">
                      <Select value={design.brand} onChange={(e) => update({ brand: e.target.value as PosterDesign["brand"] })}>
                        <option value="numedia">NUMEDIA</option>
                        <option value="cbe">CBE — Cap Bon Electronique</option>
                      </Select>
                    </Field>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {BRAND_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        title={c.label}
                        onClick={() => update({ accent: c.value })}
                        className={`h-8 w-8 rounded-full border-2 ${design.accent === c.value ? "border-[#0b8fa3] ring-2 ring-[#0b8fa3]/30" : "border-white shadow"}`}
                        style={{ background: c.value }}
                      />
                    ))}
                  </div>
                </Section>
                <Section
                  title="Modèle de fond"
                  action={
                    <Button size="sm" variant="secondary" onClick={surprise}>
                      <Shuffle size={13} /> Surprends-moi
                    </Button>
                  }
                >
                  <StyleGallery design={design} products={products} pricing={check.pricing} assets={drawAssets} onPick={(theme) => update({ theme })} />
                </Section>
                <Section title="Événement">
                  <EventPicker value={design.event} onChange={(id) => update(applyEvent(design, id, products))} />
                </Section>
                <Section title="Scène IA">
                  <AiScenePanel
                    campaignId={campaign.id}
                    ai={ai}
                    current={design.scene}
                    reflection={design.reflection}
                    onReflection={(reflection) => update({ reflection })}
                    onPick={(scene) => update({ scene, theme: "scene" })}
                  />
                </Section>
              </div>
            ) : null}

            {tab === "texts" ? (
              <div className="grid gap-3">
                <Section title="Textes du modèle">
                  <div className="grid gap-2">
                    {showFr ? (
                      <>
                        <Field label="Titre">
                          <Input value={design.title} maxLength={80} onChange={(e) => update({ title: e.target.value }, "title")} />
                        </Field>
                        <Field label="Sous-titre (modèle)">
                          <Input value={design.subtitle} maxLength={140} onChange={(e) => update({ subtitle: e.target.value }, "subtitle")} />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Étiquette">
                            <Input value={design.tag} maxLength={24} onChange={(e) => update({ tag: e.target.value }, "tag")} />
                          </Field>
                          <Field label="Appel à l'action">
                            <Input value={design.cta} maxLength={60} onChange={(e) => update({ cta: e.target.value }, "cta")} />
                          </Field>
                        </div>
                      </>
                    ) : null}
                    {showAr ? (
                      <>
                        <Field label="العنوان — titre arabe (tunisien)">
                          <Input dir="rtl" value={design.titleAr} maxLength={80} onChange={(e) => update({ titleAr: e.target.value }, "titleAr")} />
                        </Field>
                        {ar ? (
                          <Field label="Sous-titre arabe (sinon le modèle)">
                            <Input dir="rtl" value={design.subtitleAr} maxLength={140} onChange={(e) => update({ subtitleAr: e.target.value }, "subtitleAr")} />
                          </Field>
                        ) : null}
                        {ar ? (
                          <Field label="Étiquette arabe">
                            <Input dir="rtl" value={design.tagAr} maxLength={24} onChange={(e) => update({ tagAr: e.target.value }, "tagAr")} />
                          </Field>
                        ) : null}
                        <Field label="Appel à l'action arabe">
                          <Input dir="rtl" value={design.ctaAr} maxLength={60} onChange={(e) => update({ ctaAr: e.target.value }, "ctaAr")} />
                        </Field>
                      </>
                    ) : null}
                    <Field label="Site / contact (pied d'affiche)">
                      <Input value={design.footer} maxLength={120} onChange={(e) => update({ footer: e.target.value }, "footer")} />
                    </Field>
                    <Field label="Offre valable jusqu'au (facultatif)">
                      <Input type="date" value={design.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
                    </Field>
                  </div>
                </Section>
                <Section title="Avantages produit (3 au plus — caractéristiques vérifiées)">
                  <div className="grid gap-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="grid gap-1">
                        {showFr ? <Input placeholder={`Avantage ${i + 1} (ex. 2000 Watts)`} value={design.benefits[i] ?? ""} maxLength={40} onChange={(e) => setList("benefits", i, e.target.value)} /> : null}
                        {showAr ? <Input dir="rtl" placeholder={`ميزة ${i + 1} (بالتونسي)`} value={design.benefitsAr[i] ?? ""} maxLength={40} onChange={(e) => setList("benefitsAr", i, e.target.value)} /> : null}
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            ) : null}

            {tab === "price" ? (
              <div className="grid gap-3">
                <Section title="Prix">
                  <p className="mb-2 text-xs text-[#6b858c]">
                    Prix barré = prix confirmé sur numedia.tn{ordered.length > 1 ? " (somme des articles du pack)" : ""}. Il n’est jamais saisi à la main.
                  </p>
                  <Field label={ordered.length > 1 ? "Prix du pack (TTC)" : "Prix affiché (TTC)"}>
                    <Input type="number" min={0} step="0.001" value={design.promoPrice ?? ""} onChange={(e) => update({ promoPrice: e.target.value === "" ? null : Number(e.target.value) }, "price")} />
                  </Field>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-[#6b858c]">Prix numedia.tn</div>
                      <div className="font-semibold tabular-nums">{ownSum != null ? `${fmt(ownSum)} DT` : "non confirmé"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[#6b858c]">Plancher (marge min.)</div>
                      <div className="font-semibold tabular-nums">{check.pricing.floor != null ? `${fmt(check.pricing.floor)} DT` : "coût inconnu"}</div>
                      {check.pricing.marginPct != null ? <div className="text-xs text-[#4d6a72]">Marge : {Math.round(check.pricing.marginPct * 1000) / 10} %</div> : null}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={design.showOldPrice} onChange={(e) => update({ showOldPrice: e.target.checked })} /> Afficher le prix barré
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={design.showDiscount} onChange={(e) => update({ showDiscount: e.target.checked })} /> Afficher la remise en %
                    </label>
                  </div>
                </Section>
                <Section title={`Produits (${ordered.length})`}>
                  <div className="grid gap-2">
                    {ordered.map((p, i) => {
                      const cheapest = p.competitors
                        .filter((c) => (c.matchClass === "exact" || c.matchClass === "strong") && c.availability !== "out_of_stock")
                        .sort((a, b) => a.price - b.price)[0];
                      return (
                        <div key={p.id} className="flex items-start gap-2 rounded-lg border border-[#e3ecee] bg-white p-2 text-sm">
                          <div className="flex flex-col">
                            <button type="button" className="p-0.5 text-[#4d6a72] disabled:opacity-30" disabled={i === 0} onClick={() => moveProduct(i, -1)} aria-label="Monter">
                              <ArrowUp size={14} />
                            </button>
                            <button type="button" className="p-0.5 text-[#4d6a72] disabled:opacity-30" disabled={i === ordered.length - 1} onClick={() => moveProduct(i, 1)} aria-label="Descendre">
                              <ArrowDown size={14} />
                            </button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <button type="button" onClick={() => { setSelected(`product:${p.id}`); setTab("layers"); }} className="text-left font-medium hover:underline">
                              {p.name}
                            </button>
                            <div className="text-xs text-[#6b858c]">
                              {p.ref ?? "sans référence"} · stock {p.stockQty} ·{" "}
                              {p.ownStatus === "found" && p.ownPrice != null ? <>numedia.tn {fmt(p.ownPrice)} DT ({relativeTime(p.ownCheckedAt)})</> : "prix numedia.tn non confirmé"}
                              {cheapest ? <> · moins cher concurrent : {cheapest.name} {fmt(cheapest.price)} DT</> : null}
                            </div>
                            <button type="button" disabled={pending || p.ownStatus !== "found"} onClick={() => refreshPhoto(p.id)} className="mt-1 text-xs text-[#0b8fa3] hover:underline disabled:opacity-40">
                              Recharger la photo officielle
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              </div>
            ) : null}

            {tab === "images" ? (
              <div className="grid gap-3">
                <Section title="Mes images">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="mb-3 grid w-full place-items-center gap-1 rounded-xl border-2 border-dashed border-[#b9cdd2] bg-white px-3 py-5 text-center text-sm text-[#0b4a56] hover:border-[#0b8fa3] hover:bg-[#f0f8fa]"
                  >
                    <Upload size={20} />
                    <span className="font-semibold">{uploading ? "Import…" : "Importer des images"}</span>
                    <span className="text-[11px] text-[#6b858c]">PNG, JPG ou WebP · ou glissez-les sur l’affiche</span>
                  </button>
                  {uploads.length ? (
                    <div className="grid grid-cols-3 gap-2">
                      {uploads.map((u) => (
                        <div key={u.id} className="group relative overflow-hidden rounded-lg border border-[#e3ecee] bg-[conic-gradient(#eef2f3_25%,#fff_0_50%,#eef2f3_0_75%,#fff_0)] [background-size:16px_16px]">
                          <button type="button" onClick={() => void addImage(u)} title={`Ajouter « ${u.name} » à l’affiche`} className="block w-full">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u.url} alt={u.name} loading="lazy" className="block aspect-square w-full object-contain p-1" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeUpload(u)}
                            title="Retirer de la bibliothèque"
                            className="absolute right-1 top-1 hidden rounded-full bg-white/90 p-1 text-[#b42323] shadow group-hover:block"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#6b858c]">Les images importées restent disponibles pour toutes vos affiches.</p>
                  )}
                </Section>
              </div>
            ) : null}

            {tab === "export" ? (
              <div className="grid gap-3">
                <Section title="Vérification">
                  {check.errors.length ? (
                    <ul className="mb-2 grid gap-1 text-sm text-[#b42323]">
                      {check.errors.map((e) => (
                        <li key={e}>⛔ {e}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-2 text-sm text-[#0c6b4d]">Aucun point bloquant.</p>
                  )}
                  {[...check.warnings, ...renderWarnings].length ? (
                    <ul className="mb-3 grid gap-1 text-sm text-[#8a6100]">
                      {[...check.warnings, ...renderWarnings].map((w) => (
                        <li key={w}>⚠ {w}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" disabled={pending} onClick={save}>
                      <Save size={14} /> Enregistrer
                    </Button>
                    <Button size="sm" disabled={pending || check.errors.length > 0} onClick={validate}>
                      <ShieldCheck size={14} /> Valider
                    </Button>
                    <Button variant="gold" size="sm" disabled={!canDownload} onClick={download}>
                      <Download size={14} /> Télécharger
                    </Button>
                    <Badge tone={status === "validated" && !dirty ? "ok" : "warn"}>{status === "validated" && !dirty ? "Validée" : dirty ? "Non enregistrée" : "Brouillon"}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-[#6b858c]">L’aperçu est le fichier exporté : PNG 1080 × 1080 px.</p>
                </Section>
                <Section title="Versions précédentes">
                  {versions.length ? (
                    <ul className="grid gap-1 text-sm">
                      {versions.map((v, i) => (
                        <li key={`${v.at}-${i}`} className="flex items-center justify-between gap-2">
                          <span>{formatWhen(v.at)}</span>
                          {/* Old prices and checks are always recomputed from the catalogue, never restored. */}
                          <Button size="sm" variant="ghost" onClick={() => commit(normalizeDesign(v.design, products))}>
                            Restaurer
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[#6b858c]">Chaque enregistrement conserve la version précédente ici.</p>
                  )}
                </Section>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Editor building blocks
// ---------------------------------------------------------------------------------------------

function DarkIcon({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-md text-[#c3c8cf] hover:bg-[#30353d] hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}

function RailButton({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-10 w-10 place-items-center rounded-lg transition ${active ? "bg-[#0b8fa3] text-white" : "text-[#aeb4bd] hover:bg-[#2b3038] hover:text-white"}`}
    >
      {children}
    </button>
  );
}

function Section({ title, action, onClose, children }: { title: string; action?: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#e1eaed] bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate text-xs font-bold uppercase tracking-wide text-[#29454c]">{title}</h3>
        {action}
        {onClose ? (
          <button type="button" onClick={onClose} className="text-xs text-[#7b9096] hover:text-[#0b4a56]">
            Fermer
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** 8 resize handles + rotation knob over the selected element (in screen pixels). */
function SelectionFrame({
  box,
  k,
  textLayer,
  onHandle,
  onRotate,
}: {
  box: Box;
  k: number;
  textLayer: boolean;
  onHandle: (h: Handle, e: React.PointerEvent) => void;
  onRotate: (e: React.PointerEvent) => void;
}) {
  const w = box.w * k;
  const h = box.h * k;
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: (box.x + box.w / 2) * k - w / 2, top: (box.y + box.h / 2) * k - h / 2, width: w, height: h, transform: `rotate(${box.rot}deg)` }}
    >
      <div className="absolute inset-0 border-[1.5px] border-[#0b8fa3] shadow-[0_0_0_1px_rgba(255,255,255,0.6)]" />
      <div className="absolute left-1/2 top-0 h-6 w-px -translate-y-full bg-[#0b8fa3]" />
      <button
        type="button"
        aria-label="Pivoter"
        title="Pivoter (Maj : par 15°)"
        onPointerDown={onRotate}
        className="pointer-events-auto absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 -translate-y-[34px] cursor-grab rounded-full border-2 border-[#0b8fa3] bg-white"
      />
      {HANDLES.filter((hd) => !(textLayer && hd.x === 0)).map((hd) => (
        <button
          key={hd.h}
          type="button"
          aria-label="Redimensionner"
          onPointerDown={(e) => onHandle(hd.h, e)}
          className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-[1.5px] border-[#0b8fa3] bg-white"
          style={{ left: `${((hd.x + 1) / 2) * 100}%`, top: `${((hd.y + 1) / 2) * 100}%`, cursor: hd.cursor }}
        />
      ))}
    </div>
  );
}

function LayerIcon({ layer }: { layer: PosterLayer }) {
  if (layer.kind === "image") return <ImagePlus size={13} />;
  if (layer.kind === "text") return <Type size={13} />;
  return SHAPES.find((s) => s.value === layer.shape)?.icon ?? <Shapes size={13} />;
}

function LayerRow({
  layer,
  active,
  onSelect,
  onChange,
  onUp,
  onDown,
  onDuplicate,
  onDelete,
}: {
  layer: PosterLayer;
  active: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<PosterLayer>) => void;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const btn = "grid h-6 w-6 place-items-center rounded text-[#5c747a] hover:bg-[#e8f1f3] hover:text-[#0b4a56]";
  return (
    <li
      className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs ${active ? "border-[#0b8fa3] bg-[#e9f6f8]" : "border-transparent bg-white hover:border-[#d7e3e6]"} ${layer.visible ? "" : "opacity-50"}`}
    >
      <button type="button" className={btn} title={layer.visible ? "Masquer" : "Afficher"} onClick={() => onChange({ visible: !layer.visible })}>
        {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <span className="text-[#4d6a72]">
        <LayerIcon layer={layer} />
      </span>
      {editing ? (
        <input
          autoFocus
          defaultValue={layer.name}
          maxLength={60}
          onBlur={(e) => {
            onChange({ name: e.target.value.trim() || layer.name });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-6 min-w-0 flex-1 rounded border border-[#0b8fa3] px-1"
        />
      ) : (
        <button type="button" onClick={onSelect} onDoubleClick={() => setEditing(true)} className="min-w-0 flex-1 truncate text-left font-medium text-[#1d3a41]" title="Double-clic pour renommer">
          {layer.kind === "text" ? layer.text?.split("\n")[0] || layer.name : layer.name}
        </button>
      )}
      <span className="hidden items-center group-hover:flex">
        <button type="button" className={btn} title="Monter" onClick={onUp}>
          <ArrowUp size={12} />
        </button>
        <button type="button" className={btn} title="Descendre" onClick={onDown}>
          <ArrowDown size={12} />
        </button>
        <button type="button" className={btn} title="Dupliquer" onClick={onDuplicate}>
          <Copy size={12} />
        </button>
        <button type="button" className={btn} title="Supprimer" onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </span>
      <button type="button" className={btn} title={layer.locked ? "Déverrouiller" : "Verrouiller"} onClick={() => onChange({ locked: !layer.locked })}>
        {layer.locked ? <Lock size={12} /> : <LockOpen size={12} className="opacity-40" />}
      </button>
    </li>
  );
}

function BuiltinRow({
  label,
  active,
  hidden,
  onToggle,
  onSelect,
  sub,
  children,
}: {
  label: string;
  active?: boolean;
  hidden?: boolean;
  onToggle?: () => void;
  onSelect?: () => void;
  sub?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <li className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs ${sub ? "ml-6" : ""} ${active ? "border-[#0b8fa3] bg-[#e9f6f8]" : "border-transparent bg-white/70"} ${hidden ? "opacity-50" : ""}`}>
        {onToggle ? (
          <button type="button" className="grid h-6 w-6 place-items-center rounded text-[#5c747a] hover:bg-[#e8f1f3]" title={hidden ? "Afficher" : "Masquer"} onClick={onToggle}>
            {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        ) : (
          <span className="grid h-6 w-6 place-items-center text-[#a3b5ba]">
            <Lock size={11} />
          </span>
        )}
        <button type="button" disabled={!onSelect || hidden} onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-[#29454c] disabled:cursor-default">
          {label}
        </button>
      </li>
      {children}
    </>
  );
}

function NumField({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <label className="grid gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b858c]">
      {label}
      <span className="flex items-center rounded-md border border-[#d7e3e6] bg-white focus-within:border-[#0b8fa3]">
        <input
          type="number"
          value={Math.round(value * 100) / 100}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(min != null || max != null ? clamp(v, min ?? -Infinity, max ?? Infinity) : v);
          }}
          className="h-8 w-full min-w-0 bg-transparent px-2 text-sm font-normal normal-case tracking-normal text-[#071c22] outline-none"
        />
        {suffix ? <span className="pr-2 text-[11px] font-normal normal-case text-[#8aa0a6]">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="grid gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b858c]">
      <span className="flex justify-between">
        {label} <span className="font-normal normal-case tabular-nums text-[#29454c]">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[#0b8fa3]" />
    </label>
  );
}

function ColorField({ label, value, onChange, allowNone }: { label: string; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6b858c]">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {allowNone ? (
          <button
            type="button"
            title="Aucun"
            onClick={() => onChange("")}
            className={`h-6 w-6 rounded-full border bg-[linear-gradient(45deg,transparent_45%,#c53d3d_45%,#c53d3d_55%,transparent_55%)] ${!value ? "ring-2 ring-[#0b8fa3]" : "border-[#cfdde1]"}`}
          />
        ) : null}
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            className={`h-6 w-6 rounded-full border ${value.toLowerCase() === c ? "ring-2 ring-[#0b8fa3]" : "border-[#cfdde1]"}`}
            style={{ background: c }}
          />
        ))}
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-[#cfdde1] bg-white p-0" title="Couleur personnalisée" />
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-[#29454c]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#0b8fa3]" /> {label}
    </label>
  );
}

function BuiltinProperties({ layout, onChange, onReset, hint }: { layout: ElementLayout; onChange: (p: Partial<ElementLayout>, tag?: string) => void; onReset: () => void; hint?: string }) {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Décalage X" value={layout.dx} min={-1080} max={1080} onChange={(dx) => onChange({ dx }, "dx")} suffix="px" />
        <NumField label="Décalage Y" value={layout.dy} min={-1080} max={1080} onChange={(dy) => onChange({ dy }, "dy")} suffix="px" />
      </div>
      <Slider label="Taille" value={layout.scale} min={0.15} max={4} step={0.01} onChange={(scale) => onChange({ scale }, "scale")} format={(v) => `${Math.round(v * 100)} %`} />
      <Slider label="Rotation" value={layout.rot ?? 0} min={-180} max={180} step={1} onChange={(rot) => onChange({ rot }, "rot")} format={(v) => `${Math.round(v)}°`} />
      <Button size="sm" variant="ghost" onClick={onReset}>
        <RotateCcw size={13} /> Position et taille d’origine
      </Button>
      {hint ? <p className="text-[11px] text-[#6b858c]">{hint}</p> : null}
    </div>
  );
}

const TEXT_PRESETS: Array<{ label: string; patch: (accent: string) => Partial<PosterLayer> }> = [
  { label: "Impact", patch: (a) => ({ font: "display", weight: 900, uppercase: true, color: a, strokeW: 0, bg: "", shadow: false }) },
  { label: "Contour", patch: () => ({ font: "latin", weight: 900, uppercase: true, color: "#ffffff", stroke: "#111111", strokeW: 6, bg: "", shadow: false }) },
  { label: "Néon", patch: (a) => ({ font: "latin", weight: 800, color: "#ffffff", stroke: a, strokeW: 3, bg: "", shadow: true }) },
  { label: "Étiquette", patch: (a) => ({ font: "latin", weight: 900, uppercase: true, color: "#ffffff", bg: a, strokeW: 0, shadow: true }) },
  { label: "Élégant", patch: () => ({ font: "serif", weight: 700, uppercase: false, color: "#111111", strokeW: 0, bg: "", shadow: false }) },
];

function LayerProperties({ layer: l, accent, uploads, onChange }: { layer: PosterLayer; accent: string; uploads: Upload[]; onChange: (p: Partial<PosterLayer>, tag?: string) => void }) {
  const tag = (f: string) => `${l.id}-${f}`;
  return (
    <div className="grid gap-3">
      {l.kind === "text" ? (
        <>
          <textarea
            value={l.text ?? ""}
            maxLength={400}
            dir="auto"
            onChange={(e) => onChange({ text: e.target.value }, tag("text"))}
            className="min-h-[70px] w-full rounded-lg border border-[#d7e3e6] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#0b8fa3]"
            placeholder="Votre texte (pas de prix ni de remise : ils viennent du bloc Prix)"
          />
          <div className="flex flex-wrap gap-1">
            {TEXT_PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => onChange(p.patch(accent))} className="rounded-full border border-[#d7e3e6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0b4a56] hover:border-[#0b8fa3]">
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b858c]">
              Police
              <select value={l.font ?? "latin"} onChange={(e) => onChange({ font: e.target.value as LayerFont })} className="h-8 rounded-md border border-[#d7e3e6] bg-white px-1 text-sm font-normal normal-case tracking-normal text-[#071c22]">
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b858c]">
              Graisse
              <select value={l.weight ?? 800} onChange={(e) => onChange({ weight: Number(e.target.value) })} className="h-8 rounded-md border border-[#d7e3e6] bg-white px-1 text-sm font-normal normal-case tracking-normal text-[#071c22]">
                <option value={500}>Normal</option>
                <option value={600}>Semi-gras</option>
                <option value={800}>Gras</option>
                <option value={900}>Extra-gras</option>
              </select>
            </label>
            <NumField label="Taille" value={l.size ?? 64} min={8} max={600} onChange={(size) => onChange({ size }, tag("size"))} suffix="px" />
            <NumField label="Largeur" value={l.w} min={40} max={3240} onChange={(w) => onChange({ w }, tag("w"))} suffix="px" />
          </div>
          <div className="flex items-center gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onChange({ align: a })}
                className={`grid h-8 w-9 place-items-center rounded-md border ${(l.align ?? "center") === a ? "border-[#0b8fa3] bg-[#e9f6f8] text-[#0b4a56]" : "border-[#d7e3e6] bg-white text-[#5c747a]"}`}
              >
                {a === "left" ? <AlignLeft size={14} /> : a === "center" ? <AlignCenter size={14} /> : <AlignRight size={14} />}
              </button>
            ))}
            <span className="ml-2">
              <Toggle label="MAJUSCULES" checked={Boolean(l.uppercase)} onChange={(uppercase) => onChange({ uppercase })} />
            </span>
          </div>
          <ColorField label="Couleur du texte" value={l.color ?? "#ffffff"} onChange={(color) => onChange({ color }, tag("color"))} />
          <ColorField label="Fond (bandeau)" value={l.bg ?? ""} allowNone onChange={(bg) => onChange({ bg }, tag("bg"))} />
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <ColorField label="Contour" value={l.stroke ?? "#000000"} onChange={(stroke) => onChange({ stroke, strokeW: l.strokeW || 4 }, tag("stroke"))} />
            <NumField label="Épaisseur" value={l.strokeW ?? 0} min={0} max={60} onChange={(strokeW) => onChange({ strokeW }, tag("strokeW"))} />
          </div>
        </>
      ) : null}

      {l.kind === "shape" ? (
        <>
          <div className="flex flex-wrap gap-1">
            {SHAPES.map((s) => (
              <button
                key={s.value}
                type="button"
                title={s.label}
                onClick={() => onChange({ shape: s.value })}
                className={`grid h-8 w-9 place-items-center rounded-md border ${l.shape === s.value ? "border-[#0b8fa3] bg-[#e9f6f8] text-[#0b4a56]" : "border-[#d7e3e6] bg-white text-[#5c747a]"}`}
              >
                {s.icon}
              </button>
            ))}
          </div>
          <ColorField label="Remplissage" value={l.fill ?? accent} onChange={(fill) => onChange({ fill }, tag("fill"))} />
          <ColorField label="Dégradé vers" value={l.fill2 ?? ""} allowNone onChange={(fill2) => onChange({ fill2 }, tag("fill2"))} />
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <ColorField label="Contour" value={l.stroke ?? "#ffffff"} onChange={(stroke) => onChange({ stroke, strokeW: l.strokeW || 4 }, tag("stroke"))} />
            <NumField label="Épaisseur" value={l.strokeW ?? 0} min={0} max={60} onChange={(strokeW) => onChange({ strokeW }, tag("strokeW"))} />
          </div>
          {l.shape === "rect" ? <Slider label="Arrondi" value={l.radius ?? 0} min={0} max={Math.round(Math.min(l.w, l.h) / 2)} step={1} onChange={(radius) => onChange({ radius }, tag("radius"))} format={(v) => `${v}px`} /> : null}
        </>
      ) : null}

      {l.kind === "image" ? (
        <>
          <div className="flex flex-wrap gap-3">
            <Toggle label="Détourer (fond blanc)" checked={Boolean(l.removeBg)} onChange={(removeBg) => onChange({ removeBg })} />
            <button type="button" onClick={() => onChange({ flipX: !l.flipX })} className="inline-flex items-center gap-1 text-xs text-[#0b4a56] hover:underline">
              <FlipHorizontal size={13} /> Miroir
            </button>
          </div>
          <Slider label="Coins arrondis" value={l.radius ?? 0} min={0} max={Math.round(Math.min(l.w, l.h) / 2)} step={1} onChange={(radius) => onChange({ radius }, tag("radius"))} format={(v) => `${v}px`} />
          {uploads.length > 1 ? (
            <label className="grid gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b858c]">
              Remplacer par
              <select
                value={l.src}
                onChange={(e) => {
                  const u = uploads.find((x) => x.url === e.target.value);
                  if (u) onChange({ src: u.url, name: u.name });
                }}
                className="h-8 rounded-md border border-[#d7e3e6] bg-white px-1 text-sm font-normal normal-case tracking-normal text-[#071c22]"
              >
                {uploads.map((u) => (
                  <option key={u.id} value={u.url}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : null}

      <div className="grid grid-cols-2 gap-2 border-t border-[#eef3f5] pt-2">
        <NumField label="X (centre)" value={l.x} onChange={(x) => onChange({ x }, tag("x"))} suffix="px" />
        <NumField label="Y (centre)" value={l.y} onChange={(y) => onChange({ y }, tag("y"))} suffix="px" />
        {l.kind !== "text" ? (
          <>
            <NumField label="Largeur" value={l.w} min={4} max={3240} onChange={(w) => onChange({ w }, tag("w"))} suffix="px" />
            <NumField label="Hauteur" value={l.h} min={2} max={3240} onChange={(h) => onChange({ h }, tag("h"))} suffix="px" />
          </>
        ) : null}
      </div>
      <Slider label="Rotation" value={l.rot} min={-180} max={180} step={1} onChange={(rot) => onChange({ rot }, tag("rot"))} format={(v) => `${Math.round(v)}°`} />
      <Slider label="Opacité" value={l.opacity} min={0} max={1} step={0.01} onChange={(opacity) => onChange({ opacity }, tag("opacity"))} format={(v) => `${Math.round(v * 100)} %`} />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Toggle label="Ombre portée" checked={l.shadow} onChange={(shadow) => onChange({ shadow })} />
        <Toggle label="Derrière les produits" checked={l.behind} onChange={(behind) => onChange({ behind })} />
        <Toggle label="Verrouillé" checked={l.locked} onChange={(locked) => onChange({ locked })} />
      </div>
    </div>
  );
}

const THUMB = 216;

/** Every style rendered live with the current products and texts; click to apply. */
function StyleGallery({
  design,
  products,
  pricing,
  assets,
  onPick,
}: {
  design: PosterDesign;
  products: PosterProduct[];
  pricing: ReturnType<typeof checkPoster>["pricing"];
  assets: PosterAssets | null;
  onPick: (theme: PosterDesign["theme"]) => void;
}) {
  const refs = useRef(new Map<string, HTMLCanvasElement>());
  useEffect(() => {
    if (!assets) return;
    // Debounced: typing in a text field should not repaint nine posters on every key.
    const timer = setTimeout(() => {
      for (const t of THEMES) {
        const ctx = refs.current.get(t.value)?.getContext("2d");
        if (!ctx) continue;
        ctx.setTransform(THUMB / POSTER_SIZE, 0, 0, THUMB / POSTER_SIZE, 0, 0);
        drawPoster(ctx, { ...design, theme: t.value }, products, pricing, assets);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [design, products, pricing, assets]);

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onPick(t.value)}
          className={`overflow-hidden rounded-lg border-2 bg-white text-left transition ${design.theme === t.value ? "border-[#0b8fa3] ring-2 ring-[#0b8fa3]/30" : "border-[#e3ecee] hover:border-[#0b4a56]"}`}
        >
          <canvas
            ref={(el) => {
              if (el) refs.current.set(t.value, el);
              else refs.current.delete(t.value);
            }}
            width={THUMB}
            height={THUMB}
            className="block aspect-square w-full"
          />
          <span className="block px-2 py-1 text-[11px] font-medium">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Tunisian commercial events, nearest first; choosing one fills the headline, tag and end date. */
function EventPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [events] = useState(() => upcomingEvents());
  const current = eventById(value);
  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <CalendarDays size={16} /> Événement commercial
      </h2>
      <p className="mb-2 text-xs text-[#6b858c]">Remplit le titre, l’étiquette et la date de fin (modifiables ensuite) et ajoute un décor de saison.</p>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Aucun événement</option>
        {events.map(({ event, date, approx, inDays }) => (
          <option key={event.id} value={event.id}>
            {event.label}
            {date ? ` — ${approx ? "≈ " : ""}${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : " — date à saisir"}
            {inDays != null ? ` (dans ${inDays} j)` : ""}
          </option>
        ))}
      </Select>
      {current?.note ? <p className="mt-2 text-xs text-[#8a6100]">⚠ {current.note}</p> : null}
      {current?.sales ? <p className="mt-1 text-xs text-[#8a6100]">Soldes : remise d’au moins 20 % sur le prix numedia.tn exigée avant l’export.</p> : null}
    </div>
  );
}

type SceneResult = { url: string; thumb: string; title: string; creator: string; landing: string };

/**
 * Free AI backgrounds (Cloudflare Workers AI): the model paints an empty scene for the products and the
 * event; the real product photo is then placed on it, so the product itself is never redrawn.
 */
function AiScenePanel({
  campaignId,
  ai,
  current,
  reflection,
  onReflection,
  onPick,
}: {
  campaignId: string;
  ai: { enabled: boolean; perDay: number; ambiances: Array<{ id: string; label: string }>; generated: SceneResult[] };
  current: SceneResult | null;
  reflection: boolean;
  onReflection: (on: boolean) => void;
  onPick: (s: SceneResult) => void;
}) {
  const [ambiance, setAmbiance] = useState("auto");
  const [details, setDetails] = useState("");
  const [generated, setGenerated] = useState<SceneResult[]>(ai.generated);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const generate = () =>
    start(async () => {
      setMsg(null);
      const res = await generateSceneAction(campaignId, ambiance, details);
      if (!res.ok) return setMsg({ tone: "bad", text: res.error });
      setGenerated((g) => [res.scene, ...g]);
      onPick(res.scene);
      setMsg({ tone: "ok", text: `Scène générée et appliquée — encore ${res.left} génération(s) gratuite(s) aujourd’hui.` });
    });

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Sparkles size={16} /> Scène générée par IA (gratuit)
      </h2>
      <p className="mb-2 text-xs text-[#6b858c]">
        L’IA crée un décor sur mesure (lumière, matières, ambiance de l’événement) avec un espace libre au premier plan ; votre vraie photo produit y est posée avec
        ombre, reflet et lumière assortie. Le produit, son logo et les prix ne sont jamais redessinés par l’IA.
      </p>
      {ai.enabled ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[220px_minmax(0,1fr)_auto]">
            <Select value={ambiance} onChange={(e) => setAmbiance(e.target.value)} aria-label="Ambiance">
              {ai.ambiances.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
            <Input value={details} maxLength={200} onChange={(e) => setDetails(e.target.value)} placeholder="Détails (facultatif, en anglais de préférence) : e.g. cream colours, morning light" />
            <Button onClick={generate} disabled={pending}>
              <Sparkles size={14} /> {pending ? "Génération… (≈ 10 s)" : "Générer une scène"}
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-[#6b858c]">Jusqu’à {ai.perDay} scènes par jour (offre gratuite Cloudflare Workers AI, modèle FLUX.1 schnell, usage commercial autorisé).</p>
        </>
      ) : (
        <div className="rounded-lg bg-[#fff4d6] p-3 text-xs text-[#8a6100]">
          Génération IA pas encore activée. C’est gratuit : créez un compte Cloudflare (sans carte bancaire), puis ajoutez sur Vercel les variables
          <code className="mx-1">CLOUDFLARE_ACCOUNT_ID</code>et<code className="mx-1">CLOUDFLARE_AI_TOKEN</code>(jeton « Workers AI »).
        </div>
      )}
      {msg ? <p className={`mt-2 text-sm ${msg.tone === "ok" ? "text-[#0c6b4d]" : "text-[#b42323]"}`}>{msg.text}</p> : null}
      {generated.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {generated.map((s) => (
            <button
              key={s.url}
              type="button"
              onClick={() => onPick(s)}
              title={s.title}
              className={`overflow-hidden rounded-lg border-2 ${current?.url === s.url ? "border-[#0b8fa3] ring-2 ring-[#0b8fa3]/30" : "border-transparent hover:border-[#0b4a56]"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.thumb} alt={s.title} loading="lazy" className="block aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={reflection} onChange={(e) => onReflection(e.target.checked)} /> Reflet du produit sur la surface
      </label>
    </div>
  );
}

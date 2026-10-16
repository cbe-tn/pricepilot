"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarDays, Sparkles, Download, Image as ImageIcon, RotateCcw, Save, Search, ShieldCheck, Shuffle } from "lucide-react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { drawPoster, type Box, type PosterAssets } from "@/components/marketing/render";
import { generateSceneAction, refreshPhotoAction, saveCampaignAction, validateCampaignAction } from "@/lib/marketing-actions";
import {
  BRAND_COLORS,
  checkPoster,
  fmt,
  applyEvent,
  normalizeDesign,
  POSTER_SIZE,
  posterFileName,
  THEMES,
  type PosterDesign,
  type PosterElement,
  type PosterProduct,
} from "@/lib/poster";
import { formatWhen, relativeTime } from "@/lib/money";
import { defaultSceneQuery, eventById, SCENE_CHIPS, upcomingEvents } from "@/lib/events";

type Version = { at: string; design: PosterDesign };

const ELEMENT_LABELS: Record<PosterElement, string> = { title: "Titre", products: "Produits", price: "Prix", benefits: "Avantages" };

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function PosterEditor({
  campaign,
  initialProducts,
  fonts,
  ai,
}: {
  campaign: { id: string; name: string; status: string; validatedAt: string | null; design: PosterDesign; versions: Version[] };
  initialProducts: PosterProduct[];
  fonts: PosterAssets["fonts"];
  ai: { enabled: boolean; perDay: number; ambiances: Array<{ id: string; label: string }>; generated: SceneResult[] };
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [design, setDesign] = useState<PosterDesign>(campaign.design);
  const [name, setName] = useState(campaign.name);
  const [products, setProducts] = useState(initialProducts);
  const [versions, setVersions] = useState<Version[]>(campaign.versions);
  const [status, setStatus] = useState(campaign.status);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<PosterElement | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [renderWarnings, setRenderWarnings] = useState<string[]>([]);
  const [serverMsg, setServerMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [pending, start] = useTransition();
  const drag = useRef<{ el: PosterElement; x: number; y: number; dx: number; dy: number } | null>(null);

  const [assets, setAssets] = useState<PosterAssets | null>(null);
  const check = useMemo(() => {
    const c = checkPoster(design, products);
    // The catalogue says "photo available" but the image itself may be missing on numedia.tn.
    if (assets) for (const p of products) if (p.hasPhoto && !assets.photos.get(p.id)) c.errors.push(`${p.name} : la photo officielle n'a pas pu être chargée.`);
    return c;
  }, [design, products, assets]);

  const update = useCallback((patch: Partial<PosterDesign>) => {
    setDesign((d) => ({ ...d, ...patch }));
    setDirty(true);
    setStatus("draft");
    setServerMsg(null);
  }, []);

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

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !assets) return;
    const res = drawPoster(ctx, design, products, check.pricing, assets);
    setBoxes(res.boxes);
    setRenderWarnings(res.warnings);
  }, [design, products, check.pricing, assets]);

  const toPoster = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * POSTER_SIZE) / r.width, y: ((e.clientY - r.top) * POSTER_SIZE) / r.height };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPoster(e);
    const hit = [...boxes].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    setSelected(hit?.el ?? null);
    if (!hit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const l = design.layout[hit.el];
    drag.current = { el: hit.el, x: p.x, y: p.y, dx: l.dx, dy: l.dy };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPoster(e);
    const clamp = (v: number) => Math.max(-500, Math.min(500, Math.round(v)));
    update({ layout: { ...design.layout, [d.el]: { ...design.layout[d.el], dx: clamp(d.dx + p.x - d.x), dy: clamp(d.dy + p.y - d.y) } } });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // Random style and brand colour, layout back to the template defaults.
  const surprise = () => {
    const others = THEMES.filter((t) => t.value !== design.theme);
    const theme = others[Math.floor(Math.random() * others.length)].value;
    const accent = Math.random() < 0.6 ? design.accent : BRAND_COLORS[Math.floor(Math.random() * BRAND_COLORS.length)].value;
    const home = { dx: 0, dy: 0, scale: 1 };
    update({ theme, accent, layout: { title: home, products: home, price: home, benefits: home } });
  };

  const setScale = (el: PosterElement, scale: number) => update({ layout: { ...design.layout, [el]: { ...design.layout[el], scale } } });
  const resetElement = (el: PosterElement) => update({ layout: { ...design.layout, [el]: { dx: 0, dy: 0, scale: 1 } } });

  const move = (i: number, dir: -1 | 1) => {
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
    update({ [key]: list } as Partial<PosterDesign>);
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
        setServerMsg({ tone: "bad", text: "Validation refusée : corrigez les points bloquants ci-dessous." });
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

  const ar = design.lang === "ar";
  const bi = design.lang === "bi";
  const showFr = !ar;
  const showAr = ar || bi;
  const canDownload = status === "validated" && !dirty && check.errors.length === 0;
  const selBox = boxes.find((b) => b.el === selected);
  const ordered = design.productOrder.map((id) => products.find((p) => p.id === id)).filter((p): p is PosterProduct => Boolean(p));
  const ownSum = ordered.every((p) => p.ownStatus === "found" && p.ownPrice) ? ordered.reduce((s, p) => s + (p.ownPrice ?? 0), 0) : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div className="xl:sticky xl:top-4 xl:self-start">
        <div className="relative overflow-hidden rounded-xl border border-[#d7e3e6] bg-white shadow-sm">
          <canvas
            ref={canvasRef}
            width={POSTER_SIZE}
            height={POSTER_SIZE}
            className="block aspect-square w-full touch-none cursor-move"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="Aperçu de l'affiche 1080 × 1080"
          />
          {selBox ? (
            <div
              className="pointer-events-none absolute border-2 border-dashed border-[#0b8fa3]"
              style={{
                left: `${(selBox.x / POSTER_SIZE) * 100}%`,
                top: `${(selBox.y / POSTER_SIZE) * 100}%`,
                width: `${(selBox.w / POSTER_SIZE) * 100}%`,
                height: `${(selBox.h / POSTER_SIZE) * 100}%`,
              }}
            />
          ) : null}
          {!assets ? <div className="absolute inset-0 grid place-items-center bg-white/80 text-sm text-[#4d6a72]">Chargement des polices et des photos…</div> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#4d6a72]">
          {selected ? (
            <>
              <span className="font-semibold">{ELEMENT_LABELS[selected]}</span>
              <input
                type="range"
                min={0.5}
                max={1.6}
                step={0.05}
                value={design.layout[selected].scale}
                onChange={(e) => setScale(selected, Number(e.target.value))}
                aria-label="Taille"
              />
              <span className="tabular-nums">{Math.round(design.layout[selected].scale * 100)} %</span>
              <Button size="sm" variant="ghost" onClick={() => resetElement(selected)}>
                <RotateCcw size={14} /> Position d’origine
              </Button>
            </>
          ) : (
            <span>Cliquez sur le titre, les produits, le prix ou les avantages pour les déplacer et les redimensionner.</span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-[#6b858c]">L’aperçu est le fichier exporté : PNG 1080 × 1080 px.</p>
      </div>

      <div className="grid gap-4">
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom de la campagne">
              <Input
                value={name}
                maxLength={100}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                  setStatus("draft");
                }}
              />
            </Field>
            <Field label="Langue de l'affiche">
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#4d6a72]">Couleur</span>
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
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Style de l’affiche</h2>
            <Button size="sm" variant="secondary" onClick={surprise}>
              <Shuffle size={14} /> Surprends-moi
            </Button>
          </div>
          <StyleGallery design={design} products={products} pricing={check.pricing} assets={assets} onPick={(theme) => update({ theme })} />
        </Card>

        <Card>
          <EventPicker value={design.event} onChange={(id) => update(applyEvent(design, id, products))} />
        </Card>

        <Card>
          <AiScenePanel
            campaignId={campaign.id}
            ai={ai}
            current={design.scene}
            reflection={design.reflection}
            onReflection={(reflection) => update({ reflection })}
            onPick={(scene) => update({ scene, theme: "scene" })}
          />
        </Card>

        <Card>
          <ScenePicker
            scene={design.scene}
            initialQuery={eventById(design.event)?.scene ?? defaultSceneQuery(products)}
            onPick={(scene) => update({ scene, theme: "scene" })}
          />
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Textes</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {showFr ? (
              <>
                <Field label="Titre">
                  <Input value={design.title} maxLength={80} onChange={(e) => update({ title: e.target.value })} />
                </Field>
                <Field label="Sous-titre (modèle)">
                  <Input value={design.subtitle} maxLength={140} onChange={(e) => update({ subtitle: e.target.value })} />
                </Field>
                <Field label="Étiquette">
                  <Input value={design.tag} maxLength={24} onChange={(e) => update({ tag: e.target.value })} />
                </Field>
                <Field label="Appel à l'action">
                  <Input value={design.cta} maxLength={60} onChange={(e) => update({ cta: e.target.value })} />
                </Field>
              </>
            ) : null}
            {showAr ? (
              <>
                <Field label="العنوان — titre arabe (tunisien)">
                  <Input dir="rtl" value={design.titleAr} maxLength={80} onChange={(e) => update({ titleAr: e.target.value })} />
                </Field>
                {ar ? (
                  <Field label="Sous-titre arabe (sinon le modèle)">
                    <Input dir="rtl" value={design.subtitleAr} maxLength={140} onChange={(e) => update({ subtitleAr: e.target.value })} />
                  </Field>
                ) : null}
                {ar ? (
                  <Field label="Étiquette arabe">
                    <Input dir="rtl" value={design.tagAr} maxLength={24} onChange={(e) => update({ tagAr: e.target.value })} />
                  </Field>
                ) : null}
                <Field label="Appel à l'action arabe">
                  <Input dir="rtl" value={design.ctaAr} maxLength={60} onChange={(e) => update({ ctaAr: e.target.value })} />
                </Field>
              </>
            ) : null}
            <Field label="Site / contact (pied d'affiche)">
              <Input value={design.footer} maxLength={120} onChange={(e) => update({ footer: e.target.value })} />
            </Field>
            <Field label="Offre valable jusqu'au (facultatif)">
              <Input type="date" value={design.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#4d6a72]">Avantages produit (3 au plus — uniquement des caractéristiques vérifiées)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid gap-1">
                  {showFr ? <Input placeholder={`Avantage ${i + 1} (ex. 2000 Watts)`} value={design.benefits[i] ?? ""} maxLength={40} onChange={(e) => setList("benefits", i, e.target.value)} /> : null}
                  {showAr ? <Input dir="rtl" placeholder={`ميزة ${i + 1} (بالتونسي)`} value={design.benefitsAr[i] ?? ""} maxLength={40} onChange={(e) => setList("benefitsAr", i, e.target.value)} /> : null}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold">Prix</h2>
          <p className="mb-3 text-xs text-[#6b858c]">
            Prix barré = prix confirmé sur numedia.tn{ordered.length > 1 ? " (somme des articles du pack)" : ""}. Il n’est jamais saisi à la main.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={ordered.length > 1 ? "Prix du pack (TTC)" : "Prix affiché (TTC)"}>
              <Input
                type="number"
                min={0}
                step="0.001"
                value={design.promoPrice ?? ""}
                onChange={(e) => update({ promoPrice: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <div className="text-sm">
              <div className="text-xs text-[#6b858c]">Prix numedia.tn</div>
              <div className="font-semibold tabular-nums">{ownSum != null ? `${fmt(ownSum)} DT` : "non confirmé"}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-[#6b858c]">Plancher (marge min.)</div>
              <div className="font-semibold tabular-nums">{check.pricing.floor != null ? `${fmt(check.pricing.floor)} DT` : "coût inconnu"}</div>
              {check.pricing.marginPct != null ? <div className="text-xs text-[#4d6a72]">Marge au prix affiché : {Math.round(check.pricing.marginPct * 1000) / 10} %</div> : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={design.showOldPrice} onChange={(e) => update({ showOldPrice: e.target.checked })} /> Afficher le prix barré
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={design.showDiscount} onChange={(e) => update({ showDiscount: e.target.checked })} /> Afficher la remise en %
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Produits ({ordered.length})</h2>
          <div className="grid gap-2">
            {ordered.map((p, i) => {
              const cheapest = p.competitors.filter((c) => (c.matchClass === "exact" || c.matchClass === "strong") && c.availability !== "out_of_stock").sort((a, b) => a.price - b.price)[0];
              return (
                <div key={p.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-[#e3ecee] p-2 text-sm">
                  <div className="flex flex-col">
                    <button type="button" className="p-0.5 text-[#4d6a72] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className="p-0.5 text-[#4d6a72] disabled:opacity-30" disabled={i === ordered.length - 1} onClick={() => move(i, 1)} aria-label="Descendre">
                      <ArrowDown size={14} />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-[#6b858c]">
                      {p.ref ?? "sans référence"} · stock {p.stockQty} ·{" "}
                      {p.ownStatus === "found" && p.ownPrice != null ? (
                        <>
                          numedia.tn {fmt(p.ownPrice)} DT ({relativeTime(p.ownCheckedAt)})
                        </>
                      ) : (
                        "prix numedia.tn non confirmé"
                      )}
                      {cheapest ? (
                        <>
                          {" "}
                          · moins cher concurrent : {cheapest.name} {fmt(cheapest.price)} DT ({relativeTime(cheapest.checkedAt)})
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={pending || p.ownStatus !== "found"} onClick={() => refreshPhoto(p.id)}>
                    Recharger la photo officielle
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold">Vérification et export</h2>
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
          {serverMsg ? <p className={`mb-3 text-sm ${serverMsg.tone === "ok" ? "text-[#0c6b4d]" : "text-[#b42323]"}`}>{serverMsg.text}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={pending} onClick={save}>
              <Save size={16} /> Enregistrer le brouillon
            </Button>
            <Button disabled={pending || check.errors.length > 0} onClick={validate}>
              <ShieldCheck size={16} /> {pending ? "Vérification…" : "Valider l'affiche"}
            </Button>
            <Button variant="gold" disabled={!canDownload} onClick={download} title={canDownload ? "" : "Validez l'affiche pour la télécharger"}>
              <Download size={16} /> Télécharger l’affiche
            </Button>
            <Badge tone={status === "validated" && !dirty ? "ok" : "warn"}>{status === "validated" && !dirty ? "Validée" : dirty ? "Modifications non enregistrées" : "Brouillon"}</Badge>
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold">Versions précédentes</h2>
          {versions.length ? (
            <ul className="grid gap-1 text-sm">
              {versions.map((v, i) => (
                <li key={`${v.at}-${i}`} className="flex items-center justify-between gap-2">
                  <span>{formatWhen(v.at)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // Old prices and checks are always recomputed from the catalogue, never restored.
                      update(normalizeDesign(v.design, products));
                    }}
                  >
                    Restaurer
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[#6b858c]">Chaque enregistrement conserve la version précédente ici.</p>
          )}
        </Card>
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

/** Realistic backgrounds (CC0 photos); picking one switches the poster to the "Scène réaliste" style. */
function ScenePicker({ scene, initialQuery, onPick }: { scene: SceneResult | null; initialQuery: string; onPick: (s: SceneResult) => void }) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<SceneResult[]>([]);
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setState({ loading: true, error: null });
    try {
      const res = await fetch(`/api/marketing/scenes?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as { scenes: SceneResult[]; error?: string };
      setResults(data.scenes);
      setState({ loading: false, error: data.error ?? (data.scenes.length ? null : "Aucune photo pour cette recherche — essayez un mot en anglais (kitchen, beach…).") });
    } catch {
      setState({ loading: false, error: "Recherche impossible pour le moment." });
    }
  }, []);

  useEffect(() => {
    // First suggestions for the products (kitchen for appliances, office for printers…).
    const t = setTimeout(() => void search(initialQuery), 0);
    return () => clearTimeout(t);
  }, [initialQuery, search]);

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ImageIcon size={16} /> Scène réaliste
      </h2>
      <p className="mb-2 text-xs text-[#6b858c]">
        Le produit est détouré automatiquement et posé dans une vraie photo (libre de droits CC0, usage commercial autorisé). Choisir une photo active le style « Scène réaliste ».
      </p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {SCENE_CHIPS.map((c) => (
          <button
            key={c.q}
            type="button"
            onClick={() => {
              setQ(c.q);
              void search(c.q);
            }}
            className={`rounded-full border px-2.5 py-1 text-xs ${q === c.q ? "border-[#0b4a56] bg-[#0b4a56] text-white" : "border-[#d7e3e6] bg-white text-[#0b4a56] hover:border-[#0b4a56]"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <Input className="h-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Recherche en anglais : kitchen, beach, forest…" />
        <Button size="sm" type="submit" variant="secondary" disabled={state.loading}>
          <Search size={14} /> {state.loading ? "…" : "Chercher"}
        </Button>
      </form>
      {state.error ? <p className="mb-2 text-xs text-[#8a6100]">{state.error}</p> : null}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {results.map((s) => (
          <button
            key={s.url}
            type="button"
            onClick={() => onPick(s)}
            title={`${s.title} — ${s.creator}`}
            className={`overflow-hidden rounded-lg border-2 ${scene?.url === s.url ? "border-[#0b8fa3] ring-2 ring-[#0b8fa3]/30" : "border-transparent hover:border-[#0b4a56]"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.thumb} alt={s.title} loading="lazy" className="block aspect-square w-full object-cover" />
          </button>
        ))}
      </div>
      {scene ? (
        <p className="mt-2 text-[11px] text-[#6b858c]">
          Photo : « {scene.title} » par {scene.creator || "auteur inconnu"} —{" "}
          <a href={scene.landing} target="_blank" rel="noreferrer" className="underline">
            StockSnap (CC0)
          </a>
        </p>
      ) : null}
    </div>
  );
}

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
          <code className="mx-1">CLOUDFLARE_ACCOUNT_ID</code>et<code className="mx-1">CLOUDFLARE_AI_TOKEN</code>(jeton « Workers AI »). En attendant, utilisez les photos réelles ci-dessous.
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

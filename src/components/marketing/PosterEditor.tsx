"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Download, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { drawPoster, type Box, type PosterAssets } from "@/components/marketing/render";
import { refreshPhotoAction, saveCampaignAction, validateCampaignAction } from "@/lib/marketing-actions";
import {
  BRAND_COLORS,
  checkPoster,
  fmt,
  normalizeDesign,
  POSTER_SIZE,
  posterFileName,
  THEMES,
  type PosterDesign,
  type PosterElement,
  type PosterProduct,
} from "@/lib/poster";
import { formatWhen, relativeTime } from "@/lib/money";

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
}: {
  campaign: { id: string; name: string; status: string; validatedAt: string | null; design: PosterDesign; versions: Version[] };
  initialProducts: PosterProduct[];
  fonts: { latin: string; arabic: string };
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

  // Fonts and images must be ready before painting, or the canvas would fall back to system fonts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all(
        [fonts.latin, fonts.arabic].flatMap((f) => [500, 600, 800, 900].map((w) => document.fonts.load(`${w} 40px ${f}`, "Aa عربي 0123").catch(() => []))),
      );
      const logoSrc = design.brand === "cbe" ? "/brand/logo-full.png" : "/brand/numedia-logo.webp";
      const [logo, ...photos] = await Promise.all([
        loadImage(logoSrc),
        ...products.map((p) => (p.hasPhoto ? loadImage(`/api/marketing/image?product=${p.id}&v=${photoVersion}`) : Promise.resolve(null))),
      ]);
      if (!cancelled) setAssets({ fonts, logo, photos: new Map(products.map((p, i) => [p.id, photos[i]])) });
    })();
    return () => {
      cancelled = true;
    };
  }, [design.brand, fonts, products, photoVersion]);

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
            <Field label="Style">
              <Select value={design.theme} onChange={(e) => update({ theme: e.target.value as PosterDesign["theme"] })}>
                {THEMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
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

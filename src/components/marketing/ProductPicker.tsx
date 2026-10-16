"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { createCampaignAction } from "@/lib/marketing-actions";
import { DEFAULT_WEIGHTS, fmt, MAX_POSTER_PRODUCTS, scoreProduct, type PosterProduct, type ScoreWeights } from "@/lib/poster";
import { relativeTime } from "@/lib/money";
import { upcomingEvents } from "@/lib/events";

const WEIGHTS_KEY = "pp-marketing-weights";
const PAGE = 60;

const noSubscribe = () => () => {};
function readStoredWeights(): string | null {
  try {
    return localStorage.getItem(WEIGHTS_KEY);
  } catch {
    return null;
  }
}

const WEIGHT_LABELS: Record<keyof ScoreWeights, string> = {
  price: "Compétitivité du prix",
  margin: "Marge",
  stock: "Stock",
  data: "Qualité des données",
};

function CreateButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Création…" : "Créer l'affiche"}
    </Button>
  );
}

export function ProductPicker({ products }: { products: PosterProduct[] }) {
  // Weights are a per-browser preference: read from localStorage without a render-time mismatch.
  const stored = useSyncExternalStore(noSubscribe, readStoredWeights, () => null);
  const [override, setWeights] = useState<ScoreWeights | null>(null);
  const weights = useMemo<ScoreWeights>(() => {
    if (override) return override;
    try {
      const saved = JSON.parse(stored ?? "null");
      return saved && typeof saved === "object" ? { ...DEFAULT_WEIGHTS, ...saved } : DEFAULT_WEIGHTS;
    } catch {
      return DEFAULT_WEIGHTS;
    }
  }, [override, stored]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [readyOnly, setReadyOnly] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string[]>([]);
  const [events] = useState(() => upcomingEvents());

  const setWeight = (k: keyof ScoreWeights, v: number) => {
    const next = { ...weights, [k]: v };
    setWeights(next);
    try {
      localStorage.setItem(WEIGHTS_KEY, JSON.stringify(next));
    } catch {
      /* ignoré */
    }
  };

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort(), [products]);
  const scored = useMemo(() => products.map((p) => ({ p, s: scoreProduct(p, weights) })), [products, weights]);
  const query = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      scored
        .filter(({ p }) => !category || p.category === category)
        .filter(({ p }) => !query || [p.name, p.ref, p.category].some((v) => v?.toLowerCase().includes(query)))
        .filter(({ p }) => !readyOnly || (p.stockQty > 0 && p.hasPhoto && p.ownPrice != null))
        .sort((a, b) => b.s.score - a.s.score),
    [scored, category, query, readyOnly],
  );

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_POSTER_PRODUCTS ? s : [...s, id]));
  const chosen = selected.map((id) => products.find((p) => p.id === id)).filter((p): p is PosterProduct => Boolean(p));

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          {(Object.keys(WEIGHT_LABELS) as Array<keyof ScoreWeights>).map((k) => (
            <label key={k} className="grid gap-1 text-xs text-[#4d6a72]">
              <span>
                {WEIGHT_LABELS[k]} : <strong className="tabular-nums">{weights[k]}</strong>
              </span>
              <input type="range" min={0} max={60} step={5} value={weights[k]} onChange={(e) => setWeight(k, Number(e.target.value))} />
            </label>
          ))}
          <Button size="sm" variant="ghost" onClick={() => {
              setWeights(DEFAULT_WEIGHTS);
              try {
                localStorage.removeItem(WEIGHTS_KEY);
              } catch {
                /* ignoré */
              }
            }}>
            Pondérations par défaut
          </Button>
        </div>
        <p className="mt-2 text-xs text-[#6b858c]">
          Score d’opportunité (0–100) : prix numedia.tn face au concurrent le moins cher (références confirmées uniquement), marge au-dessus du minimum, stock, et
          données disponibles (photo officielle, prix récent, concurrent). Les données manquantes sont signalées, jamais estimées.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#e3ecee] p-3">
            <Input className="h-9 w-56" placeholder="Réf, désignation…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select className="h-9 w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Toutes les catégories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} /> Prêts pour une affiche (stock, photo, prix numedia.tn)
            </label>
            <span className="ml-auto text-xs text-[#4d6a72]">{rows.length.toLocaleString("fr-FR")} produits</span>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="pp-table pp-compact">
              <thead>
                <tr>
                  <th></th>
                  <th>Produit</th>
                  <th className="text-right">Prix numedia.tn</th>
                  <th className="text-right">Moins cher concurrent</th>
                  <th className="text-right">Marge</th>
                  <th className="text-right">Stock</th>
                  <th className="text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map(({ p, s }) => {
                  const on = selected.includes(p.id);
                  return (
                    <tr key={p.id} className={on ? "bg-[#e8f1f3]" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && selected.length >= MAX_POSTER_PRODUCTS}
                          onChange={() => toggle(p.id)}
                          aria-label={`Sélectionner ${p.name}`}
                        />
                      </td>
                      <td className="min-w-[260px]">
                        <div className="flex items-center gap-2">
                          {/* Photos load only for selected rows: one request per photo through the server,
                              so a full list would open too many database connections at once. */}
                          {p.hasPhoto && on ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/marketing/image?product=${p.id}`}
                              alt=""
                              loading="lazy"
                              className="h-10 w-10 shrink-0 rounded bg-white object-contain"
                              onError={(e) => {
                                // Listed on numedia.tn but without a photo there.
                                e.currentTarget.style.visibility = "hidden";
                              }}
                            />
                          ) : (
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-[#eef3f5] text-center text-[9px] leading-tight text-[#8aa0a6]">
                              {p.hasPhoto ? "photo" : "sans photo"}
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium">{p.name}</div>
                            <div className="text-[11px] text-[#6b858c]">
                              {p.ref ?? "sans référence"}
                              {p.category ? ` · ${p.category}` : ""}
                            </div>
                            {s.flags.length ? <div className="text-[11px] text-[#8a6100]">{s.flags.join(" · ")}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">
                        {p.ownStatus === "found" && p.ownPrice != null ? (
                          <>
                            {p.ownUrl ? (
                              <a href={p.ownUrl} target="_blank" rel="noreferrer" className="underline">
                                {fmt(p.ownPrice)}
                              </a>
                            ) : (
                              fmt(p.ownPrice)
                            )}
                            <div className="text-[10px] text-[#6b858c]">{relativeTime(p.ownCheckedAt)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {s.cheapest ? (
                          <>
                            {fmt(s.cheapest.price)}
                            <div className="text-[10px] text-[#6b858c]">
                              {s.cheapest.name} · {relativeTime(s.cheapest.checkedAt)}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-right tabular-nums">{s.marginPct != null ? `${Math.round(s.marginPct * 1000) / 10} %` : "—"}</td>
                      <td className="text-right tabular-nums">{p.stockQty}</td>
                      <td className="text-right">
                        <span
                          title={`Prix ${Math.round(s.parts.price * 100)} · Marge ${Math.round(s.parts.margin * 100)} · Stock ${Math.round(s.parts.stock * 100)} · Données ${Math.round(s.parts.data * 100)}`}
                        >
                          <Badge tone={s.score >= 70 ? "ok" : s.score >= 45 ? "teal" : "warn"}>{s.score}</Badge>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > limit ? (
              <div className="p-3 text-center">
                <Button size="sm" variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                  Afficher plus
                </Button>
              </div>
            ) : null}
            {!rows.length ? <p className="p-6 text-center text-sm text-[#6b858c]">Aucun produit ne correspond. Décochez « Prêts pour une affiche » pour tout voir.</p> : null}
          </div>
        </Card>

        <Card className="self-start lg:sticky lg:top-4">
          <h2 className="mb-1 text-sm font-semibold">Nouvelle affiche</h2>
          <p className="mb-3 text-xs text-[#6b858c]">1 produit = affiche produit · 2 à {MAX_POSTER_PRODUCTS} produits = pack promotionnel.</p>
          {chosen.length ? (
            <ul className="mb-3 grid gap-1 text-sm">
              {chosen.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">{p.name}</span>
                  <button type="button" className="text-xs text-[#b42323]" onClick={() => toggle(p.id)}>
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-[#6b858c]">Cochez des produits dans la liste.</p>
          )}
          <form action={createCampaignAction} className="grid gap-3">
            {selected.map((id) => (
              <input key={id} type="hidden" name="productIds" value={id} />
            ))}
            <Field label="Nom de la campagne">
              <Input name="name" required maxLength={100} placeholder={chosen.length > 1 ? "Pack rentrée" : "Promo de la semaine"} />
            </Field>
            <Field label="Marque">
              <Select name="brand" defaultValue="numedia">
                <option value="numedia">NUMEDIA</option>
                <option value="cbe">CBE — Cap Bon Electronique</option>
              </Select>
            </Field>
            <Field label="Langue de l'affiche">
              <Select name="lang" defaultValue="fr">
                <option value="fr">Français</option>
                <option value="ar">Arabe</option>
                <option value="bi">Bilingue français + arabe</option>
              </Select>
            </Field>
            <Field label="Événement (facultatif)">
              <Select name="event" defaultValue="">
                <option value="">Aucun</option>
                {events.map(({ event, date, approx }) => (
                  <option key={event.id} value={event.id}>
                    {event.label}
                    {date ? ` — ${approx ? "≈ " : ""}${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <CreateButton disabled={!selected.length} />
          </form>
        </Card>
      </div>
    </div>
  );
}

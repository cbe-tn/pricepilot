"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  addManualOfferAction,
  addMovementAction,
  addQuoteAction,
  autoMatchProductsAction,
  bulkProductAction,
  discoveryAction,
  findOnCompetitorsAction,
  forgotAction,
  importProductsAction,
  inviteStaffAction,
  loginAction,
  refreshCatalogsAction,
  registerAction,
  resetAction,
  reviewMatchAction,
  runCheckNowAction,
  saveRecommendationAction,
  upsertCompetitorAction,
  upsertSupplierAction,
} from "@/lib/actions";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { analyzePrice, minAcceptableTtc, breakEvenTtc, positionLabel, type MarketStats, type TaxAssumptions, type CostInput } from "@/lib/pricing";
import { formatPctPoints, formatTnd, n, round3 } from "@/lib/money";
import { fr } from "@/lib/labels";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null as { error?: string } | null);
  return (
    <form action={action} className="space-y-4">
      <Field label="E-mail">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Mot de passe">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      {state?.error ? <p className="text-sm text-[#c53d3d]">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, null as { error?: string } | null);
  return (
    <form action={action} className="space-y-4">
      <Field label="Nom complet">
        <Input name="fullName" required placeholder="Votre nom" />
      </Field>
      <Field label="E-mail professionnel">
        <Input name="email" type="email" required />
      </Field>
      <Field label="Mot de passe" hint="Au moins 8 caractères.">
        <Input name="password" type="password" required minLength={8} />
      </Field>
      <Field label="Nom de la boutique">
        <Input name="workspaceName" placeholder="ex. Magasin Info Tunis" />
      </Field>
      <Field label="Ville">
        <Input name="city" defaultValue="Tunis" />
      </Field>
      {state?.error ? <p className="text-sm text-[#c53d3d]">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Création…" : "Créer mon espace"}
      </Button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotAction, null as { error?: string; ok?: boolean; message?: string; demoLink?: string } | null);
  return (
    <form action={action} className="space-y-4">
      <Field label="E-mail du compte">
        <Input name="email" type="email" required />
      </Field>
      {state?.error ? <p className="text-sm text-[#c53d3d]">{state.error}</p> : null}
      {state?.message ? <p className="text-sm text-[#0c8a62]">{state.message}</p> : null}
      {state?.demoLink ? (
        <p className="text-sm">
          Lien de réinitialisation :{" "}
          <Link className="font-medium text-[#0b4a56] underline" href={state.demoLink}>
            {state.demoLink}
          </Link>
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        Envoyer le lien
      </Button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAction, null as { error?: string } | null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Nouveau mot de passe">
        <Input name="password" type="password" required minLength={8} />
      </Field>
      {state?.error ? <p className="text-sm text-[#c53d3d]">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        Mettre à jour le mot de passe
      </Button>
    </form>
  );
}

export type ProductFormValues = {
  id?: string;
  name?: string;
  brand?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  manufacturerRef?: string | null;
  barcode?: string | null;
  sku?: string | null;
  category?: string | null;
  subcategory?: string | null;
  imageUrl?: string | null;
  purchasePrice?: string | number | null;
  purchaseCurrency?: string | null;
  exchangeRate?: string | number | null;
  shippingCost?: string | number | null;
  importCost?: string | number | null;
  otherCosts?: string | number | null;
  vatRate?: string | number | null;
  minProfitMargin?: string | number | null;
  targetSellingPrice?: string | number | null;
  actualSellingPrice?: string | number | null;
  stockQty?: number | null;
  supplierName?: string | null;
  warranty?: string | null;
  condition?: string | null;
  description?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  specifications?: Record<string, string> | null;
  monitoringStatus?: string | null;
};

export function ProductForm({
  action,
  product,
  defaults,
}: {
  action: (formData: FormData) => unknown | Promise<unknown>;
  product?: ProductFormValues;
  defaults: { vatPct: number; minMarginPct: number };
}) {
  const [step, setStep] = useState(0);
  const steps = ["Identité", "Coûts", "Prix", "Stock & notes"];
  return (
    <form
      action={async (formData) => {
        await Promise.resolve(action(formData));
      }}
      className="space-y-5"
    >
      {product?.id ? <input type="hidden" name="id" value={product.id} /> : null}
      <div className="flex gap-2">
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${i === step ? "bg-[#0b4a56] text-white" : "bg-white text-[#4d6a72] border border-[#d7e3e6]"}`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>
      {step === 0 ? (
        <Card className="grid gap-4 md:grid-cols-2">
          <Field label="Nom du produit">
            <Input name="name" required defaultValue={product?.name ?? ""} placeholder="ex. Imprimante EPSON EcoTank L3251" />
          </Field>
          <Field label="Marque">
            <Input name="brand" defaultValue={product?.brand ?? ""} />
          </Field>
          <Field label="Fabricant">
            <Input name="manufacturer" defaultValue={product?.manufacturer ?? ""} />
          </Field>
          <Field label="Modèle">
            <Input name="model" defaultValue={product?.model ?? ""} />
          </Field>
          <Field label="Référence fabricant" hint="La référence exacte du constructeur — c'est elle qui sert à retrouver le produit chez les concurrents.">
            <Input name="manufacturerRef" defaultValue={product?.manufacturerRef ?? ""} />
          </Field>
          <Field label="Code-barres / EAN">
            <Input name="barcode" defaultValue={product?.barcode ?? ""} />
          </Field>
          <Field label="SKU interne">
            <Input name="sku" defaultValue={product?.sku ?? ""} />
          </Field>
          <Field label="Catégorie">
            <Input name="category" defaultValue={product?.category ?? ""} placeholder="Imprimantes" />
          </Field>
          <Field label="Sous-catégorie">
            <Input name="subcategory" defaultValue={product?.subcategory ?? ""} />
          </Field>
          <Field label="URL de l'image">
            <Input name="imageUrl" defaultValue={product?.imageUrl ?? ""} />
          </Field>
        </Card>
      ) : null}
      {step === 1 ? (
        <Card className="grid gap-4 md:grid-cols-2">
          <Field label="Prix d'achat HT">
            <Input name="purchasePrice" type="number" step="0.001" defaultValue={product?.purchasePrice ?? ""} />
          </Field>
          <Field label="Devise d'achat">
            <Input name="purchaseCurrency" defaultValue={product?.purchaseCurrency ?? "TND"} />
          </Field>
          <Field label="Taux de change vers TND" hint="Mettre 1 si le prix est déjà en TND.">
            <Input name="exchangeRate" type="number" step="0.001" defaultValue={product?.exchangeRate ?? 1} />
          </Field>
          <Field label="Transport / fret">
            <Input name="shippingCost" type="number" step="0.001" defaultValue={product?.shippingCost ?? 0} />
          </Field>
          <Field label="Import / douane">
            <Input name="importCost" type="number" step="0.001" defaultValue={product?.importCost ?? 0} />
          </Field>
          <Field label="Autres coûts">
            <Input name="otherCosts" type="number" step="0.001" defaultValue={product?.otherCosts ?? 0} />
          </Field>
          <Field label="Taux de TVA %" hint="Taux normal en Tunisie : 19 % (7 % pour certains produits informatiques).">
            <Input name="vatRate" type="number" step="0.1" defaultValue={n(product?.vatRate) ? n(product?.vatRate) * 100 : defaults.vatPct} />
          </Field>
        </Card>
      ) : null}
      {step === 2 ? (
        <Card className="grid gap-4 md:grid-cols-2">
          <Field label="Marge minimale %">
            <Input
              name="minProfitMargin"
              type="number"
              step="0.1"
              defaultValue={n(product?.minProfitMargin) ? n(product?.minProfitMargin) * 100 : defaults.minMarginPct}
            />
          </Field>
          <Field label="Prix de vente cible TTC (DT)">
            <Input name="targetSellingPrice" type="number" step="0.001" defaultValue={product?.targetSellingPrice ?? ""} />
          </Field>
          <Field label="Prix de vente actuel TTC (DT)">
            <Input name="actualSellingPrice" type="number" step="0.001" defaultValue={product?.actualSellingPrice ?? ""} />
          </Field>
          <Field label="Suivi">
            <Select name="monitoringStatus" defaultValue={product?.monitoringStatus ?? "active"}>
              <option value="active">Actif</option>
              <option value="paused">En pause</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="URL produits concurrents (facultatif)" hint="Une URL par ligne. Inutile en général : les offres sont trouvées automatiquement par la référence.">
              <Textarea name="competitorUrls" placeholder="https://www.mytek.tn/..." />
            </Field>
          </div>
        </Card>
      ) : null}
      {step === 3 ? (
        <Card className="grid gap-4 md:grid-cols-2">
          <Field label="Quantité en stock">
            <Input name="stockQty" type="number" defaultValue={product?.stockQty ?? 0} />
          </Field>
          <Field label="Fournisseur">
            <Input name="supplierName" defaultValue={product?.supplierName ?? ""} />
          </Field>
          <Field label="Garantie">
            <Input name="warranty" defaultValue={product?.warranty ?? ""} />
          </Field>
          <Field label="État">
            <Select name="condition" defaultValue={product?.condition ?? "new"}>
              <option value="new">Neuf</option>
              <option value="refurbished">Reconditionné</option>
              <option value="used">Occasion</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <Textarea name="description" defaultValue={product?.description ?? ""} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Caractéristiques" hint="Une par ligne, ex. Format : A4">
              <Textarea
                name="specifications"
                defaultValue={
                  product?.specifications
                    ? Object.entries(product.specifications)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join("\n")
                    : ""
                }
              />
            </Field>
          </div>
          <Field label="Étiquettes" hint="Séparées par des virgules">
            <Input name="tags" defaultValue={(product?.tags ?? []).join(", ")} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes internes">
              <Textarea name="notes" defaultValue={product?.notes ?? ""} />
            </Field>
          </div>
        </Card>
      ) : null}
      <div className="flex justify-between">
        <Button type="button" variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Retour
        </Button>
        {step < 3 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)}>
            Continuer
          </Button>
        ) : (
          <Button type="submit">{product?.id ? "Enregistrer" : "Ajouter le produit"}</Button>
        )}
      </div>
    </form>
  );
}

export function Simulator({
  cost,
  tax,
  minMargin,
  current,
  market,
}: {
  cost: CostInput;
  tax: TaxAssumptions;
  minMargin: number;
  current: number;
  market: MarketStats;
}) {
  const [price, setPrice] = useState(current || 0);
  const [targetProfit, setTargetProfit] = useState(1000);
  const analysis = useMemo(() => analyzePrice(price, cost, tax), [price, cost, tax]);
  const minPx = minAcceptableTtc(cost, tax, minMargin);
  const be = breakEvenTtc(cost, tax);
  const units = analysis.grossProfit > 0 ? Math.ceil(targetProfit / analysis.grossProfit) : null;
  return (
    <Card>
      <h3 className="text-base font-semibold">Simulateur de prix</h3>
      <p className="mt-1 text-sm text-[#4d6a72]">
        Faites varier le prix de vente pour voir instantanément le bénéfice, la marge et votre position sur le marché. Rien n’est modifié sur votre boutique en ligne.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label={`Prix de vente TTC (${formatTnd(price)})`}>
          <input
            type="range"
            min={Math.max(1, Math.round(be * 0.8))}
            max={Math.max(Math.round((market.highest ?? (price > 0 ? price * 1.4 : 1000)) * 1.15), 10)}
            step={1}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full"
          />
          <Input type="number" step="0.001" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="mt-2" />
        </Field>
        <Field label="Bénéfice visé (DT)">
          <Input type="number" step="0.001" value={targetProfit} onChange={(e) => setTargetProfit(Number(e.target.value))} />
        </Field>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini k="Bénéfice / unité" v={formatTnd(analysis.grossProfit)} />
        <Mini k="Marge brute" v={formatPctPoints(analysis.grossMargin)} />
        <Mini k="Position marché" v={positionLabel(price, market)} />
        <Mini k="Écart vs moins cher" v={market.lowest != null ? formatTnd(price - market.lowest) : "—"} />
      </div>
      <p className="mt-3 text-sm text-[#4d6a72]">
        Seuil de rentabilité {formatTnd(be)} · Minimum acceptable {formatTnd(minPx)} · Unités nécessaires pour {formatTnd(targetProfit)} :{" "}
        {units == null ? "impossible à perte" : `${units} unités`}
      </p>
      {price < minPx ? (
        <p className="mt-2 text-sm text-[#c53d3d]">Ce prix est inférieur à votre prix de vente minimum acceptable et ne respecte pas votre politique de marge.</p>
      ) : null}
    </Card>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-[#f4f8f9] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[#6b858c]">{k}</p>
      <p className="mt-1 font-semibold tabular-nums">{v}</p>
    </div>
  );
}

export function SaveStrategyForm({
  productId,
  strategies,
  initial = "competitive",
}: {
  productId: string;
  initial?: "competitive" | "balanced" | "premium";
  strategies: Array<{ key: "competitive" | "balanced" | "premium"; price: number; profit: number; margin: number; flagged: boolean }>;
}) {
  const [strategy, setStrategy] = useState<"competitive" | "balanced" | "premium">(initial);
  const selected = strategies.find((s) => s.key === strategy) ?? strategies[0];
  return (
    <form action={saveRecommendationAction} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="recommendedPrice" value={selected?.price ?? 0} />
      <div className="grid gap-2 sm:grid-cols-3">
        {strategies.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStrategy(s.key)}
            className={`rounded-xl border p-3 text-left ${strategy === s.key ? "border-[#d4a017] bg-[#fff8e6]" : "border-[#d7e3e6] bg-white"}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6b858c]">{fr(s.key)}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{formatTnd(s.price)}</p>
            <p className="text-xs text-[#4d6a72]">
              {formatTnd(s.profit)} · {formatPctPoints(s.margin)}
            </p>
            {s.flagged ? <Badge tone="bad">Sous la politique</Badge> : null}
          </button>
        ))}
      </div>
      <input type="hidden" name="strategy" value={strategy} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="applyTarget" defaultChecked /> Enregistrer comme prix de vente cible (rien n’est publié en ligne)
      </label>
      <Button type="submit">Enregistrer la stratégie</Button>
    </form>
  );
}

export function ImportForm() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      action={async (fd) => {
        const res = await importProductsAction(fd);
        if (res && "error" in res && res.error) setMsg(res.error);
        else if (res && "count" in res)
          setMsg(
            `${res.count} nouveaux produits, ${res.updated ?? 0} produits existants mis à jour (même référence) — la recherche chez les concurrents démarre automatiquement.`,
          );
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <Field label="Fichier CSV ou Excel">
        <Input name="file" type="file" accept=".csv,.xlsx,.xls" required />
      </Field>
      <Button type="submit">Importer</Button>
      {msg ? <p className="text-sm text-[#0b4a56]">{msg}</p> : null}
    </form>
  );
}

export function BulkBar({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <form action={bulkProductAction} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#d7e3e6] bg-white p-3">
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <span className="text-sm">{ids.length} sélectionné(s)</span>
      <Button name="op" value="monitor" size="sm">
        Activer le suivi
      </Button>
      <Button name="op" value="pause" size="sm" variant="secondary">
        Mettre en pause
      </Button>
      <Button name="op" value="archive" size="sm" variant="ghost">
        Archiver
      </Button>
    </form>
  );
}

export function ProductTableClient({
  rows,
}: {
  rows: Array<{
    id: string;
    name: string;
    brand: string | null;
    sku: string | null;
    category: string | null;
    selling: string;
    profit: string;
    margin: string;
    stock: number;
    status: string;
    monitoring: string;
    demo: boolean;
    competitiveness: string;
  }>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="space-y-3">
      <BulkBar ids={selected} />
      <div className="pp-table-wrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                  checked={selected.length === rows.length && rows.length > 0}
                />
              </th>
              <th>Produit</th>
              <th>SKU</th>
              <th>Prix de vente</th>
              <th>Bénéfice</th>
              <th>Marge</th>
              <th>Stock</th>
              <th>Position</th>
              <th>Suivi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                  />
                </td>
                <td>
                  <Link href={`/products/${r.id}`} className="font-medium text-[#0b4a56] hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-xs text-[#6b858c]">
                    {r.brand} · {r.category}
                    {r.demo ? (
                      <span className="ml-2">
                        <span className="demo-chip">Données démo</span>
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="tabular-nums">{r.sku ?? "—"}</td>
                <td className="tabular-nums">{r.selling}</td>
                <td className="tabular-nums">{r.profit}</td>
                <td className="tabular-nums">{r.margin}</td>
                <td>
                  {r.stock}{" "}
                  <Badge tone={r.status === "in_stock" ? "ok" : r.status === "low_stock" ? "warn" : "bad"}>{fr(r.status)}</Badge>
                </td>
                <td>{r.competitiveness}</td>
                <td>
                  <Badge tone={r.monitoring === "active" ? "teal" : "slate"}>{fr(r.monitoring)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OfferReview({ offerId, productId }: { offerId: string; productId: string }) {
  return (
    <form action={reviewMatchAction} className="flex flex-wrap gap-1">
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="productId" value={productId} />
      <Button name="decision" value="confirm" size="sm" variant="secondary">
        Confirmer
      </Button>
      <Button name="decision" value="reject" size="sm" variant="ghost">
        Rejeter
      </Button>
    </form>
  );
}

export function ManualOfferForm({ productId, competitors }: { productId: string; competitors: Array<{ id: string; name: string }> }) {
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) =>
        start(async () => {
          setMsg(null);
          const res = await addManualOfferAction(fd);
          if (res && "error" in res && res.error) setMsg({ text: res.error, error: true });
          else if (res && "ok" in res)
            setMsg({ text: res.live ? `Prix en direct récupéré : ${formatTnd(res.priceTnd)}. Il sera revérifié à chaque passage de la surveillance.` : "Offre ajoutée.", error: false });
        })
      }
      className="grid gap-3 md:grid-cols-4"
    >
      <input type="hidden" name="productId" value={productId} />
      <Field label="Concurrent">
        <Select name="competitorId" required>
          {competitors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="URL du produit (prix en direct)">
        <Input name="url" type="url" placeholder="https://www.mytek.tn/…html" />
      </Field>
      <Field label="Prix DT (si pas d'URL)">
        <Input name="priceTnd" type="number" step="0.001" placeholder="auto depuis l'URL" />
      </Field>
      <Field label="Disponibilité">
        <Select name="availability" defaultValue="in_stock">
          <option value="in_stock">En stock</option>
          <option value="limited">Stock limité</option>
          <option value="out_of_stock">Rupture</option>
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Récupération du prix…" : "Ajouter l'offre"}
        </Button>
        {msg ? <p className={`text-sm ${msg.error ? "text-[#c53d3d]" : "text-[#0b4a56]"}`}>{msg.text}</p> : null}
      </div>
    </form>
  );
}

export function CheckNowButton({ competitorId }: { competitorId?: string }) {
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) => {
        start(async () => {
          await runCheckNowAction(fd);
        });
      }}
    >
      {competitorId ? <input type="hidden" name="competitorId" value={competitorId} /> : null}
      <Button type="submit" variant="gold" disabled={pending}>
        {pending ? "Vérification…" : "Vérifier maintenant"}
      </Button>
    </form>
  );
}

export function CompetitorForm({
  competitor,
}: {
  competitor?: { id: string; name: string; domain: string; websiteUrl: string; listingUrl: string | null; searchUrlTemplate: string | null; monitoringFrequencyMinutes: number; logoText: string | null };
}) {
  return (
    <form action={upsertCompetitorAction} className="grid gap-3 md:grid-cols-2">
      {competitor?.id ? <input type="hidden" name="id" value={competitor.id} /> : null}
      <Field label="Nom">
        <Input name="name" required defaultValue={competitor?.name ?? ""} />
      </Field>
      <Field label="Domaine">
        <Input name="domain" required defaultValue={competitor?.domain ?? ""} />
      </Field>
      <Field label="URL du site">
        <Input name="websiteUrl" required defaultValue={competitor?.websiteUrl ?? ""} />
      </Field>
      <Field label="URL du catalogue">
        <Input name="listingUrl" defaultValue={competitor?.listingUrl ?? ""} />
      </Field>
      <Field label="Modèle d'URL de recherche" hint="Utilisez {q} pour la recherche.">
        <Input name="searchUrlTemplate" defaultValue={competitor?.searchUrlTemplate ?? ""} />
      </Field>
      <Field label="Fréquence (minutes)">
        <Input name="monitoringFrequencyMinutes" type="number" defaultValue={competitor?.monitoringFrequencyMinutes ?? 360} />
      </Field>
      <div className="md:col-span-2">
        <Button type="submit">{competitor ? "Enregistrer le concurrent" : "Ajouter le concurrent"}</Button>
      </div>
    </form>
  );
}

export function DiscoveryButtons({ id }: { id: string }) {
  return (
    <form action={discoveryAction} className="flex flex-wrap gap-1">
      <input type="hidden" name="id" value={id} />
      <Button name="op" value="add" size="sm">
        Ajouter au catalogue
      </Button>
      <Button name="op" value="watch" size="sm" variant="secondary">
        À surveiller
      </Button>
      <Button name="op" value="ignore" size="sm" variant="ghost">
        Ignorer
      </Button>
    </form>
  );
}

export function SupplierForm() {
  return (
    <form action={upsertSupplierAction} className="grid gap-3 md:grid-cols-3">
      <Field label="Nom du fournisseur">
        <Input name="name" required />
      </Field>
      <Field label="Contact">
        <Input name="contactName" />
      </Field>
      <Field label="E-mail">
        <Input name="email" type="email" />
      </Field>
      <Field label="Téléphone">
        <Input name="phone" />
      </Field>
      <Field label="Ville">
        <Input name="city" />
      </Field>
      <div className="flex items-end">
        <Button type="submit">Ajouter le fournisseur</Button>
      </div>
    </form>
  );
}

export function QuoteForm({
  suppliers,
  products,
}: {
  suppliers: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
}) {
  return (
    <form action={addQuoteAction} className="grid gap-3 md:grid-cols-4">
      <Field label="Fournisseur">
        <Select name="supplierId" required>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Produit">
        <Select name="productId">
          <option value="">—</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Prix proposé (DT)">
        <Input name="quotedPrice" type="number" step="0.001" required />
      </Field>
      <Field label="Quantité minimale">
        <Input name="moq" type="number" defaultValue={1} />
      </Field>
      <Field label="Délai (jours)">
        <Input name="leadTimeDays" type="number" defaultValue={3} />
      </Field>
      <Field label="Transport">
        <Input name="shippingCost" type="number" step="0.001" defaultValue={0} />
      </Field>
      <Field label="Valable jusqu'au">
        <Input name="expiresAt" type="date" />
      </Field>
      <div className="flex items-end">
        <Button type="submit">Ajouter le devis</Button>
      </div>
    </form>
  );
}

export function MovementForm({ products }: { products: Array<{ id: string; name: string }> }) {
  return (
    <form action={addMovementAction} className="grid gap-3 md:grid-cols-5">
      <Field label="Produit">
        <Select name="productId" required>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Type">
        <Select name="type" defaultValue="purchase">
          <option value="purchase">Achat</option>
          <option value="replenishment">Réapprovisionnement</option>
          <option value="sale">Vente</option>
          <option value="return">Retour</option>
          <option value="adjustment">Ajustement</option>
        </Select>
      </Field>
      <Field label="Quantité">
        <Input name="quantity" type="number" required defaultValue={1} />
      </Field>
      <Field label="Prix / coût unitaire">
        <Input name="unitPrice" type="number" step="0.001" />
      </Field>
      <div className="flex items-end">
        <Button type="submit">Enregistrer</Button>
      </div>
    </form>
  );
}

export function InviteForm() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      action={async (fd) => {
        const res = await inviteStaffAction(fd);
        setMsg(res && "error" in res && res.error ? res.error : "Membre ajouté. Communiquez-lui le mot de passe que vous avez défini.");
      }}
      className="grid gap-3 md:grid-cols-4"
    >
      <Field label="Nom">
        <Input name="fullName" required />
      </Field>
      <Field label="E-mail">
        <Input name="email" type="email" required />
      </Field>
      <Field label="Rôle">
        <Select name="role" defaultValue="staff">
          <option value="staff">Collaborateur</option>
          <option value="administrator">Administrateur</option>
        </Select>
      </Field>
      <Field label="Mot de passe provisoire" hint="Au moins 8 caractères.">
        <Input name="password" required minLength={8} />
      </Field>
      <div className="md:col-span-4 flex items-center gap-3">
        <Button type="submit">Ajouter le membre</Button>
        {msg ? <p className="text-sm text-[#4d6a72]">{msg}</p> : null}
      </div>
    </form>
  );
}

export function AssistantChat() {
  const [q, setQ] = useState("Quels produits dois-je repositionner aujourd'hui ?");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [pending, setPending] = useState(false);
  async function send(text: string) {
    setPending(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
    const data = (await res.json()) as { answer?: string; error?: string };
    setMessages((m) => [...m, { role: "assistant", content: data.answer ?? data.error ?? "Impossible de répondre." }]);
    setPending(false);
  }
  const suggestions = [
    "Quels produits dois-je repositionner aujourd'hui ?",
    "Quels produits sont sous ma marge minimale ?",
    "Montre-moi les produits dont le concurrent le moins cher est en rupture.",
    "Quels nouveaux produits sont pertinents pour mon catalogue ?",
    "Que se passerait-il si je baissais le prix de 5 % ?",
    "Quels produits ont le plus fort potentiel de marge ?",
    "Résume les plus grands changements du marché cette semaine.",
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card className="flex min-h-[480px] flex-col">
        <div className="flex-1 space-y-3 overflow-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-[#4d6a72]">
              Posez des questions concrètes sur <strong>votre catalogue et les prix relevés chez les concurrents</strong>. L’assistant cite les dates des relevés et n’invente jamais de prix.
            </p>
          ) : null}
          {messages.map((m, i) => (
            <div key={i} className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-12 bg-[#0b4a56] text-white" : "mr-8 bg-[#f4f8f9] text-[#071c22]"}`}>
              {m.content}
            </div>
          ))}
          {pending ? <p className="text-sm text-[#6b858c]">Consultation des données…</p> : null}
        </div>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim() || pending) return;
            const text = q;
            setQ("");
            void send(text);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Posez une question sur votre catalogue…" />
          <Button type="submit" disabled={pending}>
            Demander
          </Button>
        </form>
      </Card>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#6b858c]">Exemples de questions</p>
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="block w-full rounded-xl border border-[#d7e3e6] bg-white px-3 py-2 text-left text-sm hover:border-[#0b4a56]"
            onClick={() => void send(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PurchaseCalculator({
  quotes,
}: {
  quotes: Array<{ id: string; name: string; quoted: number; shipping: number; market: number | null; selling: number; tax: TaxAssumptions; minMargin: number }>;
}) {
  const [id, setId] = useState(quotes[0]?.id ?? "");
  const [qty, setQty] = useState(5);
  const q = quotes.find((x) => x.id === id) ?? quotes[0];
  if (!q) return <p className="text-sm text-[#6b858c]">Ajoutez un devis fournisseur pour utiliser le calculateur d’achat.</p>;
  const unitCost = q.quoted + q.shipping;
  const investment = unitCost * qty;
  const analysis = analyzePrice(q.selling, { purchasePrice: q.quoted, shippingCost: q.shipping, importCost: 0, otherCosts: 0 }, q.tax);
  const beUnits = analysis.grossProfit > 0 ? Math.ceil(investment / (analysis.grossProfit + unitCost) ) : null;
  return (
    <Card>
      <h3 className="font-semibold">Calculateur de décision d’achat</h3>
      <p className="mt-1 text-sm text-[#4d6a72]">Estimez l’investissement et le bénéfice attendu avant de réapprovisionner, à partir des devis et prix de vente enregistrés.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Field label="Devis">
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            {quotes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantité">
          <Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </Field>
        <div className="rounded-xl bg-[#f4f8f9] p-3">
          <p className="text-[11px] uppercase text-[#6b858c]">Investissement nécessaire</p>
          <p className="text-lg font-semibold">{formatTnd(investment)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Mini k="Bénéfice attendu / unité" v={formatTnd(analysis.grossProfit)} />
        <Mini k="Bénéfice du lot (est.)" v={formatTnd(analysis.grossProfit * qty)} />
        <Mini k="Écart vs marché" v={q.market != null ? formatTnd(q.market - q.selling) : "n/d"} />
      </div>
      <p className="mt-3 text-sm text-[#4d6a72]">
        Quantité d’équilibre au prix de vente actuel : {beUnits == null ? "inatteignable (bénéfice unitaire négatif)" : `${beUnits} unités (estimation)`}.
      </p>
    </Card>
  );
}

export { round3, n };

type RefCandidate = Extract<Awaited<ReturnType<typeof findOnCompetitorsAction>>, { candidates: unknown }>["candidates"][number];

export function ReferenceSearch({ productId, defaultReference }: { productId: string; defaultReference: string }) {
  const [reference, setReference] = useState(defaultReference);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RefCandidate[] | null>(null);
  const [tracking, setTracking] = useState<Record<string, "busy" | "done" | string>>({});

  const search = () =>
    start(async () => {
      setError(null);
      setResults(null);
      const res = await findOnCompetitorsAction(productId, reference);
      if ("error" in res) setError(res.error);
      else setResults(res.candidates);
    });

  const track = async (c: RefCandidate) => {
    setTracking((t) => ({ ...t, [c.url]: "busy" }));
    const fd = new FormData();
    fd.set("productId", productId);
    fd.set("competitorId", c.competitorId);
    fd.set("url", c.url);
    const res = await addManualOfferAction(fd);
    setTracking((t) => ({ ...t, [c.url]: res && "error" in res && res.error ? res.error : "done" }));
  };

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <Field label="Référence, modèle ou nom">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex. C11CJ67409, F.401B, MF272dw" className="min-w-64" />
        </Field>
        <Button type="submit" size="sm" disabled={pending || reference.trim().length < 2}>
          {pending ? "Recherche en cours…" : "Chercher chez les concurrents"}
        </Button>
      </form>
      {pending ? <p className="text-xs text-[#4d6a72]">Recherche dans les catalogues des concurrents et vérification des pages produits en direct (la première recherche indexe chaque catalogue, ~10–30 s).</p> : null}
      {error ? <p className="text-sm text-[#c53d3d]">{error}</p> : null}
      {results && !results.length ? <p className="text-sm text-[#4d6a72]">Aucune offre trouvée pour « {reference} ». Essayez le nom du modèle, une référence plus courte, ou collez une URL ci-dessous.</p> : null}
      {results && results.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[#4d6a72]">
              <tr>
                <th className="py-2 pr-3">Concurrent</th>
                <th className="py-2 pr-3">Offre</th>
                <th className="py-2 pr-3 text-right">Prix</th>
                <th className="py-2 pr-3">Correspondance</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {results.map((c) => {
                const state = tracking[c.url];
                return (
                  <tr key={c.url} className="border-t border-[#e3ecee] align-top">
                    <td className="py-2 pr-3 font-medium">{c.competitorName}</td>
                    <td className="py-2 pr-3">
                      <a href={c.url} target="_blank" rel="noreferrer" className="text-[#1b6f9a] underline">
                        {c.title}
                      </a>
                      <div className="text-xs text-[#4d6a72]">{c.reason}</div>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {c.priceTnd != null ? formatTnd(c.priceTnd) : "—"}
                      <div className="text-xs text-[#4d6a72]">{fr(c.availability)}</div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <Badge tone={c.referenceOnPage && (c.matchClass === "exact" || c.matchClass === "strong") ? "ok" : c.referenceOnPage ? "info" : "warn"}>
                        {c.referenceOnPage ? "réf. trouvée" : "titre seul"} · {c.confidence} %
                      </Badge>
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {c.alreadyTracked || state === "done" ? (
                        <Badge tone="teal">Suivi</Badge>
                      ) : c.priceTnd == null ? null : (
                        <Button size="sm" variant={c.referenceOnPage ? "primary" : "secondary"} disabled={state === "busy"} onClick={() => track(c)}>
                          {state === "busy" ? "Ajout…" : "Suivre"}
                        </Button>
                      )}
                      {state && state !== "busy" && state !== "done" ? <div className="text-xs text-[#c53d3d]">{state}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function CatalogTools() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("Réindexation des catalogues concurrents…");
            const res = await refreshCatalogsAction();
            setMsg(`Indexé : ${res.sizes.map((s) => `${s.name} ${s.size.toLocaleString("fr-FR")}`).join(" · ")}`);
          })
        }
      >
        Actualiser les catalogues
      </Button>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await autoMatchProductsAction();
            setMsg(`${res.queued} produits en file d'attente — ils sont recherchés automatiquement par référence, un par un, et les correspondances sûres sont suivies.`);
          })
        }
      >
        Relancer la recherche de tous les produits
      </Button>
      {msg ? <p className="text-sm text-[#0b4a56]">{msg}</p> : null}
    </div>
  );
}

/**
 * Wide/long tables in their own scroll box: sticky header (and first column with `pp-sticky-col`),
 * ◀ ▶ buttons, edge shadows when more columns are hidden, and a full-screen mode.
 */
export function ScrollPanel({ children, maxHeight = "65vh", toolbar }: { children: ReactNode; maxHeight?: string; toolbar?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [full, setFull] = useState(false);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [update, full]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [full]);
  const step = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.6), behavior: "smooth" });
  };
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-[#d7e3e6] bg-white px-2 text-sm text-[#0b4a56] hover:bg-[#eef6f7] disabled:opacity-35";
  return (
    <div className={full ? "fixed inset-0 z-50 flex flex-col bg-[#f3f7f8] p-3" : ""}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <span className="hidden text-[11px] text-[#6b858c] lg:inline">Maj + molette pour défiler à l’horizontale</span>
        <button type="button" className={btn} onClick={() => step(-1)} disabled={!edges.left} aria-label="Colonnes précédentes">
          ◀
        </button>
        <button type="button" className={btn} onClick={() => step(1)} disabled={!edges.right} aria-label="Colonnes suivantes">
          ▶
        </button>
        <button type="button" className={btn} onClick={() => setFull((f) => !f)}>
          {full ? "Fermer ✕" : "Agrandir ⤢"}
        </button>
      </div>
      <div className={`relative ${full ? "min-h-0 flex-1" : ""}`}>
        <div
          ref={ref}
          onScroll={update}
          tabIndex={0}
          className="pp-table-wrap pp-scroll outline-none focus-visible:ring-2 focus-visible:ring-[#0b4a56]/30"
          style={{ maxHeight: full ? "100%" : maxHeight, height: full ? "100%" : undefined }}
        >
          {children}
        </div>
        {edges.right ? <div className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-2xl bg-gradient-to-l from-[#0b4a56]/15 to-transparent" /> : null}
      </div>
    </div>
  );
}

/** Table row with a "Comparer" toggle that opens a full-width detail row underneath (Primini-style offer list). */
export function ExpandableRow({
  first,
  rest,
  detail,
  colSpan,
  count,
  className,
}: {
  first: ReactNode;
  rest: ReactNode;
  detail: ReactNode;
  colSpan: number;
  count: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={`${className ?? ""} ${open ? "bg-[#f3f8f9]" : ""}`}>
        <td className="max-w-[240px]">
          {first}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-[#d7e3e6] bg-white px-1.5 py-px text-[10px] font-medium text-[#0b4a56] hover:bg-[#eef6f7]"
            aria-expanded={open}
          >
            {open ? "▾ Fermer" : `▸ Comparer${count ? ` (${count})` : ""}`}
          </button>
        </td>
        {rest}
      </tr>
      {open ? (
        <tr>
          <td colSpan={colSpan} className="bg-[#f3f8f9] !p-0">
            <div className="sticky left-0 w-[min(880px,92vw)] p-3">{detail}</div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

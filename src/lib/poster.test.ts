import assert from "node:assert/strict";
import { applyEvent, checkPoster, defaultDesign, normalizeDesign, posterFileName, scoreProduct, type PosterProduct } from "./poster";
import { defaultSceneQuery, eventById, upcomingEvents } from "./events";

const now = new Date().toISOString();
const product = (over: Partial<PosterProduct> = {}): PosterProduct => ({
  id: crypto.randomUUID(),
  name: "Fer à vapeur KIWI KSI 6319C",
  ref: "KSI 6319C",
  category: "Petit electromenager",
  stockQty: 5,
  ownStatus: "found",
  ownUrl: "https://www.numedia.tn/produit/fer-kiwi",
  ownPrice: 119,
  ownCheckedAt: now,
  costTtc: 80,
  minMargin: 0.03,
  hasPhoto: true,
  competitors: [],
  ...over,
});

// Single product: default price is the numedia.tn price, so no crossed-out price.
{
  const p = product();
  const d = defaultDesign([p], { brand: "numedia", lang: "fr", website: "https://www.numedia.tn" });
  assert.equal(d.title, "FER À VAPEUR", "headline is the kind of product");
  assert.equal(d.footer, "www.numedia.tn");
  const c = checkPoster(d, [p]);
  assert.deepEqual(c.errors, []);
  assert.equal(c.pricing.price, 119);
  assert.equal(c.pricing.oldPrice, null, "no discount when the price equals numedia.tn");
}

// Promo below numedia.tn: crossed-out price is the verified numedia.tn price, discount computed from it.
{
  const p = product();
  const d = { ...defaultDesign([p], { brand: "numedia", lang: "fr" }), promoPrice: 89, showDiscount: true };
  const c = checkPoster(d, [p]);
  assert.deepEqual(c.errors, []);
  assert.equal(c.pricing.oldPrice, 119);
  assert.equal(c.pricing.discountPct, 25);
}

// Never invent an old price: a numedia.tn listing still "to confirm" gives no crossed-out price.
{
  const p = product({ ownStatus: "review", hasPhoto: false }); // as loadPosterProducts sets it
  const d = { ...defaultDesign([p], { brand: "numedia", lang: "fr" }), promoPrice: 89 };
  const c = checkPoster(d, [p]);
  assert.equal(c.pricing.oldPrice, null);
  assert.ok(c.errors.some((e) => e.includes("photo officielle")), "unconfirmed listing has no official photo");
}

// Margin floor: (price − cost TTC) / price ≥ 3 %.
{
  const p = product({ costTtc: 100 });
  const d = { ...defaultDesign([p], { brand: "numedia", lang: "fr" }), promoPrice: 102 };
  const c = checkPoster(d, [p]);
  assert.ok(c.errors.some((e) => e.includes("plancher")), "102 DT < 103.093 DT floor");
  const ok = checkPoster({ ...d, promoPrice: 103.1 }, [p]);
  assert.ok(!ok.errors.some((e) => e.includes("plancher")));
}

// Out of stock cannot be promoted.
{
  const p = product({ stockQty: 0 });
  const c = checkPoster(defaultDesign([p], { brand: "numedia", lang: "fr" }), [p]);
  assert.ok(c.errors.some((e) => e.includes("rupture")));
}

// Pack: the user sets the pack price (never summed automatically); old price = sum of verified prices.
{
  const a = product({ ownPrice: 100, costTtc: 60 });
  const b = product({ name: "Balance électronique Suprema SMALL", ownPrice: 120, costTtc: 70 });
  const d = defaultDesign([a, b], { brand: "numedia", lang: "bi" });
  assert.equal(d.promoPrice, null);
  assert.equal(d.title, "PACK");
  assert.ok(checkPoster(d, [a, b]).errors.some((e) => e.includes("prix du pack")));
  const c = checkPoster({ ...d, promoPrice: 199 }, [a, b]);
  assert.deepEqual(c.errors, []);
  assert.equal(c.pricing.oldPrice, 220);
  assert.ok(checkPoster({ ...d, promoPrice: 130 }, [a, b]).errors.some((e) => e.includes("plancher")), "floor on total cost 130/0.97");
}

// Missing cost: warning, not a guess.
{
  const p = product({ costTtc: 0 });
  const c = checkPoster(defaultDesign([p], { brand: "numedia", lang: "fr" }), [p]);
  assert.equal(c.pricing.floor, null);
  assert.ok(c.warnings.some((w) => w.includes("Coût d'achat manquant")));
}

// Score: only confirmed references are compared; cheaper than the competition scores higher.
{
  const cheap = product({ competitors: [{ name: "Mytek", price: 130, availability: "in_stock", url: null, checkedAt: now, matchClass: "exact" }] });
  const dear = product({ competitors: [{ name: "Mytek", price: 99, availability: "in_stock", url: null, checkedAt: now, matchClass: "exact" }] });
  const unsure = product({ competitors: [{ name: "Mytek", price: 50, availability: "in_stock", url: null, checkedAt: now, matchClass: "possible" }] });
  assert.ok(scoreProduct(cheap).score > scoreProduct(dear).score);
  assert.equal(scoreProduct(unsure).cheapest, null, "a 'possible' match is not compared");
  assert.ok(scoreProduct(unsure).flags.includes("Correspondance concurrente à vérifier"));
}

// Old saved designs are completed; unknown colours fall back to the brand colour.
{
  const p = product();
  const d = normalizeDesign({ title: "X", accent: "#00ff00" } as never, [p]);
  assert.equal(d.accent, "#e30613");
  assert.deepEqual(d.productOrder, [p.id]);
}

assert.equal(posterFileName("Pack Rentrée 2026 !"), "pack-rentree-2026-1080x1080.png");

// Tunisian calendar.
{
  const from = new Date(Date.UTC(2026, 9, 16));
  const at = (id: string) => eventById(id)!.next(from)!.date.toISOString().slice(0, 10);
  assert.equal(at("black-friday"), "2026-11-27", "day after the 4th Thursday of November");
  assert.equal(at("nouvel-an"), "2027-01-01");
  assert.equal(at("fete-meres"), "2027-05-30", "last Sunday of May (Tunisia)");
  assert.equal(at("fete-femme"), "2027-08-13");
  assert.equal(eventById("ramadan")!.next(from)!.approx, true, "lunar dates are estimates");
  assert.equal(upcomingEvents(from)[0].event.id, "black-friday", "nearest event first");
  assert.equal(defaultSceneQuery([{ name: "Micro-ondes Brandt 20L", category: "Petit electromenager" }]), "kitchen");
  assert.equal(defaultSceneQuery([{ name: "Imprimante HP Smart Tank 670", category: null }]), "office desk");
}

// Event applied: headline, tag and end date from the calendar; product name kept as subtitle.
{
  const p = product();
  const d = applyEvent(defaultDesign([p], { brand: "numedia", lang: "fr" }), "nouvel-an", [p], new Date(Date.UTC(2026, 9, 16)));
  assert.equal(d.title, "BONNE ANNÉE 2027");
  assert.equal(d.titleAr, "بونانة 2027");
  assert.equal(d.subtitle, p.name);
  assert.equal(d.validUntil, "2027-01-01");
  assert.equal(applyEvent(d, "", [p]).title, "FER À VAPEUR", "removing the event restores the product headline");
  const sales = applyEvent(d, "soldes-ete", [p], new Date(Date.UTC(2026, 9, 16)));
  assert.equal(sales.validUntil, "2027-09-18", "summer sales run six weeks from 7 August");
}

// Soldes: at least 20 % off a verified crossed-out price.
{
  const p = product({ ownPrice: 100, costTtc: 50 });
  const d = { ...applyEvent(defaultDesign([p], { brand: "numedia", lang: "fr" }), "soldes-ete", [p]), promoPrice: 85 };
  assert.ok(checkPoster(d, [p]).errors.some((e) => e.includes("20 %")), "15 % is below the legal minimum");
  assert.ok(!checkPoster({ ...d, promoPrice: 80 }, [p]).errors.some((e) => e.includes("Soldes")), "20 % is accepted");
  const unverified = product({ ownStatus: "review", ownPrice: 100, costTtc: 50 });
  assert.ok(checkPoster({ ...d, promoPrice: 70 }, [unverified]).errors.some((e) => e.includes("prix barré vérifié")));
}

// Realistic scene style needs a photo.
{
  const p = product();
  const d = { ...defaultDesign([p], { brand: "numedia", lang: "fr" }), theme: "scene" as const };
  assert.ok(checkPoster(d, [p]).errors.some((e) => e.includes("scène")));
}

console.log("poster tests passed");

// AI scene prompt: only the ambiance, event mood and safe details — never prices; always an empty foreground.
{
  const { buildScenePrompt, autoAmbiance } = await import("./ai-scenes");
  const p = buildScenePrompt({ ambianceId: "auto", sceneQuery: "kitchen", eventId: "ramadan", details: "cream colours <script>" });
  assert.ok(p.includes("marble countertop") && p.includes("Ramadan lanterns") && p.includes("empty surface"));
  assert.ok(!p.includes("<") && !/\d+\s*DT/.test(p), "details are sanitised and carry no price");
  assert.equal(autoAmbiance("office desk"), "office");
  console.log("ai scene prompt tests passed");
}

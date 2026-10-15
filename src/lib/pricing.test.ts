import assert from "node:assert/strict";
import { analyzePrice, breakEvenTtc, minAcceptableTtc, recommendPrice } from "./pricing";
import { matchListing } from "./matching";

const tax = {
  vatRate: 0.19,
  purchasePricesIncludeVat: false,
  sellingPricesIncludeVat: true,
  variableSellingCostRate: 0.015,
};
const cost = { purchasePrice: 100, shippingCost: 10, importCost: 0, otherCosts: 0, exchangeRate: 1 };

const be = breakEvenTtc(cost, tax);
const analysis = analyzePrice(be, cost, tax);
assert.ok(Math.abs(analysis.grossProfit) < 0.05, "break-even should be near zero profit");

const minTtc = minAcceptableTtc(cost, tax, 0.12);
const minA = analyzePrice(minTtc, cost, tax);
assert.ok(minA.grossMargin + 0.005 >= 0.12, "min acceptable respects margin floor");

const rec = recommendPrice({
  cost,
  tax,
  minMargin: 0.12,
  currentSellingTtc: 200,
  offers: [
    { priceTnd: 80, availability: "in_stock", matchClass: "exact", excludedFromBenchmark: false, condition: "new" },
  ],
  strategy: "competitive",
});
assert.equal(rec.policyViolation, true, "must not recommend below min without flag");
assert.ok(rec.recommendedTtc >= minTtc - 0.01);

const exact = matchListing({
  productName: "ASUS TUF A15",
  brand: "ASUS",
  manufacturerRef: "FA507NV-LP023",
  barcode: "4711387582019",
  listingTitle: "ASUS TUF",
  listingRef: "FA507NV LP023",
  listingBarcode: "4711387582019",
});
assert.equal(exact.matchClass, "exact");

const unverified = matchListing({
  productName: "ASUS TUF A15",
  brand: "ASUS",
  listingTitle: "Laptop gamer 15 pouces reconditionné pack",
  listingCondition: "refurbished",
});
assert.equal(unverified.excluded, true);

// Competitive: 1 DT under the cheapest in-stock shop; out-of-stock offers are ignored.
const noVarTax = { ...tax, variableSellingCostRate: 0 };
const under = recommendPrice({
  cost,
  tax: noVarTax,
  minMargin: 0.03,
  currentSellingTtc: 200,
  offers: [
    { priceTnd: 150, availability: "out_of_stock", matchClass: "exact", excludedFromBenchmark: false, condition: "new" },
    { priceTnd: 180, availability: "in_stock", matchClass: "exact", excludedFromBenchmark: false, condition: "new" },
    { priceTnd: 190, availability: "in_stock", matchClass: "strong", excludedFromBenchmark: false, condition: "new" },
  ],
  strategy: "competitive",
});
assert.equal(under.recommendedTtc, 179, "competitive = cheapest in-stock − 1 DT");
assert.equal(under.policyViolation, false);
// 3 % floor: cost 110 HT → 130.9 TTC; 130.9 / 0.97 ≈ 134.948
const floor = minAcceptableTtc(cost, noVarTax, 0.03);
assert.ok(Math.abs(floor - 134.948) < 0.01, `3 % floor, got ${floor}`);
const tight = recommendPrice({
  cost,
  tax: noVarTax,
  minMargin: 0.03,
  currentSellingTtc: 200,
  offers: [{ priceTnd: 135, availability: "in_stock", matchClass: "exact", excludedFromBenchmark: false, condition: "new" }],
  strategy: "competitive",
});
assert.ok(tight.recommendedTtc >= floor - 0.001 && tight.policyViolation, "cannot go 1 DT under while keeping 3 %");

console.log("pricing and matching tests passed");

// Stock import rules (ERP export): discount, 100 % discount, negative stock, references.
const { stockRowFacts, cleanReference } = await import("./csv");
const lot = stockRowFacts({ purchasePrice: "470", discountPct: "5", stockQty: "18", manufacturerRef: "T650A11E", refReliability: "Présente dans la désignation" });
assert.equal(lot.purchase, 446.5);
assert.ok(lot.note?.includes("remise 5 %"));
const promo = stockRowFacts({ purchasePrice: "1200", discountPct: "100", stockQty: "-18" });
assert.equal(promo.purchase, 1200, "100 % discount is ignored");
assert.equal(promo.stockQty, 0, "negative stock counts as 0");
assert.ok(promo.tags.includes("Stock négatif ERP (-18)") && promo.tags.includes("Remise 100 % ignorée"));
assert.deepEqual(cleanReference("Toner e-STUDIO 2309A: T-2309E", "Probable – à vérifier"), { ref: "T-2309E", alt: null });
assert.deepEqual(cleanReference("TK-475 (1T02K30NL0)"), { ref: "TK-475", alt: "1T02K30NL0" });
assert.deepEqual(cleanReference("x", "Article générique – pas de réf. fabricant"), { ref: null, alt: null });
console.log("stock import tests passed");
const noise = stockRowFacts({ purchasePrice: "36", discountPct: "0.0004" });
assert.equal(noise.purchase, 36);
assert.equal(noise.note, null);
console.log("discount rounding test passed");

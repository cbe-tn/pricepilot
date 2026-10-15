import { average, formatTnd, median, n, percentile, round3 } from "./money";
import type { MatchClass } from "./matching";

export type TaxAssumptions = {
  vatRate: number;
  purchasePricesIncludeVat: boolean;
  sellingPricesIncludeVat: boolean;
  variableSellingCostRate: number;
};

export type CostInput = {
  purchasePrice: number;
  shippingCost: number;
  importCost: number;
  otherCosts: number;
  exchangeRate?: number;
};

export type OfferSnapshot = {
  priceTnd: number;
  availability: string;
  matchClass: MatchClass;
  excludedFromBenchmark: boolean;
  condition: string;
  competitorName?: string;
};

export type PricingStrategy = "competitive" | "balanced" | "premium";

export type PriceBreakdown = {
  grossPurchase: number;
  netPurchase: number;
  landedExtra: number;
  totalAcquisitionCost: number;
  sellingTtc: number;
  netSellingRevenue: number;
  variableSellingCosts: number;
  grossProfit: number;
  grossMargin: number;
  vatOnSale: number;
  assumptions: string[];
  incomplete: boolean;
};

export type Recommendation = {
  strategy: PricingStrategy;
  recommendedTtc: number;
  breakdown: PriceBreakdown;
  flaggedLoss: boolean;
  policyViolation: boolean;
  confidence: number;
  explanation: string;
  market: MarketStats;
  minAcceptableTtc: number;
  breakEvenTtc: number;
  vsCheapest: number | null;
};

export type MarketStats = {
  comparableCount: number;
  lowest: number | null;
  median: number | null;
  average: number | null;
  highest: number | null;
  inStockCount: number;
  /** Cheapest comparable offer not marked out of stock (same rule as the benchmark matrix). */
  lowestInStock: number | null;
};

/** Undercut step of the competitive strategy: beat the cheapest shop by this many dinars. */
export const UNDERCUT_TND = 1;

export function netFromGross(gross: number, vatRate: number): number {
  return round3(gross / (1 + vatRate));
}

export function grossFromNet(net: number, vatRate: number): number {
  return round3(net * (1 + vatRate));
}

export function totalAcquisitionCost(cost: CostInput, tax: TaxAssumptions): { total: number; netPurchase: number; extras: number } {
  const rate = cost.exchangeRate && cost.exchangeRate > 0 ? cost.exchangeRate : 1;
  const purchaseTnd = n(cost.purchasePrice) * rate;
  const extras = n(cost.shippingCost) + n(cost.importCost) + n(cost.otherCosts);
  const netPurchase = tax.purchasePricesIncludeVat ? netFromGross(purchaseTnd, tax.vatRate) : purchaseTnd;
  return { total: round3(netPurchase + extras), netPurchase: round3(netPurchase), extras: round3(extras) };
}

export function analyzePrice(sellingTtc: number, cost: CostInput, tax: TaxAssumptions): PriceBreakdown {
  const assumptions: string[] = [];
  const incomplete = n(cost.purchasePrice) <= 0;
  if (incomplete) assumptions.push("Coût d'achat manquant — le bénéfice est une estimation incomplète.");
  if (tax.purchasePricesIncludeVat) assumptions.push("Les prix d'achat sont considérés TTC ; la TVA récupérable est retirée du coût.");
  else assumptions.push("Les prix d'achat sont considérés hors TVA récupérable (HT).");
  if (tax.sellingPricesIncludeVat) assumptions.push("Les prix de vente sont considérés TTC (TVA comprise).");
  else assumptions.push("Les prix de vente sont considérés HT (hors TVA).");
  assumptions.push(`Taux de TVA ${(tax.vatRate * 100).toFixed(1).replace(".", ",")} %. Coûts de vente variables : ${(tax.variableSellingCostRate * 100).toFixed(1).replace(".", ",")} % du chiffre d'affaires net.`);

  const acq = totalAcquisitionCost(cost, tax);
  const sellingTtcSafe = n(sellingTtc);
  const netSellingRevenue = tax.sellingPricesIncludeVat ? netFromGross(sellingTtcSafe, tax.vatRate) : sellingTtcSafe;
  const vatOnSale = round3(sellingTtcSafe - (tax.sellingPricesIncludeVat ? netSellingRevenue : grossFromNet(netSellingRevenue, tax.vatRate) - netSellingRevenue));
  const variableSellingCosts = round3(netSellingRevenue * tax.variableSellingCostRate);
  const grossProfit = round3(netSellingRevenue - acq.total - variableSellingCosts);
  const grossMargin = netSellingRevenue > 0 ? round4(grossProfit / netSellingRevenue) : 0;

  return {
    grossPurchase: round3(n(cost.purchasePrice) * (cost.exchangeRate && cost.exchangeRate > 0 ? cost.exchangeRate : 1)),
    netPurchase: acq.netPurchase,
    landedExtra: acq.extras,
    totalAcquisitionCost: acq.total,
    sellingTtc: round3(sellingTtcSafe),
    netSellingRevenue: round3(netSellingRevenue),
    variableSellingCosts,
    grossProfit,
    grossMargin,
    vatOnSale: tax.sellingPricesIncludeVat ? round3(sellingTtcSafe - netSellingRevenue) : round3(grossFromNet(netSellingRevenue, tax.vatRate) - netSellingRevenue),
    assumptions,
    incomplete,
  };
}

function round4(v: number): number {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

export function breakEvenTtc(cost: CostInput, tax: TaxAssumptions): number {
  const acq = totalAcquisitionCost(cost, tax).total;
  const denom = 1 - tax.variableSellingCostRate;
  const net = denom > 0 ? acq / denom : acq;
  return tax.sellingPricesIncludeVat ? grossFromNet(net, tax.vatRate) : round3(net);
}

export function minAcceptableTtc(cost: CostInput, tax: TaxAssumptions, minMargin: number): number {
  const acq = totalAcquisitionCost(cost, tax).total;
  const denom = 1 - tax.variableSellingCostRate - minMargin;
  const net = denom > 0 ? acq / Math.max(denom, 0.05) : acq * 1.2;
  return tax.sellingPricesIncludeVat ? grossFromNet(net, tax.vatRate) : round3(net);
}

export function marketStats(offers: OfferSnapshot[]): MarketStats {
  const comparable = offers.filter(
    (o) =>
      !o.excludedFromBenchmark &&
      (o.matchClass === "exact" || o.matchClass === "strong") &&
      o.condition === "new" &&
      o.priceTnd > 0,
  );
  const prices = comparable.map((o) => o.priceTnd);
  const buyable = comparable.filter((o) => o.availability !== "out_of_stock").map((o) => o.priceTnd);
  return {
    comparableCount: comparable.length,
    lowest: prices.length ? Math.min(...prices) : null,
    median: prices.length ? median(prices) : null,
    average: prices.length ? average(prices) : null,
    highest: prices.length ? Math.max(...prices) : null,
    inStockCount: comparable.filter((o) => o.availability === "in_stock" || o.availability === "limited").length,
    lowestInStock: buyable.length ? Math.min(...buyable) : null,
  };
}

export function unitsToTargetProfit(perUnitProfit: number, targetProfit: number): number | null {
  if (perUnitProfit <= 0) return null;
  return Math.ceil(targetProfit / perUnitProfit);
}

export function recommendPrice(input: {
  cost: CostInput;
  tax: TaxAssumptions;
  minMargin: number;
  currentSellingTtc: number;
  targetSellingTtc?: number | null;
  offers: OfferSnapshot[];
  strategy: PricingStrategy;
  advantages?: { warranty?: boolean; inStockWhileOthersOut?: boolean; serviceNote?: boolean };
}): Recommendation {
  const market = marketStats(input.offers);
  const minTtc = minAcceptableTtc(input.cost, input.tax, input.minMargin);
  const beTtc = breakEvenTtc(input.cost, input.tax);
  const target = n(input.targetSellingTtc) || minTtc * 1.08;

  let raw = target;
  let explanation = "";
  let confidence = 62;

  if (input.strategy === "competitive") {
    // Undercut the cheapest shop that has it in stock (an out-of-stock offer is not a real competitor).
    const reference = market.lowestInStock ?? market.lowest;
    if (reference != null) {
      raw = round3(reference - UNDERCUT_TND);
      explanation = `La stratégie compétitive passe ${formatTnd(UNDERCUT_TND)} sous l'offre la moins chère${market.lowestInStock != null ? " en stock" : ""} (${formatTnd(reference)}), sans descendre sous la marge minimale.`;
      confidence = market.comparableCount >= 3 ? 84 : 70;
    } else {
      raw = target;
      explanation = "Pas encore d'offre concurrente comparable — utilisation de votre prix cible / minimum acceptable.";
      confidence = 40;
    }
  } else if (input.strategy === "balanced") {
    if (market.median != null) {
      raw = round3(market.median * 0.62 + target * 0.38);
      explanation = `La stratégie équilibrée combine le prix médian du marché (${formatTnd(market.median)}) et votre objectif de marge.`;
      confidence = market.comparableCount >= 3 ? 88 : 72;
    } else {
      raw = target;
      explanation = "Données de marché insuffisantes — votre prix de vente cible est recommandé.";
      confidence = 42;
    }
  } else {
    const p75 = percentile(
      input.offers
        .filter((o) => !o.excludedFromBenchmark && (o.matchClass === "exact" || o.matchClass === "strong"))
        .map((o) => o.priceTnd),
      75,
    );
    const lift = input.advantages?.warranty || input.advantages?.serviceNote || input.advantages?.inStockWhileOthersOut ? 1.045 : 1.02;
    if (market.median != null) {
      raw = round3(Math.max(market.median * lift, p75 || market.median));
      explanation = `La stratégie premium se place au-dessus de la médiane grâce à vos atouts (garantie, stock ou service) tout en restant dans la fourchette du marché.`;
      confidence = 76;
    } else {
      raw = round3(target * 1.06);
      explanation = "Stratégie premium sans comparable sur le marché — léger supplément sur votre prix cible.";
      confidence = 40;
    }
  }

  let flaggedLoss = false;
  let policyViolation = false;
  let recommended = round3(raw);

  if (recommended < minTtc) {
    recommended = round3(minTtc);
    flaggedLoss = true;
    policyViolation = true;
    explanation += ` Impossible de battre ce prix en restant rentable : le prix recommandé est relevé au minimum acceptable (${formatTnd(minTtc)}, marge minimale ${Math.round(input.minMargin * 1000) / 10} %).`;
    confidence = Math.min(confidence, 68);
  }

  const breakdown = analyzePrice(recommended, input.cost, input.tax);
  if (breakdown.grossProfit < 0) {
    flaggedLoss = true;
    explanation += " Ce prix donne encore un bénéfice brut négatif avec le coût de revient actuel.";
  }

  return {
    strategy: input.strategy,
    recommendedTtc: recommended,
    breakdown,
    flaggedLoss,
    policyViolation,
    confidence,
    explanation,
    market,
    minAcceptableTtc: round3(minTtc),
    breakEvenTtc: round3(beTtc),
    vsCheapest: market.lowest != null ? round3(recommended - market.lowest) : null,
  };
}

export function positionLabel(price: number, market: MarketStats): string {
  if (market.lowest == null || market.highest == null) return "Pas de marché";
  if (price <= market.lowest) return "Le moins cher";
  if (market.median != null && price <= market.median) return "Sous la médiane";
  if (price < market.highest) return "Au-dessus de la médiane";
  return "Le plus cher";
}

export function costFromProduct(p: {
  purchasePrice: string | number | null;
  shippingCost: string | number | null;
  importCost: string | number | null;
  otherCosts: string | number | null;
  exchangeRate?: string | number | null;
}): CostInput {
  return {
    purchasePrice: n(p.purchasePrice),
    shippingCost: n(p.shippingCost),
    importCost: n(p.importCost),
    otherCosts: n(p.otherCosts),
    exchangeRate: n(p.exchangeRate) || 1,
  };
}

export function taxFromWorkspace(w: {
  defaultVatRate: string | number;
  purchasePricesIncludeVat: boolean;
  sellingPricesIncludeVat: boolean;
  variableSellingCostRate: string | number;
}, productVat?: string | number | null): TaxAssumptions {
  return {
    vatRate: n(productVat) || n(w.defaultVatRate) || 0.19,
    purchasePricesIncludeVat: w.purchasePricesIncludeVat,
    sellingPricesIncludeVat: w.sellingPricesIncludeVat,
    variableSellingCostRate: n(w.variableSellingCostRate),
  };
}

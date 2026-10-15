export type ConnectorCapability = {
  search: boolean;
  extractProduct: boolean;
  extractPrice: boolean;
  detectStock: boolean;
  match: boolean;
  automated: boolean;
};

export type ConnectorDefinition = {
  slug: string;
  name: string;
  domain: string;
  websiteUrl: string;
  listingUrl?: string;
  searchUrlTemplate?: string;
  logoText: string;
  status: "ready" | "limited" | "demo";
  notes: string;
  robotsUrl: string;
  capabilities: ConnectorCapability;
};

export const BUILTIN_CONNECTORS: ConnectorDefinition[] = [
  {
    slug: "mytek",
    name: "Mytek",
    domain: "mytek.tn",
    websiteUrl: "https://www.mytek.tn",
    listingUrl: "https://www.mytek.tn",
    searchUrlTemplate: "https://www.mytek.tn/catalogsearch/result/?q={q}",
    logoText: "MY",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). La recherche du site étant interdite par robots.txt, les produits sont retrouvés par leur référence via le plan du site.",
    robotsUrl: "https://www.mytek.tn/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
  {
    slug: "spacenet",
    name: "SpaceNet",
    domain: "spacenet.tn",
    websiteUrl: "https://www.spacenet.tn",
    listingUrl: "https://www.spacenet.tn",
    searchUrlTemplate: "https://www.spacenet.tn/recherche?controller=search&s={q}",
    logoText: "SN",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). Les produits sont retrouvés par leur référence via le plan du site.",
    robotsUrl: "https://www.spacenet.tn/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
  {
    slug: "tunisianet",
    name: "Tunisianet",
    domain: "tunisianet.com.tn",
    websiteUrl: "https://www.tunisianet.com.tn",
    listingUrl: "https://www.tunisianet.com.tn",
    searchUrlTemplate: "https://www.tunisianet.com.tn/recherche?controller=search&s={q}",
    logoText: "TN",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). PricePilot ne contourne jamais les CAPTCHA ni les pages de connexion.",
    robotsUrl: "https://www.tunisianet.com.tn/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
  {
    slug: "graiet",
    name: "Graiet",
    domain: "graiet.tn",
    websiteUrl: "https://www.graiet.tn",
    listingUrl: "https://www.graiet.tn",
    searchUrlTemplate: "https://www.graiet.tn/recherche?q={q}",
    logoText: "GR",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). La recherche du catalogue étant interdite par robots.txt, les produits sont retrouvés par leur référence via le plan du site.",
    robotsUrl: "https://www.graiet.tn/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
  {
    slug: "electrohadjkacem",
    name: "Electro Hadj Kacem",
    domain: "electrohadjkacem.com",
    websiteUrl: "https://electrohadjkacem.com",
    listingUrl: "https://electrohadjkacem.com",
    logoText: "EH",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). Le plan du site ne listant que les catégories, le catalogue est lu via l'API publique de la boutique.",
    robotsUrl: "https://electrohadjkacem.com/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
  {
    slug: "eleganza",
    name: "Eleganza",
    domain: "eleganza.tn",
    websiteUrl: "https://eleganza.tn",
    listingUrl: "https://eleganza.tn",
    logoText: "EL",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). La recherche du site étant interdite par robots.txt, les produits sont retrouvés par leur référence via le plan du site.",
    robotsUrl: "https://eleganza.tn/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
  {
    slug: "alarabia",
    name: "Alarabia",
    domain: "alarabia.com.tn",
    websiteUrl: "https://www.alarabia.com.tn",
    listingUrl: "https://www.alarabia.com.tn",
    searchUrlTemplate: "https://www.alarabia.com.tn/recherche?controller=search&s={q}",
    logoText: "AL",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). Le plan du site ne listant pas les produits, le catalogue complet est lu depuis la liste des produits de la boutique.",
    robotsUrl: "https://www.alarabia.com.tn/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
  {
    slug: "batam",
    name: "Batam",
    domain: "batam.com.tn",
    websiteUrl: "https://batam.com.tn",
    listingUrl: "https://batam.com.tn",
    searchUrlTemplate: "https://batam.com.tn/catalogsearch/result/?q={q}",
    logoText: "BT",
    status: "ready",
    notes:
      "Prix et stock lus en direct dans les métadonnées publiques des pages produits (robots.txt respecté). Les produits sont retrouvés par leur référence via le plan du site.",
    robotsUrl: "https://batam.com.tn/robots.txt",
    capabilities: { search: false, extractProduct: true, extractPrice: true, detectStock: true, match: true, automated: true },
  },
];

export async function probeCompetitor(websiteUrl: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(websiteUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "CBE-PricePilot/1.0 (+https://pricepilot.local; connectivity-check)" },
    });
    clearTimeout(timer);
    return { ok: res.ok || (res.status >= 200 && res.status < 500), status: res.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

export function searchUrlFor(def: ConnectorDefinition, query: string): string | null {
  if (!def.searchUrlTemplate) return null;
  return def.searchUrlTemplate.replace("{q}", encodeURIComponent(query));
}

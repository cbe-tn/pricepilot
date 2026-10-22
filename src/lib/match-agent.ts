// Price agent, judging step: Claude reads our article and the candidate pages found on competitor sites
// and says, for each page, whether it sells the very same article. Deterministic search finds the
// candidates; the model only decides. Nothing here writes to the database.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Product } from "@/db/schema";
import { n } from "@/lib/money";

export const AGENT_MODEL = process.env.CLAUDE_MATCH_MODEL || "claude-opus-5-5";

export type AgentCandidate = {
  id: number;
  shop: string;
  title: string;
  priceTnd: number;
  availability: string;
  url: string;
  /** Our reference (or a spelling of it) appears on the page. */
  referenceOnPage: boolean;
};

export type Verdict = "same" | "variant" | "accessory" | "different" | "unsure";
export type Judgement = { id: number; verdict: Verdict; confidence: number; reason: string };

const Judgements = z.object({
  verdicts: z.array(
    z.object({
      id: z.number().int(),
      verdict: z.enum(["same", "variant", "accessory", "different", "unsure"]),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

const SYSTEM = `Tu vérifies des correspondances de produits pour NUMEDIA, un revendeur tunisien d'informatique, d'impression, de vidéosurveillance et d'électroménager.
On te donne un article de notre catalogue et des pages produit trouvées chez des concurrents. Pour chaque page, dis si elle vend exactement le même article.

Verdicts :
- "same" : même modèle exact (même référence ou même numéro de modèle, mêmes capacités). Une simple différence de couleur reste "same".
- "variant" : même gamme mais un autre modèle ou une autre configuration (capacité, mémoire, taille, suffixe Pro/Plus/5G, nombre de canaux, version différente).
- "accessory" : consommable, pièce, étui, câble ou accessoire pour ce produit, pas le produit lui-même.
- "different" : un autre produit.
- "unsure" : les informations ne suffisent pas pour trancher.

Règles :
- Les références fabricant s'écrivent de plusieurs façons (tirets, espaces, suffixe régional comme "/4P", "-EU", "FE"). Une même racine de référence avec un suffixe régional ou d'emballage reste "same".
- Un produit "compatible" ou "adaptable" n'est jamais "same" pour un article d'origine.
- Le prix sert seulement d'indice : un écart de prix normal entre boutiques ne change rien ; un prix incohérent (deux fois plus cher ou moitié prix) doit te rendre prudent.
- confidence : nombre entre 0 et 1. Ne mets 0.8 ou plus que si tu es sûr.
- reason : une phrase courte en français (moins de 20 mots) qui cite l'élément décisif.
Réponds pour chaque page, avec son id.`;

let client: Anthropic | null = null;

export const agentConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

function describeProduct(p: Product): string {
  const cost = n(p.purchasePrice) * (n(p.exchangeRate) || 1) * (1 + n(p.vatRate));
  const specs = Object.entries(p.specifications ?? {})
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" ; ");
  return [
    `Désignation : ${p.name}`,
    p.brand ? `Marque : ${p.brand}` : null,
    p.manufacturerRef ? `Référence fabricant : ${p.manufacturerRef}` : null,
    p.model && p.model !== p.manufacturerRef ? `Modèle : ${p.model}` : null,
    p.category ? `Catégorie : ${p.category}` : null,
    specs ? `Caractéristiques : ${specs}` : null,
    p.description ? `Description : ${p.description.replace(/\s+/g, " ").slice(0, 400)}` : null,
    cost > 0 ? `Notre coût d'achat TTC : ${cost.toFixed(0)} DT` : null,
    n(p.ownPriceTnd) > 0 ? `Notre prix sur numedia.tn : ${n(p.ownPriceTnd).toFixed(0)} DT` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** One request per article, all its candidate pages at once. Pages the model does not answer for count as "unsure". */
export async function judgeCandidates(product: Product, candidates: AgentCandidate[]): Promise<Judgement[]> {
  if (!candidates.length) return [];
  client ??= new Anthropic();
  const pages = candidates
    .map(
      (c) =>
        `[id ${c.id}] ${c.shop} — « ${c.title} » — ${c.priceTnd.toFixed(3)} DT — ${c.availability === "in_stock" ? "en stock" : c.availability === "out_of_stock" ? "rupture" : "dispo inconnue"}` +
        `${c.referenceOnPage ? " — notre référence apparaît sur la page" : ""}\n  ${c.url}`,
    )
    .join("\n");
  const fallback = (reason: string) => candidates.map((c) => ({ id: c.id, verdict: "unsure" as const, confidence: 0, reason }));
  try {
    const res = await client.messages.parse({
      model: AGENT_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Notre article :\n${describeProduct(product)}\n\nPages trouvées chez les concurrents :\n${pages}` }],
      output_config: { effort: "low", format: zodOutputFormat(Judgements) },
    });
    if (res.stop_reason === "refusal") return fallback("Analyse refusée par le modèle");
    const out = res.parsed_output?.verdicts ?? [];
    return candidates.map((c) => {
      const j = out.find((v) => v.id === c.id);
      return j ? { ...j, confidence: Math.max(0, Math.min(1, j.confidence)) } : { id: c.id, verdict: "unsure" as const, confidence: 0, reason: "Pas de réponse du modèle" };
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Clé ANTHROPIC_API_KEY refusée : vérifiez-la dans .env.supabase.");
    if (err instanceof Anthropic.RateLimitError) return fallback("Limite d'appels atteinte, réessai plus tard");
    if (err instanceof Anthropic.APIError) return fallback(`Erreur API ${err.status}`);
    throw err;
  }
}

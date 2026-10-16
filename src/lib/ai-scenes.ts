// AI-generated poster backgrounds, free tier: Cloudflare Workers AI (FLUX.1 schnell, Apache-2.0, commercial
// use allowed). The model only paints an empty scene: the real product photo is placed on it by the poster
// composer, so logos, shape and colours are never redrawn by the AI, and no price is ever sent to it.

export type Ambiance = { id: string; label: string; prompt: string };

export const AMBIANCES: Ambiance[] = [
  { id: "auto", label: "Automatique (selon le produit)", prompt: "" },
  {
    id: "kitchen",
    label: "Cuisine méditerranéenne (marbre, vue mer)",
    prompt: "luxury Mediterranean kitchen, white marble countertop, warm golden morning sunlight through a large window, sea view with an olive tree, soft shadows",
  },
  { id: "office", label: "Bureau moderne", prompt: "bright modern home office, light oak desk, green plants, soft natural daylight, minimal Scandinavian interior" },
  { id: "living", label: "Salon élégant", prompt: "elegant modern living room, low wooden TV console, warm evening ambient lights, cosy sofa in the background" },
  { id: "laundry", label: "Buanderie lumineuse", prompt: "clean bright laundry room, white cabinets, neatly folded towels, soft daylight" },
  { id: "bedroom", label: "Chambre calme", prompt: "calm modern bedroom, linen textures, soft morning light, wooden bedside table" },
  { id: "sidi-bou-said", label: "Sidi Bou Saïd (blanc et bleu)", prompt: "Sidi Bou Said terrace in Tunisia, white walls and blue doors, bougainvillea flowers, Mediterranean sea view, bright sunny day" },
  { id: "medina", label: "Médina (intérieur traditionnel)", prompt: "traditional Tunisian house interior, colourful zellige tiles, carved arches, brass lantern, warm light, low wooden table" },
  { id: "beach", label: "Plage (Hammamet)", prompt: "Mediterranean beach terrace at golden hour, wooden table, turquoise sea, palm trees" },
  { id: "desert", label: "Désert du Sahara", prompt: "Sahara desert dunes at golden hour near Douz, wooden platform, warm orange light, clear sky" },
  { id: "forest", label: "Forêt (Aïn Draham)", prompt: "green cork oak forest of Ain Draham, mossy wooden stump platform, soft sun rays through the trees" },
  { id: "studio", label: "Studio photo premium", prompt: "premium photo studio, seamless gradient backdrop, soft box lighting, glossy reflective floor" },
];

const EVENT_MOOD: Record<string, string> = {
  "black-friday": "dramatic dark studio with neon accent lights",
  "nouvel-an": "festive golden bokeh lights, New Year celebration mood",
  "soldes-hiver": "cosy winter mood, warm light, knitted textures",
  "saint-valentin": "romantic mood, rose petals, soft pink light",
  ramadan: "warm evening light, glowing Ramadan lanterns (fanous), dates and mint tea on the side",
  "aid-fitr": "festive Eid mood, traditional Tunisian pastries on the side, warm light",
  "aid-adha": "festive Eid mood, family table, warm light",
  "fete-meres": "fresh flower bouquet on the side, soft pastel light",
  "fete-peres": "warm elegant masculine mood, leather and wood textures",
  "soldes-ete": "bright summer mood, sunshine",
  "fete-femme": "fresh flowers, soft elegant light",
  rentree: "school mood, notebooks and coloured pencils on the side",
  mouled: "warm evening light, traditional Tunisian mood",
};

/** Ambiance chosen automatically from the products (kitchen for appliances, office for printers…). */
export function autoAmbiance(sceneQuery: string): string {
  const map: Record<string, string> = {
    kitchen: "kitchen",
    sofa: "living",
    laundry: "laundry",
    bedroom: "bedroom",
    house: "sidi-bou-said",
    beach: "beach",
    cafe: "medina",
    "office desk": "office",
    "home interior": "living",
  };
  return map[sceneQuery] ?? "studio";
}

export function buildScenePrompt(opts: { ambianceId: string; sceneQuery: string; eventId?: string; details?: string }): string {
  const id = opts.ambianceId === "auto" ? autoAmbiance(opts.sceneQuery) : opts.ambianceId;
  const base = AMBIANCES.find((a) => a.id === id)?.prompt ?? AMBIANCES.find((a) => a.id === "studio")!.prompt;
  const mood = opts.eventId ? EVENT_MOOD[opts.eventId] : undefined;
  const details = (opts.details ?? "").replace(/[^\p{L}\p{N} ,.'-]/gu, " ").slice(0, 200).trim();
  return [
    "Professional advertising photograph, square format",
    base,
    mood,
    details,
    // The product is added afterwards: keep a clean, empty surface in the lower centre.
    "large empty surface in the lower centre foreground for product placement, nothing standing in the centre, no products, no appliances in the foreground, no text, no letters, no logos, no people",
    "photorealistic, high detail, shallow depth of field, natural lighting",
  ]
    .filter(Boolean)
    .join(", ");
}

export const aiScenesConfigured = () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN);
/** Generations allowed per workspace per day (keeps well inside the free daily allowance). */
export const AI_SCENES_PER_DAY = Math.max(1, Number(process.env.AI_SCENES_PER_DAY) || 40);

export async function generateSceneImage(prompt: string): Promise<{ ok: true; bytes: Buffer; mime: string } | { ok: false; error: string }> {
  // Tolerate copy-paste noise in the Vercel settings (spaces, line breaks, a pasted "Bearer " prefix).
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_AI_TOKEN?.trim().replace(/^Bearer\s+/i, "");
  if (!account || !token) return { ok: false, error: "Génération IA non configurée (CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_AI_TOKEN)." };
  const model = process.env.CLOUDFLARE_AI_MODEL || "@cf/black-forest-labs/flux-1-schnell";
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // The model accepts only prompt and steps (no seed): each call already gives a new image.
      body: JSON.stringify({ prompt, steps: 6 }),
      signal: AbortSignal.timeout(55_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) {
      if (!res.ok) return { ok: false, error: `Génération refusée (HTTP ${res.status}).` };
      return { ok: true, bytes: Buffer.from(await res.arrayBuffer()), mime: type.split(";")[0] };
    }
    const data = (await res.json().catch(() => null)) as { success?: boolean; result?: { image?: string }; errors?: Array<{ code?: number; message?: string }> } | null;
    const b64 = data?.result?.image;
    if (res.ok && b64) return { ok: true, bytes: Buffer.from(b64, "base64"), mime: "image/jpeg" };
    const err = data?.errors?.[0];
    if (res.status === 429 || err?.code === 4006) return { ok: false, error: "Quota gratuit Cloudflare du jour atteint — réessayez demain (remise à zéro à 1 h, heure de Tunis)." };
    if (res.status === 401 || res.status === 403 || err?.code === 10000)
      return { ok: false, error: "Cloudflare refuse le jeton (Authentication error) : créez un jeton avec le modèle « Workers AI » (pas la Global API Key) pour le même compte que CLOUDFLARE_ACCOUNT_ID, puis redéployez." };
    if (err?.code === 3030) return { ok: false, error: "Description refusée par le filtre de sécurité : reformulez les détails." };
    return { ok: false, error: `Génération impossible${err?.message ? ` : ${err.message}` : ` (HTTP ${res.status})`}.` };
  } catch {
    return { ok: false, error: "Le service de génération ne répond pas — réessayez dans un instant." };
  }
}

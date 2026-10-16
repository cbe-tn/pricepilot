// Realistic backgrounds for posters: CC0 (public domain) photos from StockSnap, searched through the
// Openverse API (no key needed). CC0 allows commercial use without attribution; the photographer is
// still recorded with the campaign.
import { USER_AGENT } from "@/lib/extract";
import type { PosterScene } from "@/lib/poster";

/** Only this CDN is accepted for scene photos (search results, saved designs and the image proxy). */
export const SCENE_URL = /^https:\/\/cdn\.stocksnap\.io\/img-thumbs\/(960w|280h)\/[A-Z0-9]+\.jpg$/;
export const sceneThumb = (url: string) => url.replace("/960w/", "/280h/");

type OpenverseImage = { id: string; title?: string; url: string; creator?: string; foreign_landing_url?: string; license?: string; source?: string };

// Anonymous Openverse quota is 200 searches a day: results are kept for a day per server instance.
const cache = new Map<string, { at: number; scenes: PosterScene[] }>();
const DAY = 86_400_000;

export async function searchScenes(query: string): Promise<{ scenes: PosterScene[]; error?: string }> {
  const q = query.trim().toLowerCase().slice(0, 60);
  if (!q) return { scenes: [] };
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < DAY) return { scenes: hit.scenes };
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0&source=stocksnap&page_size=20&mature=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) return { scenes: [], error: "Quota de recherche Openverse atteint pour aujourd'hui — réessayez demain ou choisissez une autre scène déjà affichée." };
    if (!res.ok) return { scenes: [], error: `Recherche d'images indisponible (HTTP ${res.status}).` };
    const data = (await res.json()) as { results?: OpenverseImage[] };
    const scenes = (data.results ?? [])
      .filter((r) => r.license === "cc0" && SCENE_URL.test(r.url))
      .map((r) => ({
        url: r.url,
        thumb: sceneThumb(r.url),
        title: (r.title ?? "").slice(0, 200),
        creator: (r.creator ?? "").slice(0, 200),
        landing: r.foreign_landing_url ?? "https://stocksnap.io",
      }));
    cache.set(q, { at: Date.now(), scenes });
    return { scenes };
  } catch {
    return { scenes: [], error: "Recherche d'images indisponible pour le moment." };
  }
}

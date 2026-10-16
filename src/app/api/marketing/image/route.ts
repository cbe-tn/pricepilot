import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { USER_AGENT } from "@/lib/extract";
import { officialPhotoUrl } from "@/lib/marketing";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

// Public hosts only: the URL comes from the catalogue, but a hand-typed one must not reach internal services.
function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    return !(
      h === "localhost" ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.includes(":")
    );
  } catch {
    return false;
  }
}

/**
 * Official product photo served from our own origin, so the poster canvas stays exportable (a
 * cross-origin image would block the PNG download). ?product=<id>
 */
export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response("Non autorisé", { status: 401 });
  const id = new URL(req.url).searchParams.get("product") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Produit invalide", { status: 400 });
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!product) return new Response("Produit introuvable", { status: 404 });

  const url = await officialPhotoUrl(product);
  if (!url || !isPublicHttpUrl(url)) return new Response("Aucune photo officielle", { status: 404 });
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" }, signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    // SVG is refused: served from our origin it could run scripts.
    if (!res.ok || !type.startsWith("image/") || type.includes("svg")) return new Response("Photo indisponible", { status: 502 });
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new Response("Photo trop lourde", { status: 502 });
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response("Photo indisponible", { status: 502 });
  }
}

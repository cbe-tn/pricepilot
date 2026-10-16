import { getAuth } from "@/lib/auth";
import { searchScenes } from "@/lib/scenes";

export const dynamic = "force-dynamic";

/** Realistic background photos for posters (CC0). ?q=kitchen */
export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response("Non autorisé", { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json(await searchScenes(q));
}

import { generateSceneImage } from "@/lib/ai-scenes";
import { fetchLiveOffer, USER_AGENT } from "@/lib/extract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Operator diagnostic for the free AI scenes (Bearer CRON_SECRET): verifies the Cloudflare token and runs
 * one test generation. Returns only status codes and Cloudflare messages, never the credentials.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Non autorisé", { status: 401 });
  // ?page=<competitor product URL>&ref=<reference>: can the deployed app read this page (anti-bot, timeouts)?
  const params = new URL(req.url).searchParams;
  const page = params.get("page");
  if (page) {
    const started = Date.now();
    let raw: { status: number; bytes: number; server: string | null } | { error: string };
    try {
      const res = await fetch(page, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
      raw = { status: res.status, bytes: (await res.text()).length, server: res.headers.get("server") };
    } catch (e) {
      raw = { error: e instanceof Error ? e.message : "network" };
    }
    const live = await fetchLiveOffer(page, { reference: params.get("ref") ?? undefined });
    return Response.json({ raw, live: live.ok ? { price: live.offer.priceTnd, refOnPage: live.offer.referenceOnPage } : live, ms: Date.now() - started });
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const token = process.env.CLOUDFLARE_AI_TOKEN?.trim().replace(/^Bearer\s+/i, "") ?? "";
  const shape = {
    accountIdLooksValid: /^[0-9a-f]{32}$/.test(account),
    tokenLength: token.length,
  };
  const verify = async (url: string) => {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      const data = (await res.json().catch(() => null)) as { success?: boolean; errors?: unknown; result?: { status?: string } } | null;
      return { http: res.status, success: data?.success ?? null, status: data?.result?.status ?? null, errors: data?.errors ?? null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "network" };
    }
  };
  const userToken = await verify("https://api.cloudflare.com/client/v4/user/tokens/verify");
  const accountToken = await verify(`https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`);
  const gen = await generateSceneImage("Professional advertising photograph, empty white marble kitchen countertop, soft daylight, no text");
  return Response.json({
    shape,
    userToken,
    accountToken,
    generation: gen.ok ? { ok: true, bytes: gen.bytes.length, mime: gen.mime } : gen,
  });
}

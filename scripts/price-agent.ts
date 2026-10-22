// Price agent — run on the office PC after the Primini sync (some shops refuse the hosted app):
//   DATABASE_URL=... ANTHROPIC_API_KEY=... bun scripts/price-agent.ts [--dry]
// For catalogue products that still have no competitor price, it searches the selected shops with more
// spellings of the reference, keeps the plausible pages the strict automatic search left aside, and asks
// Claude whether each page sells the very same article. Sure matches become tracked prices; probable
// ones are saved "à confirmer" (hidden from comparisons until the user confirms them in the benchmark).
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { competitorOffers, competitors, priceObservations, products, userSettings, users, workspaces, type Product } from "@/db/schema";
import { findByReference, searchTermsForProduct, type ReferenceCandidate } from "@/lib/catalog";
import { isSelectedCompetitor } from "@/lib/connectors";
import { AGENT_MODEL, agentConfigured, judgeCandidates, type AgentCandidate } from "@/lib/match-agent";
import { moneyStr, n } from "@/lib/money";
import type { AuthContext } from "@/lib/auth";

const DRY = process.argv.includes("--dry");
/** Products judged per run (the task runs every hour). */
const MAX_PER_RUN = Math.max(1, Number(process.env.PRICE_AGENT_MAX) || 60);
/** A product without any match is searched again after this delay (new listings appear). */
const RETRY_MS = 7 * 24 * 3600 * 1000;
const SURE = 0.8;
const PROBABLE = 0.5;

const stateDir = join(process.env.LOCALAPPDATA ?? ".", "PricePilot");
mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, "price-agent-state.json");
const lockFile = join(stateDir, "price-agent.lock");

if (!agentConfigured()) {
  console.log("Agent prix : ANTHROPIC_API_KEY absent de .env.supabase — rien à faire.");
  process.exit(0);
}
if (existsSync(lockFile)) {
  const lock = JSON.parse(readFileSync(lockFile, "utf8") || "{}") as { pid?: number; at?: number };
  let alive = false;
  try {
    if (lock.pid) process.kill(lock.pid, 0);
    alive = Boolean(lock.pid);
  } catch {
    alive = false;
  }
  if (alive && lock.at && Date.now() - lock.at < 6 * 3600 * 1000) {
    console.log(`Agent prix déjà en cours (pid ${lock.pid}).`);
    process.exit(0);
  }
}
writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
process.on("exit", () => {
  try {
    unlinkSync(lockFile);
  } catch {}
});

/** productId -> last time the agent looked at it. */
const seen: Record<string, number> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8") || "{}") : {};
const saveState = () => !DRY && writeFileSync(stateFile, JSON.stringify(seen));

const [ws] = await db.select().from(workspaces).limit(1);
if (!ws) throw new Error("Aucun espace de travail");
const [user] = await db.select().from(users).where(eq(users.workspaceId, ws.id)).limit(1);
const [settings] = user ? await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1) : [];
if (!user || !settings) throw new Error("Aucun utilisateur / paramètres pour l'espace de travail");
const auth: AuthContext = { user, workspace: ws, settings };

const shops = (await db.select().from(competitors).where(eq(competitors.workspaceId, ws.id))).filter((c) => c.enabled && isSelectedCompetitor(c));
const shopIds = shops.map((c) => c.id);

// Products with no accepted, comparable offer yet.
const unpricedIds = new Set(
  (
    await db.execute(sql`
      select p.id from products p
      where p.workspace_id = ${ws.id} and p.archived_at is null and not p.is_demo
        and not exists (
          select 1 from competitor_offers o
          where o.product_id = p.id and not o.is_compatible and coalesce(o.user_review, '') <> 'reject'
        )`)
  ).rows.map((r) => String((r as { id: string }).id)),
);
const catalog = await db.select().from(products).where(and(eq(products.workspaceId, ws.id), isNull(products.archivedAt)));
const due = catalog
  .filter((p) => unpricedIds.has(p.id) && (!seen[p.id] || Date.now() - seen[p.id] > RETRY_MS))
  .sort((a, b) => (seen[a.id] ?? 0) - (seen[b.id] ?? 0) || b.stockQty - a.stockQty)
  .slice(0, MAX_PER_RUN);
console.log(`Agent prix (${AGENT_MODEL}) : ${unpricedIds.size} articles sans prix concurrent, ${due.length} examinés ce passage${DRY ? " (essai, rien n'est enregistré)" : ""}.`);
if (!due.length) {
  await pool.end();
  process.exit(0);
}

/** More spellings than the strict search: regional suffix, dashes, brand + model. */
function variants(p: Product): string[] {
  const out = [...searchTermsForProduct(p)];
  const ref = p.manufacturerRef?.trim();
  if (ref) {
    if (ref.includes("/")) out.push(ref.split("/")[0]);
    if (/[-\s]/.test(ref)) out.push(ref.replace(/[-\s]/g, ""));
    const paren = ref.replace(/\(.*?\)/g, "").trim();
    if (paren !== ref) out.push(paren);
  }
  const short = p.name.split(/\s+/).slice(0, 6).join(" ");
  if (short !== p.name) out.push(short);
  return [...new Set(out.filter((t) => t.replace(/[^a-z0-9]/gi, "").length >= 4))].slice(0, 6);
}

function plausible(p: Product, price: number) {
  const cost = n(p.purchasePrice) * (n(p.exchangeRate) || 1) * (1 + n(p.vatRate));
  const own = n(p.ownPriceTnd);
  return cost > 0 ? price >= cost * 0.5 && price <= cost * 3 : own > 0 ? price >= own * 0.5 && price <= own * 2 : true;
}

async function saveOffer(p: Product, c: ReferenceCandidate, sure: boolean, confidence: number, reason: string) {
  const [offer] = await db
    .insert(competitorOffers)
    .values({
      workspaceId: ws.id,
      productId: p.id,
      competitorId: c.competitorId,
      title: c.title,
      brand: p.brand,
      model: p.model,
      manufacturerRef: p.manufacturerRef,
      url: c.url,
      imageUrl: c.imageUrl,
      priceTnd: moneyStr(c.priceTnd!),
      sellerName: c.seller ?? null,
      availability: c.availability,
      matchClass: sure ? "strong" : "possible",
      matchConfidence: Math.round(confidence * 100),
      matchReason: `${sure ? "Agent IA" : "Agent IA — à confirmer"} : ${reason}`,
      // Probable matches stay out of comparisons and recommendations until confirmed.
      excludedFromBenchmark: !sure,
      isDemo: false,
    })
    .returning();
  await db.insert(priceObservations).values({
    workspaceId: ws.id,
    offerId: offer.id,
    productId: p.id,
    competitorId: c.competitorId,
    priceTnd: moneyStr(c.priceTnd!),
    availability: c.availability,
    eventType: "unchanged",
    isDemo: false,
  });
}

const totals = { examined: 0, withCandidates: 0, judged: 0, sure: 0, probable: 0, rejected: 0, articlesPriced: 0 };
const started = Date.now();
for (const p of due) {
  totals.examined += 1;
  const rejectedUrls = new Set(
    (await db.select({ url: competitorOffers.url, review: competitorOffers.userReview }).from(competitorOffers).where(eq(competitorOffers.productId, p.id)))
      .filter((o) => o.review === "reject" && o.url)
      .map((o) => o.url!),
  );
  const byUrl = new Map<string, ReferenceCandidate>();
  for (const term of variants(p)) {
    const res = await findByReference(auth, { reference: term, productId: p.id, verifyPerCompetitor: 2, competitorIds: shopIds });
    for (const c of res.candidates) {
      if (c.priceTnd == null || c.error || c.compatible || c.alreadyTracked || rejectedUrls.has(c.url) || !plausible(p, c.priceTnd)) continue;
      const prev = byUrl.get(c.url);
      if (!prev || Number(c.referenceOnPage) > Number(prev.referenceOnPage)) byUrl.set(c.url, c);
    }
  }
  // At most two pages per shop, best first; ten per article.
  const perShop = new Map<string, ReferenceCandidate[]>();
  for (const c of [...byUrl.values()].sort((a, b) => Number(b.referenceOnPage) - Number(a.referenceOnPage) || b.confidence - a.confidence)) {
    const list = perShop.get(c.competitorId) ?? [];
    if (list.length < 2) perShop.set(c.competitorId, [...list, c]);
  }
  const picked = [...perShop.values()].flat().slice(0, 10);
  seen[p.id] = Date.now();
  if (!picked.length) {
    saveState();
    continue;
  }
  totals.withCandidates += 1;
  const asked: AgentCandidate[] = picked.map((c, i) => ({ id: i + 1, shop: c.competitorName, title: c.title, priceTnd: c.priceTnd!, availability: c.availability, url: c.url, referenceOnPage: c.referenceOnPage }));
  const verdicts = await judgeCandidates(p, asked);
  totals.judged += verdicts.length;

  // Best page per shop: a sure "same" becomes a price, a probable one waits for confirmation.
  let priced = false;
  for (const [shopId, list] of perShop) {
    const scored = list
      .map((c) => ({ c, j: verdicts[picked.indexOf(c)] }))
      .filter((x) => x.j)
      .sort((a, b) => b.j.confidence - a.j.confidence);
    const best = scored.find((x) => x.j.verdict === "same") ?? scored.find((x) => x.j.verdict === "unsure");
    for (const x of scored) if (x.j.verdict !== "same" && x.j.verdict !== "unsure") totals.rejected += 1;
    if (!best) continue;
    const sure = best.j.verdict === "same" && best.j.confidence >= SURE;
    if (!sure && best.j.confidence < PROBABLE) continue;
    const shop = shops.find((s) => s.id === shopId)?.name ?? "?";
    console.log(`  ${sure ? "✓" : "?"} ${p.name.slice(0, 60)} — ${shop} ${best.c.priceTnd} DT (${Math.round(best.j.confidence * 100)} %) : ${best.j.reason}`);
    if (!DRY) await saveOffer(p, best.c, sure, best.j.confidence, best.j.reason);
    if (sure) {
      totals.sure += 1;
      priced = true;
    } else totals.probable += 1;
  }
  if (priced) totals.articlesPriced += 1;
  saveState();
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
}

console.log(`Agent prix terminé en ${Math.round((Date.now() - started) / 60000)} min :`, JSON.stringify(totals));
await pool.end();

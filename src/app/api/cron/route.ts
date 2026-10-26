import { schedulerTick } from "@/lib/scheduler";
import { runMailCheck } from "@/lib/supplier-mail-job";

// Serverless trigger for the background scheduler (auto-match, our-site lookup, price monitoring).
// Called every minute by Supabase pg_cron (or any cron) with `Authorization: Bearer <CRON_SECRET>`.
// Each call does one bounded pass; unfinished work stays due and continues on the next call.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 240_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Non autorisé", { status: 401 });
  }
  const started = Date.now();
  // Supplier price lists received by e-mail: at most every 10 minutes, one minute of the budget at most.
  const mail = await runMailCheck({ deadline: started + 60_000 }).catch((e) => ({ ok: false, error: String(e) }));
  const result = await schedulerTick({ budgetMs: BUDGET_MS - (Date.now() - started) });
  return Response.json({ ...result, mail, ms: Date.now() - started });
}

export const POST = GET;

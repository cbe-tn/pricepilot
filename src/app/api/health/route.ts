import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Public health check: says whether the database answers and which kind it is (never the address
// or credentials), so a deployment can be checked from the browser.
function databaseKind(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (/supabase\.(com|co)/.test(url)) return "supabase";
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return "local";
  return "other";
}

export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: databaseKind(), latencyMs: Date.now() - started });
  } catch {
    return Response.json({ ok: false, database: databaseKind(), error: "database unreachable" }, { status: 500 });
  }
}

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

// Hosted Postgres (Supabase) requires TLS; its pooler certificate is not in Node's default CA list.
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(databaseUrl);

// Supabase's session pooler (port 5432) allows 15 clients for everything together: frozen Vercel instances
// and the office-PC scripts (Primini sync, price agent) exhausted it. The transaction pooler (port 6543)
// shares server connections per query; the app needs no session features (no named prepared statements,
// LISTEN or advisory locks; db.transaction keeps one connection for its duration).
// DATABASE_POOL_MODE=session keeps the URL as given.
const connectionUrl =
  process.env.DATABASE_POOL_MODE !== "session" ? databaseUrl.replace(/(pooler\.supabase\.com):5432\//, "$1:6543/") : databaseUrl;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    // sslmode in the URL would replace the ssl option below (and reject the pooler certificate).
    connectionString: connectionUrl.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""),
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // Serverless instances each hold their own pool: keep it small so the Supabase pooler is not exhausted.
    max: process.env.VERCEL ? 5 : 10,
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };

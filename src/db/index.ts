import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

// Hosted Postgres (Supabase) requires TLS; its pooler certificate is not in Node's default CA list.
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(databaseUrl);

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    // sslmode in the URL would replace the ssl option below (and reject the pooler certificate).
    connectionString: databaseUrl.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""),
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // Serverless instances each hold their own pool: keep it small so the Supabase pooler is not exhausted.
    max: process.env.VERCEL ? 5 : 20,
    idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };

import { defineConfig } from "drizzle-kit";

// DATABASE_URL: local PGlite in development, the Supabase connection string in production.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) || "postgres",
    ssl: isLocal ? false : { rejectUnauthorized: false },
  },
});

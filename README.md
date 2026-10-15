# CBE PricePilot

Price intelligence for **CBE — Cap Bon Electronique / NUMEDIA**. PricePilot automates the manual
Excel benchmark: it finds each product of our stock on Tunisian competitor sites by its reference,
keeps their prices current, checks whether the article is published on our own shop
(numedia.tn), and recommends a selling price that beats the cheapest competitor while keeping
our minimum margin.

The UI is in French; amounts are in Tunisian dinars (DT, 3 decimals).

---

## Features

| Page | What it does |
|---|---|
| **Stock & site web** (`/stock-web`) | Stock articles × shops: presence on numedia.tn (*En ligne* / *À vérifier* / *À insérer*) with the link to our article, each competitor's price with a link to the exact article, recommended price. "Comparer" opens a Primini-style ranking of all offers. Excel export. |
| **Benchmark des prix** (`/benchmarking`) | Same matrix for the whole catalogue + list of every offer, with *Confirmer / Rejeter* for uncertain matches. |
| **Fiche produit** (`/products/[id]`) | All offers for one product, price history, pricing strategies, manual search / manual URL. |
| **Recommandations**, **Rapports**, **Historique**, **Tableau de bord** | Recommended prices, exports, price changes, KPIs. |
| **Import** | CSV/Excel import (French headers supported: Réf, Désignation, Qté, Prix achat HT…). Supplier catalogues with a title block, products spread over several lines and several sheets are handled. Re-imports **update** products by reference (no duplicates). |

### Business rules

- **Minimum margin: 3 %**, measured like the original sheet: `(price TTC − purchase TTC) / price TTC`.
- **VAT**: 7 % for IT equipment (printing, PCs, peripherals, consumables), 19 % for everything else
  (TV, appliances, CCTV…). Assigned automatically from the product name/category — `src/lib/tax.ts`.
- **Recommended price** = cheapest competitor that is not out of stock **− 1 DT**, never below the
  minimum-margin floor (then shown as *plancher*) — `src/lib/pricing.ts`.
- Our own shop is indexed like a competitor but is **never** used as a competitor.

---

## How it works

```
 Competitor sites ──(1) catalogue index──▶ competitor_catalog (≈80 000 URLs + titles)
        │                                         │
        │                         (2) search by product reference
        │                                         ▼
        └──(3) read live price on the product page ──▶ competitor_offers ──▶ price_observations
                                                          │
                                   (4) benchmark matrix, margins, recommended price
```

1. **Catalogue index** (`src/lib/catalog.ts`) — every 3 days, the full product list of each shop is
   downloaded: its sitemap (Mytek, SpaceNet, Tunisianet, Graiet, Batam, Eleganza, numedia.tn), the
   PrestaShop category listing (Alarabia) or the public Medusa store API (Electro Hadj Kacem).
2. **Matching** — each product reference is searched in the index; candidate pages are opened and
   verified: reference present on the page + matching brand/model (`src/lib/matching.ts`). Variants
   (capacity, size), bundles, refurbished items and accessories are excluded. Confident matches
   are tracked automatically; uncertain ones wait for *Confirmer / Rejeter*. A rejected page is never
   proposed again for that product.
3. **Live price** (`src/lib/extract.ts`) — read from the structured data shops publish for search
   engines (JSON-LD / meta tags): price, availability, title, image.
4. **Benchmark & pricing** (`src/lib/benchmark.ts`, `src/lib/pricing.ts`).

There is **no AI model** in the app: matching, VAT and recommendations are deterministic rules.

### Scraping etiquette

Only public pages are read; `robots.txt` is respected; at least **2 s between two requests to the
same site**, 15 s timeout, user agent `CBE-PricePilot/1.0`. No login, no CAPTCHA bypass. An
unreachable site never deletes existing prices (they are marked *à vérifier*).

### Background scheduler (`src/lib/scheduler.ts`)

| Task | Frequency |
|---|---|
| Search new products on competitors + our site | on import, then every 24 h — 5 products per pass |
| Re-check price/stock of tracked offers | every 6 h per competitor (resumable) |
| Rebuild a competitor catalogue | every 3 days |

- **Normal server / local**: runs in-process every minute (started from `src/instrumentation.ts`).
- **Vercel (serverless)**: no long-lived process — an external cron calls `GET /api/cron` every
  minute; each call does one bounded pass (≤ 240 s) and unfinished work continues on the next call.
  A database lease (`job_leases`) guarantees only one pass runs at a time.

After importing ~400 stock articles, everything is searched within about 1.5–2 hours.

---

## Tech stack

TypeScript · **Next.js 16** (App Router, server actions) · **React 19** · **Tailwind CSS 4** ·
**PostgreSQL** with **Drizzle ORM** · SheetJS (`xlsx`) · Recharts · Lucide icons · Bun.

```
src/
  app/            pages (French UI) and API routes (/api/cron, /api/benchmark, /api/stock-web…)
  components/     UI (BenchmarkTable, ClientWidgets, AppShell…)
  db/             Drizzle schema + connection
  lib/
    catalog.ts    catalogue indexing (sitemaps, PrestaShop, Medusa) + reference search + our-site lookup
    extract.ts    live price extraction, robots.txt, polite fetching
    matching.ts   product ↔ listing match grading
    pricing.ts    costs, margins, strategies, recommended price
    benchmark.ts  product × competitor matrix
    tax.ts        7 % / 19 % VAT rule
    scheduler.ts  background worker
    csv.ts        spreadsheet import/export
public/brand/     CBE logo
```

---

## Local development

Requirements: [Bun](https://bun.sh) and a PostgreSQL database (any Postgres works; on Windows
without Postgres installed, [PGlite](https://pglite.dev) can serve one:
`bun x --bun pglite-server --db=./pgdata --port=5432`).

```bash
bun install
cp .env.example .env            # set DATABASE_URL
bun run db:push                 # create the tables
bun --bun next dev --webpack -p 3100
```

Open http://localhost:3100 and create the owner account on `/register`.

Checks: `bun run typecheck` · `bun run test` · `bun run build`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. For Supabase use the **Session pooler** URI (port 5432), without `?sslmode` (TLS is configured in code). |
| `CRON_SECRET` | on Vercel | Secret expected by `/api/cron` as `Authorization: Bearer <CRON_SECRET>`. |
| `PRICEPILOT_SCHEDULER` | no | `0` disables the in-process scheduler (automatically off on Vercel). |
| `PRICEPILOT_DEMO_SEED` | no | `1` seeds demo data in a new workspace (off by default — real data only). |

---

## Deployment (Supabase + Vercel)

### 1. Supabase (database)

1. Create a project on [supabase.com](https://supabase.com) — region **Europe (Frankfurt)**.
2. *Connect* → copy the **Session pooler** connection string.
3. Create the tables: `DATABASE_URL="<that URI>" bun run db:push`.

### 2. Vercel (application)

1. *Add New → Project* → import `cbe-tn/pricepilot` (framework: Next.js, defaults are fine).
2. Environment variables: `DATABASE_URL` (Supabase URI) and `CRON_SECRET` (long random string).
3. Deploy. Functions run in **Frankfurt** (`vercel.json` → `fra1`), close to the database and to
   the Tunisian sites. Every push to `main` redeploys.

> Vercel limits request bodies to **4.5 MB**: larger Excel imports must be split.

### 3. Scheduler (Supabase pg_cron → `/api/cron`, every minute)

Vercel's free plan only allows a daily cron, so the database triggers the app instead. In the
Supabase dashboard enable the **pg_cron** and **pg_net** extensions (*Database → Extensions*), then
run in the SQL editor (replace the URL and the secret):

```sql
select cron.schedule(
  'pricepilot-tick',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://<your-app>.vercel.app/api/cron',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 5000
  );
  $$
);
```

`net.http_get` does not wait for the pass to finish; the function keeps running on Vercel (up to
300 s). To stop: `select cron.unschedule('pricepilot-tick');` — runs are listed in
`cron.job_run_details`.

---

## Limits

- Matching relies on the manufacturer reference: products without one, or named differently by a
  competitor, may need a manual confirmation.
- Only public data is used; if a site changes its structure or blocks requests, its prices are kept
  and flagged until it can be read again.
- Competitor connectors are site-specific (`src/lib/connectors.ts`); a new shop usually only needs
  its URL if it publishes a sitemap and structured product data.

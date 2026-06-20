# Koda.ee live ingestion (staging, v1)

## Purpose

Fetch new/changed **public** Koda.ee pages, normalize them into the app's content
shape, and store them in a **safe staging/review layer**. Ingestion never
overwrites public content and never publishes rows automatically — every fetched
page lands in `IngestionStagingItem` for human review.

This is **not** the legacy crawler (`scripts/crawl.ts`). It is a new, allowlisted,
non-destructive pipeline.

## Architecture

```
discover (listing pages) → fetch (allowlisted) → parse (cheerio) → classify
        → dedup/change-detect → write staging (staging mode only)
```

| File | Role |
| --- | --- |
| `src/lib/ingestion/url.ts` | Allowlist + canonicalization (`https://www.koda.ee/et/...` only). |
| `src/lib/ingestion/parse.ts` | Resilient HTML parser + article-link discovery (cheerio, no script execution). |
| `src/lib/ingestion/classify.ts` | Reuses `law-match` for law detection; law-derived valdkond suggestions. |
| `src/lib/ingestion/koda-ee.ts` | Orchestrator: discovery, fetch, dedup decision, run counts, writes. |
| `src/lib/ingestion/staging-view.ts` | Pure filter/sort for the admin staging list. |
| `scripts/ingest-koda-ee.ts` | CLI entry point. |
| `src/app/admin/(dash)/ingestion/*` | Admin runs + staging-items pages. |

## Models (Prisma)

Migration `20260620090000_ingestion_staging` adds two tables (additive only):

- **`IngestionRun`** — one run: `source`, `mode` (`dry_run`/`staging`), `status`
  (`started`/`completed`/`failed`), `startedAt`/`finishedAt`, page/item counters,
  `errorSummary`.
- **`IngestionStagingItem`** — one fetched page: `canonicalUrl`, `urlHash`
  (**unique** = sha256 of the canonical URL), `contentHash`, `title`, `summary`,
  `bodyText`, `publishedAt`, `detectedSourceType`, `detected{Valdkonnad,Tegevusalad,Tapsustused,Laws}`
  (JSON), `classificationConfidence`, `reviewStatus`, `matchedContentItemId`
  (soft reference — no FK to ContentItem), `rawMetadata` (JSON), `fetchStatus`,
  `errorMessage`.

`ContentItem` is **not** modified by this feature (no new fields, no data writes).

## Commands

```bash
# Dry run (default — no DB writes): fetch, parse, classify, print a summary.
npm run ingest:koda-ee -- --dry-run --limit=20

# Staging run: write IngestionRun + IngestionStagingItem (never ContentItem).
npm run ingest:koda-ee -- --staging --limit=50
```

Options: `--dry-run` (default), `--staging`, `--limit=N` (default 50, max 500),
`--max-pages=N` (listing pages to scan, default 10), `--source=koda_ee`,
`--since=YYYY-MM-DD` (skip pages published before the date).

### Dry-run mode

Discovers, fetches, parses and classifies, then prints a summary. **Writes
nothing** to the database (no run row, no staging rows). Read-only DB lookups are
used to compute accurate created/updated/skipped counts.

### Staging mode

Writes one `IngestionRun` and upserts `IngestionStagingItem` rows. Never writes,
updates or deletes `ContentItem`. Never sets a staging row public.

## Safety rules

- **Allowlist:** only `https://www.koda.ee` / `koda.ee` `/et/...` pages are ever
  requested; external domains and non-`/et/` paths are rejected before any fetch.
- **No auto-run:** nothing schedules ingestion; it runs only when the command is
  invoked manually.
- **No publishing:** new pages are never made public; `reviewStatus` starts at
  `new`/`needs_review`/`matched_existing`, never `approved`.
- **No ContentItem mutation**, no source Excel / bundle mutation, no destructive
  DB ops.
- **Limits:** a page limit (default 50) and per-request timeout (15s) always apply.
- **No script execution** (cheerio parses only), **no external links followed**.
- Skipped/failed pages are logged into the run's `errorSummary`.

## Admin pages

- **`/admin/ingestion`** — latest runs: status, pages discovered/fetched, items
  created/updated/skipped/failed, errors, and a link to the staging items.
- **`/admin/ingestion/items`** — staging items with filters (run, review status,
  source type, year, detected law, detected valdkond, title/URL search). Default
  ordering: needs_review/new first, then newest. Shows title, date, source type,
  canonical URL, detected laws (linked to `/seadused/[slug]`), matched-existing
  flag and review status.

Both are under the existing admin auth (the `(dash)` layout `isAdmin()` guard).
There is **no approve-to-ContentItem action** in this version — staging is for
safe visibility and review only.

## Deduplication & change detection

For each fetched page (keyed by `urlHash` = sha256 of canonical URL):

- **same URL, same `contentHash`** → skip (unchanged); prior review status kept.
- **same URL, changed `contentHash`** → update the staging row, set `needs_review`.
- **new URL matching an existing `ContentItem`** (by `canonicalUrl`/`sourceUrl`)
  → create staging row `matched_existing` with `matchedContentItemId`; the
  ContentItem is **not** touched.
- **new URL, known source type** → create `new`; **unknown type** → `needs_review`.

`contentHash` reuses the app's `contentHash(title, body)`.

## Law / category detection

Reuses the existing law matcher (`extractLawMentions`) — no parallel taxonomy.
Detected laws (exact/inflected = high, alias/abbreviation = medium, weak keyword =
low) are stored on the staging item; **weak matches are suggestions only**.
Suggested valdkonnad are derived from the confirmed laws' `relatedValdkond`.
Sector/täpsustus auto-classification is intentionally deferred to human review
(the curated taxonomy lives in the data bundle / admin review).

## Scheduling daily ingestion (later, not configured here)

Run once per day from the **server scheduler / Unraid User Scripts / cron** — the
Next.js app must not run a long-lived internal scheduler. Example:

```bash
docker compose -p koda run --rm app npm run ingest:koda-ee -- --staging --limit=100
```

Then an admin reviews `/admin/ingestion/items`. This task does **not** configure
any server cron.

## Intentionally not implemented yet

- Approve-to-ContentItem (promoting a staging row into public content).
- Sector/tegevusala and täpsustus auto-classification beyond law-derived hints.
- Listing pagination / incremental "since last run" discovery.
- Internal opinion/document upload.
- Server-side scheduling.

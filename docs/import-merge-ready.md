# Merge-ready import (v1 Koda data model)

This document describes the deterministic Excel import pipeline that loads the
cleaned **merge-ready** workbooks into the database. These workbooks are the v1
**source of truth** for the source-based Koda value-discovery model. The
crawler and the seed script are **not** the primary source for this import.

## What it does

It loads three real content sources and one enrichment source:

| Workbook | Sheet used | Role |
| --- | --- | --- |
| `koda_web_index_v1_merge_ready.xlsx` | `web_merge_ready` | canonical public web rows incl. the 76 töövõidud/achievement rows |
| `koda_opinions_v1_merge_ready.xlsx` | `opinions_merge_ready` | opinion letters — imported as **supporting evidence** (hidden by default) |
| `koda_annual_reports_v1_merge_ready.xlsx` | `annual_reports_merge_ready` | yearly context, history, service context |
| `koda_toovoidud_enrichment_v1_merge_ready.xlsx` | `toovoidud_enrichment_ready` (+ `toovoidud_join_keys`) | **enrichment only** |

All other sheets in each workbook (inspection, QA, rules_notes, review sheets)
are intentionally **ignored**.

### Expected counts

- web **3937** + opinions **759** + annual **237** = **4933** content rows
  (before public exclusions).
- töövõidud enrichment: **76** rows → **0** new content rows.
- **Hard rule:** if the import creates **5009** content rows, the enrichment
  file was wrongly appended and the import is wrong.

## Why the töövõidud file is not appended

The 76 achievements already exist in the web file as
`source_layer=koda_achievement` / `source_type=toovoit` rows
(`ACH000001`-style IDs). The standalone enrichment file uses different
`A0001`-style IDs and `duplicate_risk=duplicate_if_appended_as_row`. It is
**left-joined** onto the canonical web achievement rows by a normalized title
key (not by source URL, because every achievement shares the same
*Meie töövõidud* page URL). The payload lands in the `AchievementEnrichment`
table — never as new content rows.

## Where to put the files

Drop the four `.xlsx` files in [`data/import/`](../data/import/) (git-ignored).
See [`data/import/README.md`](../data/import/README.md).

## Commands

```bash
# 1. Validate the workbooks (no database needed).
npm run import:validate

# 2. Deterministic checks (counts, enrichment matching, gating; no DB).
npm run import:test

# 3. Import into Postgres (validates first, then upserts).
npm run import:merge-ready

#    Variants:
npm run import:merge-ready -- --dry-run   # validate + write report, no DB writes
npm run import:merge-ready -- --force     # import despite validation warnings

# 4. Verify the database after import (fails on any invariant violation).
npm run import:verify-db
```

The importer is **idempotent**: content rows are upserted by `externalId`
(`WEB000001`, `OPINION-0001`, `AR-2014-001`, …), taxonomy tags by
`(type, slug)`, achievement enrichment by `contentItemId`, and evidence links
by `(from, to, linkType)`. Re-running changes nothing — a second run reports
`created=0 updated=4933` and the evidence-link / enrichment counts stay stable.

### Prerequisites for the actual DB import

1. A running Postgres and `DATABASE_URL` set (see `.env.example`; the Docker
   Compose flow provides `postgres`).
2. Schema applied: `npm run prisma:deploy` (production) or
   `npx prisma migrate dev` (development). The relevant migrations are
   `prisma/migrations/20260617120000_merge_ready_data_model` and
   `prisma/migrations/20260617130000_admin_override_fields`.

The merge-ready import does **not** require `npm run seed` — seed content is
demo-only. Run the import on a clean database (crawler/seed not required).

### Local verification without Docker/Postgres (incl. Windows on ARM)

The import was verified against a real database using **PGlite** (PostgreSQL
compiled to WebAssembly, in-process — no server, no Docker). Set
`KODA_DB_DRIVER=pglite` and the scripts run against a local PGlite DB in
`.pglite/` (git-ignored):

```bash
KODA_DB_DRIVER=pglite npm run db:setup:pglite      # apply migrations from zero
KODA_DB_DRIVER=pglite npm run import:merge-ready    # import
KODA_DB_DRIVER=pglite npm run import:verify-db      # verify invariants
```

`scripts/lib/prisma-client.ts` selects the driver: default = native engine over
`DATABASE_URL`; `KODA_DB_DRIVER=pglite` = PGlite adapter. Production is
unaffected.

> **Windows-on-ARM note:** Prisma ships no native ARM64 Windows query engine,
> so the Prisma-backed scripts (`import:merge-ready`, `import:verify-db`) must
> run under an emulated **x64 Node** on such machines, e.g.
> `path/to/node-x64/node.exe ./node_modules/tsx/dist/cli.mjs scripts/import-merge-ready.ts`
> (requires `@esbuild/win32-x64` installed alongside the arm64 build). The
> DB-free scripts (`import:validate`, `import:test`, `db:setup:pglite`) run on
> the native arm64 Node. On x64/Linux servers none of this applies.

### Verified results (live PGlite run)

- migrations apply cleanly from zero (4 migrations, 10 tables);
- import: **4933** content rows created, **0** from the enrichment file;
- achievement enrichment: **76/76** matched;
- second run idempotent: `created=0 updated=4933`, evidence links stable (261);
- `import:verify-db`: **17/17 invariants pass** — web 3937 / opinions 759 /
  annual 237, public 803 / hidden 4130, achievements 76, enrichment 76, evidence
  links 261 (duplicate_canonical 53 + annual_context 208), 0 review-public,
  0 do_not_import-public, 0 admin_only-public, 0 duplicates, 0 orphans.

## Source-owned vs admin-owned fields (import contract)

The merge-ready workbooks are the **source of truth** for everything the import
writes, and the import **overwrites those fields on every re-run**. Do not edit
them by hand expecting the edit to survive a re-import. Source-owned fields:

- `title`, `displayTitle`, `date`, `year`, `reportYear`
- `summary`, `excerpt`, `bodyText`
- `kodaPosition`, `companyRelevance`, `sourceEvidence`, `outcomeStatus`
- taxonomy tags (`valdkond` / `tegevusala` / `tapsustus`) from the merge filters
- `importStatus`, `publicDisplayStatus`, `needsHumanReview`, `reviewReason`
- `extractionQuality`, `mergeReadiness`, `mergeNotes`, `publicPriority`
- `isPublic` / `isHidden` (derived from the gating rules)
- `canonicalContentId`, `duplicateStatus`, source-layer/type fields

**Admin-owned fields are never written by the import** and survive re-imports:

- `manualWeight`
- AI fields (`embedding`, `aiSummary`, `aiRelevanceReason`, `aiKeywords`,
  `aiModel`, `aiLastGeneratedAt`, `aiReviewStatus`)
- topic-group memberships and non-import tag types
  (`sector` / `interest` / `activity` / `size` / `region` / `service`)
- the dedicated override fields:
  - `adminDisplayTitleOverride` — preferred over `displayTitle`
  - `adminSummaryOverride` — preferred over `summary`
  - `adminVisibilityOverride` — `null` = follow import gating, `true/false` =
    force public/hidden
  - `adminReviewNote`

Readers (search / ranking / UI) should prefer the override when set, e.g.
`adminDisplayTitleOverride ?? displayTitle`. Admin edits should target the
override fields, never the imported fields directly.

## Visibility / gating rules

The import is conservative. A row is eligible for normal public search
(`isPublic = true`, and `isHidden = false`) only when **all** hold:

- `import_status_merge == import_public_candidate`
- `needs_human_review_merge` is not true
- extraction quality is not `weak` / `failed` / `partial`
- `public_display_merge` is not `admin_only` / `hide_or_review`
- `merge_readiness` is not a review/hold value
- `duplicate_status` is not `possible_duplicate`

Everything else is **imported but hidden** (supporting evidence / context /
review / `do_not_import_yet`). Opinion-file rows are never public by default —
they are supporting evidence. With the current files this yields **803 public**
rows and **4130 hidden/supporting** rows.

## Schema additions

- `ContentItem` gains source-layer fields (`externalId`, `sourceDataset`,
  `sourceLayer`, `sourceTypeDetail`, …), status/gating fields
  (`importStatus`, `publicDisplayStatus`, `mergeReadiness`, `needsHumanReview`,
  `extractionQuality`, `isPublic`, …), evidence/relevance text
  (`kodaPosition`, `companyRelevance`, `sourceEvidence`, `outcomeStatus`) and
  duplicate linkage (`canonicalContentId`, `duplicateStatus`).
  `canonicalUrl` / `sourceUrl` are now optional.
- New enums `SourceDataset`, `EvidenceLinkType`; new `TagType` values
  `valdkond` (topic), `tegevusala` (sector), `tapsustus` (provisional detail).
  Imported taxonomy uses the cleaned `filter_*_merge` fields, not the old
  hardcoded `constants.ts` lists.
- New model `ContentEvidenceLink` (public result → supporting opinion / annual
  context / topic history / duplicate-canonical).
- New model `AchievementEnrichment` (1:1 with canonical achievement rows).

## QA report

After an import (or `--dry-run`) read:

- `data/import/reports/import-report.json` — machine-readable.
- `data/import/reports/import-report.md` — human-readable.
- `data/import/reports/validation-report.json` — written by `import:validate`.

The report includes row counts per source, total staged/imported, public vs
hidden/review counts, opinion/annual counts, canonical achievement count,
enrichment matches/failures, duplicate content-hash groups, invalid enum
values, missing required fields, public-rows-with-review-flags, and the final
PASS/FAIL status.

## Relationship to crawler and seed

- **Crawler** (`npm run crawl`) is legacy and is **not** the primary path for
  this v1 import. It refuses to run without `-- --legacy-ok` and
  `CRAWLER_ENABLED=true`. It writes rows without `externalId`/`sourceDataset`,
  so it does not collide with merge-ready rows, but it should not be used for
  production ingestion until modernized.
- **Seed** (`npm run seed`) is **demo content only** and is not required for the
  merge-ready import. Demo rows can be hidden/deleted in the admin once real
  data is imported.
- **Future compare-web command:** `import:compare-web` does not exist yet. The
  intended next step is a read-only comparison script that stages current
  merge-ready data and reports drift against a fresh web crawl/export without
  mutating the database.

## AI

AI remains **disabled and optional** (`AI_ENABLED=false`). The AI-ready fields
on `ContentItem` are untouched by this import.

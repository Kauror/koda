# Structured v0.9.4 import

This app now imports the structured v0.9.4/v0.9.1 Koda source package as the
authoritative content source. The crawler, seed data, old annual-report imports,
old v1 merge-ready workbooks, audit sheets, and repair sheets are not production
content sources.

## Active files

Place these files in `data/import/` locally, or in the Unraid runtime import
mount (`/mnt/user/appdata/koda/import`) on the server:

| File | Sheet used | Role | Rows |
| --- | --- | --- | ---: |
| `koda_web_content_v0_9_4_cleaned.xlsx` | `web_content_v0_9` | public/support/staging web content | 3804 |
| `koda_opinions_v0_9_1.xlsx` | `opinions_v0_9` | public/staging formal opinions | 759 |
| `koda_toovoidud_enrichment_v0_9_1.xlsx` | `toovoidud_v0_9` | achievement/value cards | 97 |
| `koda_taxonomy_rules_v0_9_1.txt` | n/a | taxonomy reference only | n/a |

Total content rows before public exclusions: **4660**.

## Public gates

The importer uses the explicit package flags:

- Web public rows: `import_action = import_public` and
  `public_display_allowed = TRUE`.
- Opinion public rows: `import_action = import_public` and
  `public_display_allowed = TRUE`.
- Toovoidud public rows: `import_action = enrichment_public` and
  `public_display_allowed = TRUE`.

Rows with `import_support_only`, `import_staging_only`,
`do_not_import_public`, `enrichment_hold`, `review_required`, or numeric-review
holds are imported but hidden from public results.

Confirmed law tags (`law_tags_confirmed`) are materialized as `oigusakt` tags
and can power public keyword/law searches. Candidate law tags are stored as
source metadata only and are not public filter tags.

## Replacement behavior

`npm run import:merge-ready` is now a replacement import:

1. Validate the workbooks and link sheets.
2. Create a JSON backup under `data/import/backups/`.
3. Clear active content/import tables (`ContentItem`, `TopicGroup`,
   `ContentTag`, `ContentEvidenceLink`, `AchievementEnrichment`).
4. Insert the v0.9.4/v0.9.1 package.
5. Write reports under `data/import/reports/`.

It intentionally avoids mixing old imported rows with the new structured
package.

## Commands

```bash
npm run import:validate
npm run import:test
npm run import:merge-ready
npm run import:verify-db
```

Local Windows/no-Postgres verification can use PGlite:

```bash
$env:KODA_DB_DRIVER='pglite'; npm run db:setup:pglite
$env:KODA_DB_DRIVER='pglite'; npm run import:merge-ready
$env:KODA_DB_DRIVER='pglite'; npm run import:verify-db
```

## Expected counts

| Metric | Expected |
| --- | ---: |
| Web rows | 3804 |
| Web public rows | 1530 |
| Web support-only rows | 1951 |
| Web staging-only rows | 246 |
| Web do-not-import-public rows | 77 |
| Opinion rows | 759 |
| Opinion public rows | 432 |
| Opinion staging-only rows | 327 |
| Toovoidud rows | 97 |
| Toovoidud public rows | 72 |
| Toovoidud held rows | 25 |
| Approved public relations | 95 |
| Approved admin/blocked relations | 170 |
| Candidate links | 288 |

## Reports

- `data/import/reports/validation-report.json`
- `data/import/reports/import-report.json`
- `data/import/reports/import-report.md`

The import report records the backup path, row counts, public counts, held and
staging counts, link counts, law-search counts, and validation errors.

## Admin dataset status page (`/admin/status`)

For launch safety, the protected admin page **`/admin/status`** surfaces which
dataset is live and whether it imported cleanly. It combines two sources:

- **Active package** — read from `data/import/reports/import-report.json`
  (written by the importer): package kind/timestamp, input file names, final
  PASS/FAIL status, imported/public/held row counts, link counts, per-dataset
  `import_action` counts and any import errors. Absolute paths are reduced to
  file names, so no server paths leak.
- **Database now** — live counts queried at request time: total ContentItem
  rows, public-by-gate (`publicDisplayAllowed=true` AND a public `import_action`),
  numeric-review holds, law-search-allowed rows, breakdowns by `import_action`
  and `sourceDataset`, and the last update time.

Both halves degrade gracefully: a missing report shows a "run the import" hint,
and an unavailable database shows a notice rather than crashing. The pure
report-to-view mapping is covered by `npm run admin-review:test`.

# v1 app-import

This app imports the **v1 Koda app-import package** as the authoritative content
source. The crawler, seed data, old annual-report imports, old v0.9.x / v1
`*_merge_ready` workbooks, audit sheets and repair sheets are **not** production
content sources.

## Active files

Place these files in `data/import/` locally, or in the Unraid runtime import
mount (`/mnt/user/appdata/koda/import`) on the server:

| File | Import sheet | Excluded/review sheet | Role | Import rows |
| --- | --- | --- | --- | ---: |
| `koda_opinions_v1.0.xlsx` | `opinions_app_import` | `excluded_rows` | what Koda said | 750 |
| `koda_web_content_v1.xlsx` | `web_app_import` | `web_excluded_review` | what publicly happened / was explained | 1131 |
| `koda_toovoidud_v1.xlsx` | `toovoidud_app_import` | `toovoidud_excluded_review` | what changed for companies | 90 |
| `koda_content_links_v1.xlsx` | relation workbook (see below) | — | cross-layer links / manifest / smoke test | — |
| `koda_taxonomy_rules_v1_0.txt` | n/a | n/a | taxonomy rulebook (reference only) | n/a |

Total importable content rows: **1971**. Excluded/review rows (web 1, opinions
9, töövõidud 7) are never imported as public content.

## Field mapping (alias-based)

Column names can drift slightly between producer revisions, so every read goes
through alias helpers in `scripts/lib/merge-ready.ts`:

- `firstPresent(row, [aliases])` — first non-empty value among aliases;
- `requiredField(row, [aliases], context)` — fails fast with a clear error if a
  genuinely required public field (id / title / summary) is missing;
- `parseBoolFlexible(value)` — TRUE/True/1/yes/jah;
- `parseDateFlexible(value)` — ISO / dotted EE / year-only / Date.

Key v1 mappings and decisions:

- **Opinions** public summary = `public_summary` (the slim sheet's
  `executive_summary_ee_final`), never `first_substantive_paragraph`. Recipient
  comes from `recipient` / `recipient_filter_group` / `recipient_type`.
- **Web** public summary = `app_public_summary_ee` (never `lead_text` /
  `first_substantive_paragraph`). Activity tags come **only** from the curated
  `public_activity_filter_tags`; rows the producer intentionally cleared (e.g.
  organization news such as the Oliver Väärtnõu appointment,
  `public_sector_page_allowed=FALSE`) therefore get **no** sector relationship.
  Visibility/ranking fields (`content_role_final`, `recommended_app_visibility_final`,
  `sector_result_eligibility`, `general_search_eligibility`,
  `public_sector_page_allowed`, `public_sector_rank_score`,
  `general_search_rank_score`) are stored on `ContentItem`.
- **Töövõidud** title = `work_win_title_public` → `public_title` → `title`;
  summary = `work_win_summary_ee`; value fields `what_changed_ee` / `koda_role_ee`
  / `business_value_ee` / `before_after_ee` are stored on `ContentItem`. The
  display date = `display_date` + `display_date_precision` / `date_confidence` /
  `date_basis`. `effective_date` and `deadline_date` are stored separately and
  are **never** treated as the achievement/display date.

## Public gate (v1)

A row is public when:

1. it is in the official import sheet;
2. the layer import flag is TRUE — `final_app_import_eligible` (opinions),
   `final_web_import_candidate` (web), `work_win_import_candidate` /
   `final_work_win_import_candidate` (töövõidud);
3. it is not in the corresponding excluded/review sheet (guaranteed — those
   sheets are never staged as content);
4. a public summary exists;
5. no explicit human-review flag is set.

`numeric_claim_needs_review` is a producer-side diagnostic, **not** a publish
blocker in v1: the layer import flag already incorporates it, so import-sheet
rows are public. With the v1 package all **1971** importable rows are public
(web 1131 + opinions 750 + töövõidud 90); opinions are a first-class public layer
("Koja seisukohad").

Confirmed law tags (`law_tags_confirmed`) become `oigusakt` tags and power
public keyword/law search. Candidate law tags are source metadata only.

## Cross-layer relation layer

`koda_content_links_v1.xlsx` is the relation workbook. Only
**`public_related_links`** creates public "Veel samal teemal" / evidence links,
mapped to `ContentEvidenceLink` with the relation metadata (`relationLabelEt`,
`linkConfidence`, `linkBasis`, `canonicalPolicyThreadId`, `sortPriority`) and a
`linkType` derived from the target layer (`related_opinion` / `related_news` /
`related_work_win`). The other sheets (`cross_layer_links`, `policy_threads`,
`candidate_or_review_links`, `blocked_or_rejected_links`,
`missing_or_excluded_targets`, `cross_layer_smoke_test`) are validation/reporting
only and are **never** imported as public relations.

Public links must point only to imported content, never to excluded/review rows,
and have acceptable confidence (`high` or `curated_medium`). The exact public-link
count comes from the workbook and is not hard-failed unless the workbook's own
`cross_layer_smoke_test` reports a blocker.

Policy-thread identity is preserved via `canonicalPolicyThreadId` on töövõit
content and on every imported link. TODO: import `policy_threads` as a
first-class structure so a single thread can be navigated across opinion / news /
töövõit.

## Replacement behavior

`npm run import:merge-ready` is a replacement import:

1. Validate the workbooks and link sheets.
2. Create a JSON backup under `data/import/backups/`.
3. Clear active content/import tables (`ContentItem`, `TopicGroup`,
   `ContentTag`, `ContentEvidenceLink`, `AchievementEnrichment`).
4. Insert the v1 package and the public related links.
5. Write reports under `data/import/reports/`.

Source-owned fields are overwritten on every run; admin-owned fields
(`manualWeight`, AI, `admin*Override`) are not written by the importer.

## Commands

```bash
npm run import:validate
npm run import:test
npm run prisma:deploy
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
| Web import rows | 1131 |
| Opinion import rows | 750 |
| Töövõit import rows | 90 |
| Total importable rows | 1971 |
| Public rows | 1971 |
| Web excluded/review rows | 1 |
| Opinion excluded/review rows | 9 |
| Töövõit excluded/review rows | 7 |
| Public related links | from workbook (≈182; informational, not hard-failed) |
| Töövõit enrichment rows | 90 |

## Validation rules

`npm run import:validate` checks: required files/sheets exist; import row counts
match expected v1 counts (excluded counts warn); no import-sheet row has a FALSE
import flag; excluded rows are not in the import sheets; required public summary
fields are non-empty; web summaries have no raw date fragments (warning);
display tags never contain `Kõik tegevusalad / valdkondadeülene`; töövõit date
regressions stay safe (panditulumaks ≠ 2026-06-24; börsiettevõtete soolise
tasakaalu ≠ 2026-12-31; 30.06.2026 stays a `deadline_date`); public related links
point only to imported, non-excluded content with acceptable confidence; the
cross-layer smoke test has no blocker FAIL rows; the taxonomy rulebook file
exists and is recorded.

## Reports

- `data/import/reports/validation-report.json`
- `data/import/reports/import-report.json`
- `data/import/reports/import-report.md`

The import report records input file names, sheets used, import/excluded row
counts by layer, public related link counts (with confidence breakdown),
candidate/blocked/missing link counts, smoke-test status, missing/invalid field
counts, public-safety blockers, warnings, and the final PASS/FAIL status.

## Admin dataset status page (`/admin/status`)

For launch safety, the protected admin page **`/admin/status`** surfaces which
dataset is live and whether it imported cleanly. It combines two sources:

- **Active package** — read from `data/import/reports/import-report.json`
  (written by the importer): package kind/timestamp, input file names, final
  PASS/FAIL status, imported/public row counts, link counts and any import
  errors. Absolute paths are reduced to file names, so no server paths leak.
- **Database now** — live counts queried at request time.

Both halves degrade gracefully. The pure report-to-view mapping is covered by
`npm run admin-review:test`.

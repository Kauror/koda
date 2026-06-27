# `data/import/` — v1 structured source files

This folder is the active local import source for the Koda public search app.
The **v1 data package** is the production source of truth. The workbooks
themselves are git-ignored local data files, but their expected names and sheets
are fixed by the importer (`scripts/lib/merge-ready.ts`).

## v1 app-import files

| File | Import sheet | Excluded/review sheet | Role | Import rows |
| --- | --- | --- | --- | ---: |
| `koda_opinions_v1.0.xlsx` | `opinions_app_import` | `excluded_rows` | what Koda said | 750 |
| `koda_web_content_v1.xlsx` | `web_app_import` | `web_excluded_review` | what publicly happened / was explained | 1131 |
| `koda_toovoidud_v1.xlsx` | `toovoidud_app_import` | `toovoidud_excluded_review` | what changed for companies | 90 |
| `koda_content_links_v1.xlsx` | (relation workbook — see below) | — | cross-layer links / manifest / smoke test | — |
| `koda_taxonomy_rules_v1_0.txt` | n/a | n/a | taxonomy rulebook (reference only, never imported) | n/a |

- **Total importable content rows = 1971.** Excluded/review rows are **never**
  imported as public content (web 1, opinions 9, töövõidud 7).
- The public gate is simple and authoritative: a row is public when it is in the
  official import sheet, its layer import flag is TRUE
  (`final_app_import_eligible` / `final_web_import_candidate` /
  `work_win_import_candidate`) and it has a non-empty public summary.
  `numeric_claim_needs_review` is a producer diagnostic, **not** a publish gate.

## Cross-layer relation layer (`koda_content_links_v1.xlsx`)

Only **`public_related_links`** creates public "Veel samal teemal" / evidence
links (mapped to `ContentEvidenceLink`). The other sheets are validation/
reporting only and are **never** imported as public relations:

`cross_layer_links`, `policy_threads`, `candidate_or_review_links`,
`blocked_or_rejected_links`, `missing_or_excluded_targets`,
`cross_layer_smoke_test`.

Public links must (a) point only to imported content, (b) never point to
excluded/review rows, and (c) have acceptable confidence (`high` or
`curated_medium`). The exact public-link count comes from the workbook itself
and is not hard-failed unless the workbook's own `cross_layer_smoke_test`
reports a blocker.

## Legacy / non-production

- The old **v0.9.x** workbooks (`koda_web_content_v0_9_*`, `opinions_v0_9_*`,
  `toovoidud_enrichment_v0_9_*`) and the `*_merge_ready.xlsx` files are **no
  longer the source of truth** and must not be copied back here for
  production/staging imports.
- The legacy crawler (`scripts/crawl.ts`) is **not** a production source and
  requires explicit opt-in.

Generated reports are written to `data/import/reports/`; pre-replacement JSON
backups are written to `data/import/backups/`. Both folders are git-ignored.

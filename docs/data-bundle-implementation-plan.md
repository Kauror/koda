# Data bundle implementation plan

## Scope

This plan covers a database-free data bundle builder for the five supplied merge-ready Excel workbooks in `data/import/`. It does not replace the current `import:merge-ready` path, run the crawler, write to the database, or change server deployment.

Current checkout inspected:

- Branch: `main`
- Latest pulled commit: `82ad24913300186b4cfd0d95e39512698abef943`
- Current import docs/scripts reviewed: `docs/import-merge-ready.md`, `data/import/README.md`, `scripts/lib/merge-ready.ts`, `scripts/validate-merge-ready.ts`, `scripts/import-merge-ready.ts`, `scripts/test-merge-ready.ts`, `scripts/verify-db.ts`
- Current data model reviewed: `prisma/schema.prisma`

## Supplied workbook inventory

| Workbook | Source sheet | Rows | Role in bundle | Audit / helper sheets |
| --- | ---: | ---: | --- | --- |
| `koda_web_index_v1_1_merge_ready.xlsx` | `web_merge_ready` | 3,937 | Main web content rows | `web_inspection`, `news_candidate_audit`, `news_promoted_public`, `news_kept_hidden`, `news_needs_manual_review`, `news_missing_from_index`, `news_field_change_log`, `web_v1_1_qa_report`, `rules_notes` |
| `koda_opinions_v1_merge_ready.xlsx` | `opinions_merge_ready` | 759 | Opinion/position content, mostly hidden or supporting by default | `opinions_inspection`, `opinions_normalisation_changes`, `opinions_blank_topic_review`, `opinions_multi_topic_review`, `opinions_merge_qa_report`, `opinions_rules_notes` |
| `koda_annual_reports_v1_merge_ready.xlsx` | `annual_reports_merge_ready` | 237 | Annual report context/content rows | `annual_inspection`, `annual_enum_mapping`, `annual_blank_topic_fixes`, `annual_merge_qa_report`, `annual_rules_notes` |
| `koda_toovoidud_enrichment_v1_merge_ready.xlsx` | `toovoidud_enrichment_ready` | 76 | Enrichment-only rows for achievement content | `toovoidud_inspection`, `toovoidud_join_keys`, `toovoidud_duplicate_warning`, `toovoidud_merge_qa_report`, `toovoidud_rules_notes` |
| `koda_taxonomy_unification_v1.xlsx` | Multiple rule sheets | n/a | Taxonomy, rules, and review candidates | `onenote_pages_raw`, `onenote_structure`, `web_index_crosswalk`, `manual_decisions`, `qa_report`, `rules_notes` |

Important filename note: the current import code hardcodes `koda_web_index_v1_merge_ready.xlsx`, while this bundle uses `koda_web_index_v1_1_merge_ready.xlsx`. The bundle builder should accept the v1.1 filename explicitly and leave the existing import path unchanged.

## Current import model

The existing merge-ready import path stages three content datasets and one enrichment dataset:

- Web content: `ContentItem` rows from `web_merge_ready`.
- Opinions: `ContentItem` rows from `opinions_merge_ready`, using file-based provenance rather than public URLs.
- Annual reports: `ContentItem` rows from `annual_reports_merge_ready`, with report/year/section provenance.
- Toovoit enrichment: `AchievementEnrichment` rows linked to existing achievement `ContentItem` rows.

The Prisma model already has fields that match the workbook metadata closely:

- Identity/provenance: `externalId`, `sourceDataset`, `sourceLayer`, `sourceTypeDetail`, `sourceUrl`, `canonicalUrl`, `sourceFileName`, `sourceSection`, `sourcePageLocation`, `reportYear`, `year`.
- Public/import status: `importStatus`, `publicDisplayStatus`, `mergeReadiness`, `mergeNotes`, `publicPriority`, `isPublic`, `needsHumanReview`, `reviewReason`, `extractionQuality`.
- Public content text: `title`, `displayTitle`, `bodyText`, `excerpt`, `summary`, `kodaPosition`, `companyRelevance`, `sourceEvidence`, `outcomeStatus`.
- Taxonomy snapshots: `primaryCategory`, `secondaryCategories`, `topicGroupCandidate`, `filterTegevusalad`, `filterValdkonnad`, `filterTapsustused`.
- Deduplication/linking: `duplicateStatus`, `canonicalContentId`, `canonicalContent`, `ContentEvidenceLink`.
- Enrichment: `AchievementEnrichment` with impact, affected companies/functions, regulatory area, Koda role, value type, and confidence fields.

## Proposed bundle files

Create a generated directory such as:

`data/import/bundles/koda_data_bundle_v1/`

Recommended files:

| File | Contents |
| --- | --- |
| `manifest.json` | Bundle version, generated timestamp, source workbook names, file hashes, source sheet names, source row counts, code commit, schema version. |
| `content_items.jsonl` | One row per web/opinion/annual content item. Expected initial count: 4,933. |
| `achievement_enrichment.jsonl` | One row per achievement enrichment. Expected count: 76. This must not create public content rows by itself. |
| `evidence_links.jsonl` | Canonical, duplicate, supporting-source, and annual-context relationships where references are resolvable. |
| `taxonomy.json` | Canonical valdkonnad/categories, slugs, scopes, include/exclude examples from taxonomy authority sheets. |
| `taxonomy_rules.json` | Topic terms, sector relevance rules, and crawler classification rules. |
| `tag_dictionary.json` | Normalized `valdkond`, `tegevusala`, and `tapsustus` values with slugs, source counts, aliases, and unknowns. |
| `review_candidates.jsonl` | Reclassification candidates and manual review candidates. These are suggestions only and must not be applied automatically. |
| `qa_report.json` | Validation summary, counts, missing-column warnings, enum warnings, enrichment match results, and bundle-build issues. |

## Source-to-bundle mapping

### Web index

`koda_web_index_v1_1_merge_ready.xlsx` / `web_merge_ready` maps to `content_items.jsonl`.

Use these fields as the primary source:

- ID/provenance: `content_id`, `source_layer_merge`, `source_type_merge`, `source_url`, `canonical_url`, `source_input_file`, `source_section`, `source_page_or_location`, `date`, `year`.
- Display/text: `source_title`, `cleaned_display_title`, `body_text`, `source_text_excerpt`, `short_summary_et`, `koda_position_or_impact_et`, `company_relevance_et`, `source_evidence`.
- Status: `import_status_merge`, `public_display_merge`, `needs_human_review_merge`, `merge_readiness`, `public_priority`, `extraction_quality`, `review_reason`.
- Taxonomy: `primary_category_merge`, `filter_valdkonnad_merge`, `filter_tegevusala_merge`, `filter_tapsustus_merge_provisional`, `topic_group_candidate`.
- Duplicate/canonical: `canonical_content_id`, duplicate-related fields where present.

### Opinions

`koda_opinions_v1_merge_ready.xlsx` / `opinions_merge_ready` maps to `content_items.jsonl`.

Opinion rows have no public URL columns in the inspected workbook. The builder should preserve file/hash provenance and keep these rows hidden or supporting unless a later admin workflow explicitly promotes them.

Use:

- `content_id`, `source_layer`, `source_type`, `file_name`, `file_hash`, `text_hash`, `date`, `year`, `recipient`.
- `cleaned_display_title`, `short_summary_et`, `koda_position_or_impact_et`, `company_relevance_et`.
- `import_status_merge`, `public_display_merge`, `needs_human_review_merge`, `merge_readiness`, `text_extraction_quality`.
- `filter_valdkonnad_merge`, `filter_tegevusala_merge`, `filter_tapsustus`, `primary_category`, `topic_group_candidate`.

### Annual reports

`koda_annual_reports_v1_merge_ready.xlsx` / `annual_reports_merge_ready` maps to `content_items.jsonl`.

Use:

- `content_id`, `source_layer`, `source_type`, `source_file`, `report_year`, `publication_year`, `document_role`, `source_section`, `source_page_or_location`.
- `source_title`, `cleaned_display_title`, `source_text_excerpt`, `short_summary_et`, `koda_position_or_impact_et`, `company_relevance_et`, `source_evidence`.
- `import_status_merge`, `public_display_merge`, `needs_human_review_merge`, `merge_readiness`, `extraction_quality`.
- `filter_valdkonnad_merge`, `filter_tegevusala_merge`, `filter_tapsustus`, `primary_category_merge`, `topic_group_candidate`.

### Toovoit enrichment

`koda_toovoidud_enrichment_v1_merge_ready.xlsx` / `toovoidud_enrichment_ready` maps to `achievement_enrichment.jsonl`.

Do not create standalone `ContentItem` rows from this sheet. Link enrichment rows to achievement content by stable keys:

- Preferred: workbook-provided URL/title keys if present.
- Fallback: normalized achievement title and source URL.
- Keep `toovoidud_join_keys` as validation/matching metadata.

Inspection result: 76 web achievement rows and 76 enrichment rows were found, with 76/76 matched by normalized title against the provided v1.1 web workbook.

### Taxonomy workbook

`koda_taxonomy_unification_v1.xlsx` is input for bundle taxonomy/rules and review metadata, not public content.

Map:

- `category_authority` -> `taxonomy.json`
- `topic_terms` -> `taxonomy_rules.json`
- `sector_relevance_rules` -> `taxonomy_rules.json`
- `crawler_classification_rules` -> `taxonomy_rules.json` or a `crawlerRules` section
- `reclassification_candidates` -> `review_candidates.jsonl`
- `web_index_crosswalk` -> optional QA/crosswalk diagnostics, not public content
- `manual_decisions` -> pending manual-decision input, not auto-applied

## `content_items.jsonl` shape

Recommended normalized fields:

```json
{
  "externalId": "WEB003251",
  "sourceDataset": "WEB",
  "sourceLayer": "koda_news",
  "sourceTypeDetail": "meie_uudis",
  "sourceUrl": "https://www.koda.ee/...",
  "canonicalUrl": "https://www.koda.ee/...",
  "title": "...",
  "displayTitle": "...",
  "date": "2024-01-01",
  "year": 2024,
  "reportYear": null,
  "sourceFileName": null,
  "sourceSection": "...",
  "sourcePageLocation": "...",
  "bodyText": "...",
  "excerpt": "...",
  "summary": "...",
  "kodaPosition": "...",
  "companyRelevance": "...",
  "sourceEvidence": "...",
  "outcomeStatus": "...",
  "importStatus": "import_public_candidate",
  "publicDisplayStatus": "main_result_candidate",
  "mergeReadiness": "ready_for_merge_public",
  "mergeNotes": null,
  "extractionQuality": "ok",
  "needsHumanReview": false,
  "reviewReason": null,
  "publicPriority": 80,
  "primaryCategory": "...",
  "secondaryCategories": ["..."],
  "topicGroupCandidate": "...",
  "valdkonnad": ["..."],
  "tegevusalad": ["..."],
  "tapsustused": ["..."],
  "canonicalContentId": null,
  "duplicateStatus": null,
  "isEvergreen": false,
  "isPublic": true,
  "language": "et",
  "contentHash": "..."
}
```

## Validation checks

The first implementation should fail clearly on structural problems and continue with warnings for review-only issues.

Required checks:

- All five expected workbooks exist in `data/import/`.
- Required source sheets exist.
- Row counts match the inspected bundle inputs: web 3,937, opinions 759, annual reports 237, enrichment 76.
- `content_items.jsonl` count is 4,933 before any optional filtering.
- Enrichment rows do not appear in `content_items.jsonl`.
- Required columns are present per source sheet.
- `content_id` / `achievement_id` values are present and unique within their expected scope.
- Enum-like fields use known values or are recorded in `qa_report.json`.
- Public gating preserves the existing `isPublic` / hidden behavior from the import path.
- Opinions without public URLs are not promoted to main public results automatically.
- Annual report rows keep report provenance and context display status.
- Enrichment matching reaches 76/76 or records every failed match.
- Canonical/evidence links only reference known bundle IDs.
- Tag fields are split, trimmed, normalized, slugged, and counted.
- Unknown taxonomy/tag values are included in `tag_dictionary.json` and `qa_report.json`.
- Reclassification candidates are exported as review candidates only, not applied.
- Manifest file hashes and row counts match the generated files.

## Risks and open questions

- The existing import path expects `koda_web_index_v1_merge_ready.xlsx`; the new bundle must accept `koda_web_index_v1_1_merge_ready.xlsx` without changing current import behavior.
- Opinion workbook rows have file/hash provenance but no public URLs. They should remain hidden/supporting by default.
- Taxonomy `reclassification_candidates` and `web_index_crosswalk` are suggestions/diagnostics, not final content.
- `manual_decisions` currently needs a defined approval workflow before it can affect content.
- Tag fields mix old, corrected, provisional, and merge-ready columns. The builder should prefer merge-ready columns and record fallback usage in QA.
- Slug collisions and semicolon/pipe-separated fields need deterministic normalization.
- Existing public visibility logic should be reused or mirrored, not reinvented.
- The first bundle schema version should be explicit so later importer changes can migrate cleanly.

## Recommended next implementation step

Add a database-free bundle skeleton:

- `scripts/lib/data-bundle.ts`
- `scripts/build-data-bundle.ts`
- package script: `data:bundle`

First milestone: read all five workbooks, accept `--web-file=koda_web_index_v1_1_merge_ready.xlsx`, and write only `manifest.json` plus `qa_report.json`. Once this validates filenames, sheets, row counts, hashes, and enrichment matching, add `content_items.jsonl`, taxonomy/rules exports, and review candidate exports in separate small steps.

## Step 2 Implemented: Manifest + Row-Count QA Skeleton

The first database-free bundle milestone is implemented as a local-only command:

```powershell
npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1
```

Generated files:

- `data/import/bundles/koda_data_bundle_v1/manifest.json`
- `data/import/bundles/koda_data_bundle_v1/qa_report.json`

This step validates:

- the five expected source workbooks exist in `data/import/`;
- required source sheets exist;
- source row counts are readable and compared with expected counts;
- SHA-256 hashes and file sizes are captured for provenance;
- base content count is checked as `4933 = 3937 web + 759 opinions + 237 annual`;
- the 76 toovoit enrichment rows are checked but not counted as content;
- basic title-based matching is attempted between enrichment rows and web achievement rows;
- taxonomy rule/review sheet counts are captured when available.

Intentionally not generated yet:

- `content_items.jsonl`;
- `achievement_enrichment.jsonl`;
- `taxonomy.json`;
- `taxonomy_rules.json`;
- `review_candidates.jsonl`;
- database imports, crawler output, or server/deployment changes.

Next small step: add `content_items.jsonl` generation for web, opinion, and annual source rows only, while keeping toovoit enrichment as a separate enrichment-only output.

## Step 3 Implemented: Content Items From Web, Opinions And Annual Rows

The bundle command now also writes normalized content rows:

```powershell
npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1
```

Generated content file:

- `data/import/bundles/koda_data_bundle_v1/content_items.jsonl`

Expected row count:

- 3,937 web rows from `web_merge_ready`;
- 759 opinion rows from `opinions_merge_ready`;
- 237 annual report rows from `annual_reports_merge_ready`;
- 4,933 total `content_items.jsonl` rows.

Validation checks added in this step:

- `content_items.jsonl` row count must be exactly 4,933;
- enrichment rows must not appear as content;
- duplicate `externalId` values fail validation;
- public web rows must have title and canonical URL;
- rows are counted by `sourceDataset`, `sourceLayer`, `sourceTypeDetail`, `importStatus`, and `publicDisplayStatus`;
- public, hidden/supporting, and review-needed row counts are reported;
- missing title/display title/canonical URL counts are reported;
- duplicate canonical/source URL counts are reported;
- unknown import/public-display statuses are reported;
- tag arrays are normalized and counted for `valdkonnad`, `tegevusalad`, and `tapsustused`;
- date/year normalization issues are reported without failing the run unless output would be unsafe.

Intentionally still not generated:

- `achievement_enrichment.jsonl`;
- `taxonomy.json`;
- `taxonomy_rules.json`;
- `review_candidates.jsonl`;
- bundle database import code;
- taxonomy reclassification application;
- crawler output, server changes, Docker commands, or deployment.

Next small step: add `achievement_enrichment.jsonl` as a separate enrichment-only file linked to achievement content rows from `content_items.jsonl`.

## Step 4 Implemented: Achievement Enrichment JSONL

The bundle command now writes achievement enrichment as a separate enrichment-only file:

```powershell
npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1
```

Generated enrichment file:

- `data/import/bundles/koda_data_bundle_v1/achievement_enrichment.jsonl`

Expected row count:

- 76 rows from `koda_toovoidud_enrichment_v1_merge_ready.xlsx` / `toovoidud_enrichment_ready`.

Matching logic:

- target rows come only from web content rows where `sourceLayer` is `koda_achievement` or `sourceTypeDetail` is `toovoit`;
- exact stable ID matching is attempted when a shared target ID is available;
- otherwise the builder uses conservative unique keys:
  - normalized title + source URL + year;
  - normalized title + source URL;
  - unique normalized title only;
- no fuzzy matching is used;
- unmatched rows stay in `achievement_enrichment.jsonl`, get `targetAchievementId: null`, and are marked for review.

Validation checks:

- `achievement_enrichment.jsonl` must contain exactly 76 rows;
- `content_items.jsonl` must remain exactly 4,933 rows;
- enrichment rows must not appear in `content_items.jsonl`;
- duplicate enrichment IDs fail validation;
- duplicate target matches, duplicate title keys, match method counts, match confidence counts, and review-needed counts are reported;
- matching by title/URL/year is reported as a warning because the workbook does not contain exact target web IDs.

Reminder: achievement enrichment rows are not content. They are additional metadata linked to existing web achievement rows.

Intentionally still not generated:

- `taxonomy.json`;
- `taxonomy_rules.json`;
- `review_candidates.jsonl`;
- bundle database import code;
- taxonomy reclassification application;
- crawler output, server changes, Docker commands, or deployment.

Next small step: generate `taxonomy.json` and `taxonomy_rules.json` from the taxonomy workbook without applying reclassification candidates.

## Bundle Outputs And Validator Completed

The local bundle generator now produces the planned database-ready JSON/JSONL artifact set from the Excel review workbooks:

```powershell
npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1
npm run data:validate-bundle -- --bundle=data/import/bundles/koda_data_bundle_v1
```

Generated files:

- `manifest.json`
- `qa_report.json`
- `content_items.jsonl`
- `achievement_enrichment.jsonl`
- `taxonomy.json`
- `taxonomy_rules.json`
- `review_candidates.jsonl`
- `tag_dictionary.json`

Expected row counts:

- content items: 4,933 total;
- web rows: 3,937;
- opinion/support rows: 759;
- annual/context rows: 237;
- achievement enrichment rows: 76, enrichment-only;
- taxonomy categories: 20;
- topic term rules: 20;
- sector relevance rules: 11;
- crawler classification rules: 22;
- review candidates: 1,159.

The validator checks:

- all expected bundle files exist and are readable;
- source workbook hashes exist in the manifest;
- content counts and source dataset distribution match expectations;
- achievement enrichment remains separate from content;
- review candidates are not applied automatically;
- taxonomy and taxonomy rules are non-empty;
- tag dictionary is non-empty;
- duplicate external IDs, duplicate canonical URLs, public web rows missing titles, and public web rows missing canonical URLs are reported;
- invalid import/public-display statuses, date/year issues, empty tag arrays, suspiciously long tags, and opinion/annual missing canonical URLs are surfaced;
- IT/e-commerce, agriculture/environment, and AI substring leakage guards exist in taxonomy rules.

What the bundle is:

- a deterministic local artifact for review, QA, and a later staging import;
- a bridge from human-reviewed Excel workbooks to a safer PostgreSQL/Prisma import step;
- a place to preserve source row provenance, hashes, and validation reports.

What the bundle is not:

- not a production database import;
- not a crawler run;
- not a server deployment;
- not an automatic taxonomy reclassification;
- not a replacement for PostgreSQL as the runtime database.

Excel remains the review layer because people can inspect, correct, and approve taxonomy/content decisions there. PostgreSQL remains the runtime database because the public app needs indexed, queryable, relational data with stable import semantics and admin overrides.

Next recommended step before server deployment: design and test a local PostgreSQL/Prisma staging importer that reads this bundle, runs in a non-production database first, and produces a diff/verification report before any live import is considered.

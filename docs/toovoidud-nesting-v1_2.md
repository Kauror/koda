# Töövõidud nesting & timeline (taxonomy v1.2)

The v1.2 töövõidud package (`koda_toovoidud_v1_5_APP_IMPORT_SLIM.xlsx`,
`toovoidud_app_import`, **122 rows**) adds series / nested / timeline work-wins on
top of the original 90 curated cards. This document describes how they are
imported and displayed so series rows never look like duplicate standalone cards.

## Row model

Every töövõit import row carries:

| Field | Meaning |
| --- | --- |
| `row_origin` | `original_90_locked` (90) · `phase2_new_standalone` (18) · `phase2_series_nested` (14) |
| `display_type` | `standalone_card` · `nested_under_existing_card` · `nested_under_new_series_card` · `timeline_item_in_policy_thread` |
| `parent_toovoit_id` | external id of an existing **original-90** parent card |
| `parent_candidate_id` | new Phase 2 series/backfill parent (may be a thread key, not an imported id) |
| `policy_thread_key` | stable key grouping a policy-thread timeline |
| `policy_thread_title` | readable thread name |
| `timeline_year` / `timeline_stage` | position on the policy thread's timeline |

These map 1:1 onto nullable `ContentItem` columns (migration
`20260628120000_toovoidud_nesting_v1_2`). Legacy töövõit files without the columns
default to `standalone_card` / `original_90_locked`, so old data still imports as
plain top-level cards.

## Import (`scripts/lib/merge-ready.ts`, `scripts/import-merge-ready.ts`)

- Reads only `toovoidud_app_import`. `toovoidud_excluded_review` and
  `news_only_recommendations` are **never** imported as töövõidud.
- Imports rows where `import_ready = TRUE` and `review_required = FALSE`
  (all 122 qualify); preserves all nesting fields.
- Validation **fails loudly** (hard error) on: an unknown `display_type` /
  `row_origin`; a `phase2_series_nested` row left as `standalone_card`; a
  `parent_toovoit_id` that matches no imported top-level töövõit; a nested row with
  neither a parent nor a policy thread; a `news_only_recommendations` id leaking
  into the import sheet; or the origin counts drifting from 90 / 18 / 14.

Run: `npm run import:validate` (no DB) → `npm run import:merge-ready` (replace) →
`npm run import:verify-db`.

## Nesting resolution (`src/lib/work-win-nesting.ts`, pure)

`resolveWorkWinNesting()` turns the flat rows into a display structure:

- **top-level** = `standalone_card` rows (108).
- a nested row attaches, in order, to: its `parent_toovoit_id` card →
  a `parent_candidate_id` that resolves to a top-level card → otherwise its
  `policy_thread_key` group (a **policy-thread card**). A nested row that resolves
  to nothing is reported as `unresolved` (an import error).
- For the v1.5 data this yields **108 standalone cards + 7 policy-thread cards**
  (13 nested rows) **+ 1 child** folded under `TOOVOIT-0001`.

Timeline display order is **latest-first** (`compareTimelineDesc`): newest
`timeline_year` first, then the later `timeline_stage` first, then a stable id
fallback; rows with no year sink to the bottom. (`compareTimeline` keeps the
chronological/ascending order for the importer's validation.)

## Display (`src/lib/search.ts`, `tulemused`, `sisu/[id]`)

- The töövõit result group is built from top-level **units** (standalone/parent
  cards + synthetic policy-thread cards). The 14 series/nested rows are **never**
  emitted as flat top-level cards.
- A parent/thread card exposes its children in a compact, collapsible nested
  section that is **always collapsed by default** (initial load, topic/sector
  pages, search results, thread views) — the user expands it explicitly. The
  toggle is an Estonian control with a count: **“Näita seotud etappe · N seotud
  etappi”** for a parent card, **“Näita ajajoont · N ajajoone kirjet”** for a
  thread card. Each nested item shows title, year, stage label, a short summary
  and an `Allikas →` link, renders smaller than the parent, and links to its own
  `/sisu/[id]` page.
- **Pagination.** Each result group (`Töövõidud`, `Koja seisukohad`,
  `Koja uudised`, `Veel samal teemal`) renders through the `LoadMore` client
  component: ~10 cards initially, then **“Näita rohkem”** reveals the next ~10
  per click until all are shown. `LoadMore` is keyed by the active query, so
  changing the search/filter resets the visible count.
- **Search still finds nested rows.** A query that matches a nested row surfaces
  the parent/thread card that contains it, with the matched step highlighted —
  not a duplicate flat card. Nested rows remain directly reachable at their own
  detail page.
- The detail page of a parent shows its children; the detail page of a timeline
  member shows the full thread timeline with the current step marked.

Taxonomy is unchanged: no new public topics or sectors, and
`Kõik tegevusalad / valdkondadeülene` is never shown as a public display tag.

## Content links

The core nesting is driven entirely by the töövõidud import fields, so it does
**not** depend on the content-links workbook. The importer already maps relations
by target layer, so the new v1.4 relation types (`source_evidence`,
`parent_child_nested`, `same_policy_thread`, `timeline_sequence`,
`related_news_context`, `news_only_context`, `supporting_opinion`) do not break it.
When `koda_content_links_v1_4_BACKFILL_UPDATED.xlsx` is available, drop it into
`data/import/` — the importer prefers it automatically (see `FILES.links`).

## Tests

- `npm run nesting:test` — pure resolution unit tests (10).
- `npm run import:test` — counts (122 / 2003), origins (90/18/14), no duplicate
  ids, nested-have-parent-or-thread, news-only excluded, unknown `display_type`
  fails (41).
- `npm run verify:nesting` — PGlite end-to-end: browse shows 115 units and no flat
  nested card; parent exposes children; thread groups members; search surfaces a
  nested row in context; detail pages expose parent/children/thread (10).
  Run after `db:setup:pglite` + `import:merge-ready` with
  `KODA_DB_DRIVER=pglite KODA_PGLITE_DIR=.pglite-nesting`.

# Public topic filter — canonical taxonomy enforcement

## Root cause

The public `Teema / valdkond` filter was built **dynamically** from the distinct
`topic_primary` / `topic_secondary` values found on content rows:

- importer (`scripts/lib/merge-ready.ts` → `makeTaxonomy`) created a `valdkond`
  `Tag` for every distinct topic string in the package;
- `getFilterOptions()` (`src/lib/search.ts`) tallied every distinct `valdkond`
  tag on public-eligible rows and returned them all as filter options.

A prior fix (`taxonomy-split.ts`, commit `9ba0307`) repaired the `;`-for-`,`
corruption that doubled compound names, but it did **not** restrict the filter to
a canonical allowlist. So legacy/short aliases (`Eksport`, `Energia`,
`Digi, andmed`, `Riigikaitse`, …) and the internal-only topic
(`Õigusloome kvaliteet ja kaasamine`) still leaked into the public UI. There is
**no DB taxonomy/visibility table** — `valdkond` filters are just `Tag` rows.

## Authoritative source

`data/taxonomy/koda_taxonomy_rules_v0_9_1.txt` (taxonomy guide **v2.1.6**, data
package v0.9), section *2. AVALIKUD TEEMAD / VALDKONNAD*: **26 public topics** +
**1 internal-only** (`oigusloome_kvaliteet_kaasamine`, "Avalik filtris: ei,
internal-only"). The file is vendored into the repo so the canonical config is
version-controlled and testable.

## Fix

`src/lib/topics.ts` is the single source of truth, mirroring the taxonomy file:

- `TOPICS` — 26 public (fixed canonical order 1..26) + 1 internal-only.
- `PUBLIC_TOPIC_FILTERS` — the **only** source of public filter options
  (canonical id + label, canonical order). `slug` = canonical id (URL
  `valdkond=` value).
- `ALIAS_LABELS` + `canonicalTopicId()` — resolve canonical id / canonical label
  / `slugify(label)` DB slug / legacy alias (label or slug) → canonical id;
  unknown → `null`.
- `canonicalPublicValdkonnad()` — normalize a row's tags to canonical **public**
  labels (drops unknown + internal-only) for public display.

Enforced at the public boundary (defence-in-depth, independent of data):

- `getFilterOptions().valdkonnad` (`src/lib/search.ts`) returns exactly the 26
  canonical public topics, in canonical order; counts are alias-folded.
- `scoreCandidate()` / topic matching (`src/lib/search-core.ts`) normalize both
  the selected filter id and the row's tags to canonical ids, so a canonical
  filter still matches rows tagged with an alias. **Sector / tegevusala and
  cross-sector (`Kõik tegevusalad / valdkondadeülene`) logic is unchanged.**
- Public detail page (`src/lib/content-detail.ts`) displays canonical public
  topic labels only; the related-content query still uses raw DB slugs.
- Importer (`scripts/lib/merge-ready.ts`) normalizes topic labels to canonical at
  staging and logs any unrecognised string (`unknownTopicLabels`) — kept
  internal, never a public filter.

## Tests

`npm run topics:test` (`scripts/test-topics.ts`, DB-free, 47 checks):

- A: public list == 26 canonical labels, in canonical order;
- B: none of the 14 legacy/alias/internal labels appear publicly;
- C: internal-only topic resolvable for admin but excluded from public filter +
  display;
- D + Eksport: full canonical visible, short alias normalized but hidden;
- E: selecting a canonical topic matches rows tagged with an alias;
- FILE: parses `data/taxonomy/koda_taxonomy_rules_v0_9_1.txt` and asserts
  `topics.ts` ids/order/visibility match it exactly (fails on drift).

`search:test` (81), `public-ui:test` (22), `tsc --noEmit` and `next build` are
green. `import:test` requires the v0.9.5 workbooks (not present in this
dev checkout) and is unaffected by this change.

## DB / cache / importer

No DB cleanup required: the public filter no longer reads stored tag
distinctness, so legacy `Tag` rows are inert and never surface. Re-running
`import:merge-ready` on the server will additionally normalize stored `valdkond`
tags to canonical labels (recommended, not required). No cache layer holds filter
options (computed per request).

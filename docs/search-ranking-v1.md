# Search & ranking (v1) — merge-ready Koda data model

This is the source-based search layer over the imported merge-ready data. It
replaces the old TopicGroup/`constants.ts`-driven search. The taxonomy now comes
entirely from imported DB tags, not the old hardcoded sector/interest lists.

Code map:

| File | Responsibility |
| --- | --- |
| `src/lib/eligibility.ts` | `isPublicSearchEligible()` — the one public gate (Prisma-free) |
| `src/lib/content-display.ts` | `publicTitle` / `publicSummary` / `publicUrl` (admin-override aware) |
| `src/lib/search-core.ts` | query parsing, candidate model, scoring, classification, badges (pure) |
| `src/lib/search.ts` | DB orchestration: fetch candidates, filter options, evidence, `search()` |
| `src/app/page.tsx`, `SearchForm.tsx`, `tulemused/page.tsx` | UI |

## Public eligibility rules

A row is a normal top-level public result only if `isPublicSearchEligible()`
returns true. Admin override is authoritative:

- `adminVisibilityOverride === false` → always hidden.
- `adminVisibilityOverride === true` → always eligible (admin explicitly
  approved; this is how a specific opinion can be surfaced).

Otherwise (default), **all** must hold:

- `isPublic === true`
- `isHidden !== true`
- `needsHumanReview !== true`
- `importStatus !== "do_not_import_yet"`
- `publicDisplayStatus` is not `admin_only` and not `hide_or_review`
- `sourceDataset !== "opinions"` (opinions are supporting evidence by default)

This yields **803** eligible rows (76 achievements, 695 public web, 108 annual;
0 opinions) — matching the import's `isPublic` count. The gate is redundant with
the import-time `isPublic` flag on purpose (defence in depth).

## Taxonomy mapping

Filters use imported tags, built dynamically from the DB (only tags with ≥1
eligible item are offered):

| Filter param | TagType | Merge field |
| --- | --- | --- |
| `valdkond` | `valdkond` | `filter_valdkonnad_merge` (16 topics) |
| `tegevusala` | `tegevusala` | `filter_tegevusala_merge` (sectors) |
| `tapsustus` | `tapsustus` | `filter_tapsustus_merge_provisional` (provisional) |

`getFilterOptions()` returns these with counts; `getTagsByType()` returns the raw
tag list (admin/debug).

## Query parameters

`/tulemused?...` and `/api/search?...` accept:

- `q` — free text (normalized lowercase matching)
- `valdkond` — comma-separated topic slugs
- `tegevusala` — comma-separated sector slugs
- `tapsustus` — comma-separated provisional slugs (lightly weighted, never required)
- `type` — one or more of `toovoit`, `arvamus`, `uudis`, `aastaaruanne`, `kontekst`

No sector (or any filter) is required. Empty search, query-only, and topic-only
all work. Legacy params (`huvid` / `sektor` / `tegevused`) are folded into `q`
for backward compatibility with old links.

Active filters are AND-combined (a result must match every active filter), except
`tapsustus`, which only boosts.

## Ranking factors

`scoreCandidate()` returns `text + filter + boost`:

**Text** (capped at 220): exact title = +120; title contains full query = +60;
per-token in title = +12; in summary/kodaPosition/companyRelevance = +8; in
source evidence/excerpt = +5; in body = +2. Title/summary/url use the admin
overrides first.

**Filter:** valdkond match +40 each (cap 2); tegevusala +28 each (cap 2);
tapsustus +8 each (cap 2).

**Boost:** achievement **+90** (headline result type), else
`main_result_candidate` +30, else public news/opinion +12, else `annual_context`
+8, else `topic_history` +4. Outcome: `achieved` +20, `partially_achieved` +14,
`ongoing` +10. Priority: high +15 / medium +6. `manualWeight × 10`. Evergreen +6.
Recency: small, capped at +10 (≤90 days), so a fresh low-value news row cannot
outrank a strong older töövõit.

**Dedup:** by `contentHash` (keep highest score, prefer canonical on ties) and by
`canonicalContentId` (drop a `possible_duplicate` when its canonical sibling is
present), so duplicates never appear as separate cards.

## Result grouping

`search()` returns three capped, independently-sorted groups:

1. **Töövõidud** — `sourceTypeDetail = toovoit` (cap 12)
2. **Koja seisukohad ja selgitused** — public web rows / public opinions (cap 15)
3. **Teema ajalugu ja taust** — annual reports + workgroup context (cap 10)

## Evidence behaviour

Opinions and other supporting rows are not primary cards; they back up public
results. For the displayed results, two batched queries produce lightweight
hints (no N+1):

- `ContentEvidenceLink` (annual context) → "Aastaaruande kontekst olemas".
- Hidden opinion rows sharing a `valdkond` tag (capped at 3) → "Lisaks N seotud
  allikat".

Full evidence detail (listing the actual linked rows on a detail/expandable
view) is deferred — only counts/flags are shown for now.

## Why opinions are supporting by default

The 759 opinion-file rows are mostly background/legal evidence and were imported
as `import_hidden` / `supporting_source` (0 public). Surfacing them all would
flood the result list, so they only appear as evidence for a public result —
unless an admin sets `adminVisibilityOverride = true` on a specific one.

## Deferred to future orders

- PostgreSQL full-text / trigram (or pgvector + semantic) search — the text
  scorer is isolated in `search-core.ts` for easy replacement.
- A public result detail page with full evidence listing.
- AI summaries/relevance (`AI_ENABLED=false`).
- Smarter Estonian stemming/typo tolerance.

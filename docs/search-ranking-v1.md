# Search & ranking (v1) — merge-ready Koda data model

This is the source-based search layer over the imported merge-ready data. It
replaces the old TopicGroup/`constants.ts`-driven search. The taxonomy now comes
entirely from imported DB tags, not the old hardcoded sector/interest lists.

Code map:

| File | Responsibility |
| --- | --- |
| `src/lib/eligibility.ts` | `isPublicSearchEligible()` — the one public gate (Prisma-free) |
| `src/lib/content-display.ts` | `publicTitle` / `publicSummary` / `publicUrl` (admin-override aware) |
| `src/lib/sector-relevance.ts` | conservative sector fallback rules and explanations (pure) |
| `src/lib/search-core.ts` | query parsing, candidate model, scoring, classification, grouping, badges (pure) |
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
- `publicDisplayAllowed !== false`

`numeric_claim_needs_review` is **not** a gate in v1 (it is a producer
diagnostic the layer import flag already cleared). The legacy v0.9.x
`import_action` / `publicDisplayStatus` string checks remain only as harmless
defence-in-depth — the v1 package never produces those blocking values.

With the **v1** package this yields **1971** eligible rows (web 1131, opinions
750, töövõidud 90) — matching the import's `isPublic` count. Unlike v0.9.x,
**opinions are a first-class public layer in v1** (the "Koja seisukohad" group),
not supporting-only. The gate is redundant with the import-time `isPublic` flag
on purpose (defence in depth).

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

**Filter:** valdkond match +40 each (cap 2); exact tegevusala +44 each (cap
2); related tegevusala topic fallback +14 each (cap 2), controlled sector
fallback +6, related keyword fallback +3 each (cap 2); tapsustus +8 each (cap
2).

**Boost:** achievement **+90** (headline result type), else
`main_result_candidate` +30, else public news/opinion +12, else `annual_context`
+8, else `topic_history` +4. Outcome: `achieved` +20, `partially_achieved` +14,
`ongoing` +10. Priority: high +15 / medium +6. `manualWeight × 10`. Evergreen +6.
Recency: small, capped at +16 (≤90 days), so a fresh low-value news row cannot
outrank a strong older töövõit.

Koda-owned news/progress rows (`meie_uudis` / `koda_news`) get an additional
boost only when they match the active query, topic, or sector. This keeps
relevant newer developments visible without letting unrelated news dominate.

**Dedup:** by `contentHash` (keep highest score, prefer canonical on ties) and by
`canonicalContentId` (drop a `possible_duplicate` when its canonical sibling is
present), so duplicates never appear as separate cards.

## Result grouping

`search()` returns four capped, independently-sorted groups:

1. **Töövõidud** — `sourceTypeDetail = toovoit` (cap 12)
2. **Koja seisukohad ja arvamused** — formal Koda positions/opinion articles (cap 15)
3. **Uudised ja arengud** — Koda.ee news/progress updates (cap 12)
4. **Teema ajalugu ja taust** — annual reports + workgroup context (cap 10)

The response distinguishes counts before and after caps: `totalMatchedBeforeCaps`
is the deduped matched set, `totalDisplayed` / `total` are rows shown after
per-group caps, and `groupCounts` reports `matched`, `displayed`, and `cap` per
group. Public UI copy must not present capped display counts as the full match
set.

News/progress rows are a first-class public value story: they often explain what
changed after a position, whether an issue moved forward, and what companies
need to know now. They are labelled as `Uudis` / `Koja uudis` and use the public
CTA `Loe uudist`, not opinion wording.

Tegevusala filters are conservative relevance filters. Exact sector
matches rank first and always pass. Rows can also pass through a small deterministic
sector-topic mapping when their imported `valdkond` / `tapsustus` tags or public
text clearly match the selected sector. Generic `Kõik tegevusalad /
valdkondadeülene` content can appear only when the mapping finds a related
topic/content signal; unrelated generic rows stay excluded.

Current fallback is narrower than ordinary text search: it normally applies only
to rows with no tegevusala tag or only the generic all-sectors tag. Rows tagged
to another specific sector do not pass a selected sector through fallback unless
a future mapping explicitly allows that cross-sector case. Fallback eligibility
uses high-signal fields: imported `valdkond` / `tapsustus` tags, public title,
display title and summary/admin summary. Lower-confidence fields such as
`companyRelevance`, `kodaPosition`, and `sourceEvidence` are shown in
`--explain` diagnostics, but do not by themselves make fallback eligible. Full
`bodyText` and long scraped excerpts are not used as sector fallback eligibility
signals.

The first mapped sectors are:

- `info-side-ja-it` (alias `info-ja-side-it`): IT, info ja side, software,
  digital services, digital identity, e-state/e-services where technology is
  central, data protection, cybersecurity, AI/tehisintellekt, algorithms,
  telecommunications/electronic communications, information security, and
  clearly technology-centric platforms. E-commerce, e-shops, consumer
  protection, trade/retail, packaging, waste, environmental/green claims,
  product labelling, goods destruction and ordinary sales-channel obligations
  are fallback exclusions unless the row has an exact Info/IT sector tag.
- `pollumajandus-metsandus-ja-kalandus`: agriculture, agriculture producers,
  forestry, fishing, and anchored food production/veterinary/land-use cases.
  Broad terms such as environment, permit, planning, land, food, packaging and
  waste are not enough on their own; fallback requires an agriculture, forestry
  or fishing anchor.

Extend the mapping in `getRelatedTopicsForSector(tegevusalaSlug)` in
`src/lib/search-core.ts` when another sector needs curated horizontal topics.
Add new mappings conservatively: start exact-only, list safe sector-specific
terms, add explicit fallback exclusions for neighbouring domains, and verify
with `npm run data:sector-audit -- --tegevusala=<slug> --explain` before
promoting broad terms.

## Evidence behaviour

Opinions and other supporting rows are not primary cards; they back up public
results. For the displayed results, two batched queries produce lightweight
hints (no N+1):

- `ContentEvidenceLink` (annual context) → "Aastaaruande kontekst olemas".
- Hidden opinion rows sharing a `valdkond` tag (capped at 3) → "Lisaks N seotud
  allikat" (mostly a no-op in v1, where opinions are public, not hidden).

## Related content ("Veel samal teemal") in v1

Related content on the detail page comes from **imported public related links**
(`koda_content_links_v1.xlsx` → `public_related_links` → `ContentEvidenceLink`),
ordered by the curated `sortPriority`, **not** from broad topic overlap. Each
target layer maps to a relation type (`related_opinion` / `related_news` /
`related_work_win`) and carries the producer label ("Koja seisukoht" / "Selgitav
uudis" / "Seotud töövõit"). The conservative law+topic+text fallback in
`related.ts` remains only as a secondary, strict signal.

## Opinions as a public layer (v1)

In v1 the **750** opinion rows are a first-class public layer (the "Koja
seisukohad" group), surfaced as the `arvamus` result group. Töövõidud keep the
strongest source boost so they are not outranked by generic newer web/news, and
recency only uses verified dates (the public-date gate), so placeholder/low-
confidence dates never buy a recency boost.

## Deferred to future orders

- PostgreSQL full-text / trigram (or pgvector + semantic) search — the text
  scorer is isolated in `search-core.ts` for easy replacement.
- A public result detail page with full evidence listing.
- AI summaries/relevance (`AI_ENABLED=false`).
- Smarter Estonian stemming/typo tolerance.
- Latest-news crawler/data freshness improvements when public Koda.ee contains
  newer news than the imported DB. Use `npm run data:freshness-audit -- --tegevusala=<slug>`
  or `npm run data:sector-audit -- --tegevusala=<slug>` to inspect read-only
  coverage before changing ingestion.

# Public trust/safety: dates, ranking, related content, recipient filters

Fixes for a public-facing trust/safety bug: the app showed misleading dates and
irrelevant related/news results, presenting uncertain data as confident fact.
All ranking/date/related fixes are at the service/display layer (no destructive
DB changes). Recipient filters add additive schema + import + query support.

## A. Work-win date safety gate — `src/lib/public-date.ts`

`computePublicDate()` is the single source of truth for public dates and for the
recency ranking signal. The stored `date` comes from the source `sort_date`,
which is often an import/placeholder value. The gate:

- shows an exact day only for a **verified** date (not future, not a 31.12
  year-end placeholder, not a known import/package date e.g. `2026-06-24`, and
  classification confidence not low);
- otherwise degrades to a trustworthy **year** (from `source_year` /
  `report_year`, or a strictly-past year-end placeholder);
- otherwise **suppresses** the date entirely rather than assert a wrong one.

Known import placeholder dates are configurable via
`KODA_IMPORT_PLACEHOLDER_DATES`. Wired into the results cards
(`ResultCard.displayDate`), the detail page and related rows
(`content-detail.ts`), replacing all raw date formatting on public pages.
Outcomes: TOOVOIT-0016 shows `2017` (or its verified day) — never `24. juuni
2026`; the soolise tasakaalu win never shows `31. detsember 2026`.

Schema note: ideally `ContentItem` would carry
`displayDatePrecision` / `dateConfidence` / `dateBasis`; until that migration,
the same values are derived at read time (`PublicDate`).

## B. Relevance-first ranking, verified recency — `src/lib/search-core.ts`

- Cross-sector fallback already ranks below primary/secondary activity matches
  (44 > 28 > 10); unchanged.
- Recency now uses **only a verified date**: placeholder/import/future dates no
  longer buy a recency boost (that was pushing uncertain rows to the top). A row
  that has a date which turns out suspicious gets a small penalty; a genuinely
  dateless row is neutral (so dateless töövõidud are not penalised). Tie-break
  ordering (`compareRankedCandidates`, law-aware `compareByDateThenScore`) also
  uses only the verified date.

## C. News threshold on activity pages — `src/lib/search.ts`

When a `Tegevusala` is selected, a "Koja uudised" row is kept only if it has a
real connection: exact/secondary sector, conservative sector-relevance, a topic
match, or a free-text match. News matching **only** via the cross-sector
fallback is dropped, so activity pages show fewer but relevant news instead of
being filled with unrelated cross-sector items (e.g. chemical safety / EU
anti-corruption under `haridus-ja-koolitus`; defense/youth-fund under
`pollumajandus-...`). Töövõidud/seisukohad keep their cross-sector fallback.

## D. Strict "Veel samal teemal" — `src/lib/related.ts` + `content-detail.ts`

The related list was built from broad topic overlap (any row sharing a topic
tag). It is now composed only from justified relations, in priority order:
1. explicit curated/cluster evidence links (approved web↔opinion,
   achievement↔matched article, duplicate↔canonical);
2. same policy thread (`canonical_policy_thread_id` / `topicGroupCandidate`);
3. same confirmed law tag **and** a shared narrow topic **and** strong
   title/summary text overlap (`qualifiesAsLawTopicRelation`).

Shared broad topic / activity / type / year alone is never enough — fewer or
zero related items is acceptable. TOOVOIT-0016 no longer lists youth work,
foreign labour, court proceedings or fuel excise.

## E. Recipient / ministry metadata filters

Additive `ContentItem` columns (`recipientRaw`, `recipientNormalized`,
`recipientFilterGroup`, `recipientType`, `recipientSecondary`,
`recipientNormalizationReviewRequired`) + migration
`20260625120000_recipient_metadata`. `src/lib/recipient.ts` normalizes
historical/abbreviated ministry names to a stable filter group (raw value always
preserved; unknown values flagged for review). The importer maps the
`recipient_*` columns (previously the recipient was mis-stored in
`sourceSection`). Search adds a `recipient` param + `recipients` filter options +
an advanced "Adressaat / ministeerium" filter in the form.

Recipient is **metadata only**: it never sets or overrides `topic_primary` and
contributes nothing to topic scoring; it only narrows results (AND constraint).
Rows without recipient stay searchable but don't appear under a recipient filter.
**Data population requires re-running the importer** on the server (the migration
applies via `prisma migrate deploy`).

## F. Defensive display

Satisfied by the gates above without weakening eligibility: suspicious dates are
suppressed/degraded; weak-activity news is dropped from activity pages; weak
related confidence is excluded from "Veel samal teemal".

## G. Tests

`npm run trust:test` (`scripts/test-trust-safety.ts`, DB-free, 21 checks) covers
the required cases: TOOVOIT-0016 date, soolise tasakaalu date, placeholder/future
date suppression, verified-recency ranking, cross-sector-below-direct,
news threshold, strict related exclusions (youth work / fuel excise / weak text),
recipient normalization + filter-group + metadata-not-topic. Existing suites stay
green: search 81, public-ui 22, activities 21, topics 47; `tsc` + `next build`
clean. `import:test` requires the v0.9.5 workbooks (absent in this checkout).

## Remaining data-level repairs

- Re-import on the server to populate recipient fields and re-derive dates.
- Source dates: where `sort_date` is a placeholder and no `source_year` exists,
  the date is suppressed; restoring real publication dates in the data package is
  the durable fix.
- Browser validation of the live detail/related/news behaviour is recommended
  once deployed (not runnable in this checkout: no Postgres + no v0.9.5 data).

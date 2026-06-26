# Koda app — file-by-file architecture

Read this when you need the full map. Paths are relative to the repo root.

## Public flow (request → result)

- `src/app/page.tsx` — homepage: tegevusala/valdkond filter chips + koda.ee links. Uses `getFilterOptions()` with a hardcoded fallback list when the DB is unavailable.
- `src/app/SearchForm.tsx` — client filter form; hides the generic "Kõik tegevusalad" option; submits comma-joined params to `/tulemused`.
- `src/app/tulemused/page.tsx` — results page. Calls `search()` + `getFilterOptions()` (both wrapped so a DB failure shows a friendly state, not a 500). Renders four sections: **Töövõidud**, **Koja seisukohad**, **Koja uudised**, **Veel samal teemal**. Cards show 2 then "Näita rohkem"; result cards show linked õigusakt tags (→ `/seadused/[slug]`).
- `src/app/sisu/[id]/page.tsx` — content detail; `getContentDetail()` re-checks eligibility (opinions/hidden → 404).
- `src/app/seadused/[slug]/page.tsx` — public law page; resolves the law from `law-dictionary`, runs `search(canonicalName)` (law-aware, newest-first), groups results.
- `src/app/api/search/route.ts` — JSON search API; preserves repeated query params as arrays; logs an anonymized `SearchSession`.
- `src/app/api/click/route.ts` — anonymous click logging (analytics; failures swallowed).
- `src/app/tulemused/TrackedLink.tsx` — external link that logs a click via `keepalive` fetch.

## Search/ranking core

- `src/lib/search.ts` (Prisma):
  - `fetchEligibleCandidates()` — `findMany` pre-filter (`isPublic` OR `adminVisibilityOverride`) then the TS gate decides.
  - `toCandidate(row)` — maps a ContentItem(+tags) to the pure `Candidate`; sets `oigusaktid`, `lawSearchAllowed`, and `activityPrimarySlug` (from `firstTopic(activity_primary)`).
  - `search(query)` — `detectLaw` recognition; per-candidate filter via `passesActiveFilters({ lawMatch, relaxLawGate })`; law-looking query with zero hits relaxes the gate (fallback to keyword search); law-recognized queries sort newest-first; dedupe; group with `GROUP_CAPS`; build evidence hints; `recognizedLaw` in the result.
  - `getFilterOptions()` — builds Teema/valdkond and Tegevusala options from the **canonical allowlists** (`topics.ts`/`activities.ts`), folding aliases into canonical ids for counts; plus the recipient options. Not from raw distinct content values.
- `src/lib/search-core.ts` (pure): `Candidate`/`ScoreBreakdown`/`SearchQuery` types (SearchQuery includes `recipient`); `parseSearchParams`; `scoreCandidate` (text + filter tiers + boosts); `passesActiveFilters`; `assignKind`/`primaryType`; cross-sector tiers (`primaryActivityMatch` +44 / exact +28 / `crossSectorMatch` +10); `isConservativeLawQuery`; `groupRankedCandidates`; `compareRankedCandidates`. `Candidate` also carries `year`/`reportYear`/`classificationConfidence`/`topicGroupCandidate`/`recipientFilterGroup`/`recipientNormalized`/`activityPrimarySlug`.
- `src/lib/topics.ts` / `src/lib/activities.ts` (pure): canonical public filter allowlists `PUBLIC_TOPIC_FILTERS` / `PUBLIC_ACTIVITY_FILTERS` + `canonicalTopicId` / `canonicalPublicActivitySlug` (alias → canonical). Source of truth for the public checkboxes.
- `src/lib/public-date.ts` (pure): `computePublicDate` — suppresses placeholder/import/future dates; cards render `displayDate`, not raw `date`.
- `src/lib/recipient.ts` (pure): recipient/ministry advanced filter helpers (`recipientFilterGroup`).
- `src/lib/related.ts` (pure): strict related-content selection for detail pages.
- `src/lib/sector-relevance.ts` (pure): conservative keyword/topic fallback for **no-sector** rows, with per-sector include/exclude/anchor needle rules (currently info-side-ja-it, põllumajandus…); `hasGenericSectorTag`, `sectorMatchesSlug`, `getSectorRelevanceExplanation`.
- `src/lib/law-match.ts` + `law-dictionary.ts` (pure): `detectLaw`, `extractLawMentions`, `lawMentionForSlug`, `rankLawContent`; 20-law dictionary with aliases/abbreviations/weak keywords + related valdkond.
- `src/lib/taxonomy-split.ts` (pure): `splitTopics` (repairs `;`-for-`,` in compound names; ";" before a lowercase word → ", "), `firstTopic`. Imported by both `scripts/lib/merge-ready.ts` and `src/lib/search.ts`.
- `src/lib/eligibility.ts` (pure): `isPublicSearchEligible`, `isEvidenceEligible`.
- `src/lib/content-display.ts` / `content-detail.ts` / `labels.ts` — public title/summary/CTA selection, clean-excerpt logic, detail assembly, Estonian labels.
- `src/lib/hash.ts` — `normalizeTitle`, `contentHash`, `urlHash`, anonymized IP/UA hashing.
- `src/lib/slug.ts`, `src/lib/db.ts` (Prisma client via pg adapter), `src/lib/constants.ts`.

## Admin area (`src/app/admin/(dash)/`)

`layout.tsx` enforces `isAdmin()` (cookie HMAC of `ADMIN_PASSWORD`) and renders the nav. Pages: `page.tsx` (landing tool list + dashboard), `content` / `content/[id]`, `content-items` (bundle browser, date filters), `data-bundle`, `data-review` / `data-review/[id]` (review decisions + progress + export), `taxonomy`, `laws`, `ingestion` / `ingestion/items`, `status` (active package + live DB counts), `site-texts`, `tags`, `topics`. Shared bits in `_components/` (`MissingBundleNotice`, `ReviewProgressCard`).

APIs (`src/app/api/admin/*`, all `requireAdmin` except login/logout): `login`, `logout`, `content/[id]`, `data-review/[id]`, `data-review/export`, `site-texts`, `tags`, `tags/[id]`, `topics`, `topics/[id]`.

Admin libs: `admin-bundle.ts` (read/filter the generated data bundle + `computeReviewProgress` + `buildCandidateDateMap`), `admin-dates.ts` (`extractItemDate`/`matchesDateFilter`/`compareItemDate`), `admin-status.ts` (`summarizeImportReport`), `admin-review-ui.ts` (copy + commands), `DataReviewDecision` model.

## Ingestion (`src/lib/ingestion/` + `scripts/ingest-koda-ee.ts`)

Manual, allowlisted (`www.koda.ee` /et/ only), staging-only — never publishes, never mutates `ContentItem`. `url.ts` (canonicalize/allowlist), `parse.ts` (cheerio, resilient, no script exec), `classify.ts` (reuses law-match), `koda-ee.ts` (`runIngestion`: discover → fetch → parse → classify → dedup decision → write `IngestionRun`/`IngestionStagingItem`; dry-run writes nothing), `staging-view.ts` (admin filter/sort). CLI: `npm run ingest:koda-ee -- --dry-run|--staging --limit=N`.

## Importer (`scripts/`)

- `scripts/lib/merge-ready.ts` — reads the v0.9.4 workbooks (`web_content_v0_9`, `opinions_v0_9`, `toovoidud_v0_9`) + link sheets; `stage*Row` mappers; `computeVisibility` (the importer's gate); `makeTaxonomy` (uses `splitTopics`); `splitMulti` (`;|` only, for non-topic multi-values like situation/law tags).
- `scripts/import-merge-ready.ts` — `npm run import:merge-ready [-- --dry-run|--force]`; backup → clear content tables → import → write `data/import/reports/import-report.{json,md}`. Materializes `Tag`/`ContentTag` via `slugify(name)` (same `slugify` the runtime uses, so `activityPrimarySlug` matches tag slugs).
- `scripts/lib/prisma-client.ts` — CLI Prisma client; `KODA_DB_DRIVER=pglite` path for local, server-less DB runs.
- `scripts/db-setup-pglite.ts` — apply all `prisma/migrations/*/migration.sql` to a fresh PGlite DB (migration sanity check).
- `scripts/crawl.ts` — legacy crawler, double-guarded (`--legacy-ok` + `CRAWLER_ENABLED=true`), never auto-runs; superseded by the ingestion pipeline. Do not run against the live site.

## Schema highlights (`prisma/schema.prisma`)

`generator.engineType = "client"` (engine-free). `ContentItem` carries both legacy fields and the v0.9.4 gate fields (`importAction`, `publicDisplayAllowed`, `publicDisplayStatus`, `publicDisplayRole`, `numericClaimNeedsReview`, `lawSearchAllowed`, `topic/activity Primary/Secondary`, `sectorScope`, `situationTags`, `lawTagsConfirmed/Candidate`, plus admin override fields). `TagType` adds `oigusakt`. `SourceDataset` adds `toovoidud`. Other models: `ContentEvidenceLink`, `Tag`/`ContentTag`, `TopicGroup`, `SiteText`, `DataReviewDecision`, `IngestionRun`/`IngestionStagingItem`, `AchievementEnrichment`. Migrations are additive; never `migrate reset` app data.

## Test files

`scripts/test-search.ts` (search-core + eligibility + sector/cross-sector + law + splitTopics), `test-public-ui.ts`, `test-site-texts.ts`, `test-admin-data-review.ts` (admin-bundle + status + route-guard + PGlite integration), `test-ingestion.ts` (ingestion pure + PGlite integration). Pattern: a local `check(name, fn)` runner, synthetic `cand()`/fixtures, `process.exitCode = 1` on failure.

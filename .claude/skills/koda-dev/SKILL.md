---
name: koda-dev
description: >-
  Orientation + working guide for the Koda search/admin app (Eesti
  Kaubandus-Tööstuskoja liikmeväärtuse tööriist; github.com/Kauror/koda; the
  Next.js/Prisma/Postgres app behind koda.orgusaar.ee). Use this whenever working
  in this repo or on anything Koda-specific: public search, result grouping
  (Töövõidud / Koja seisukohad / Uudised / Taust), the v1 app-import + import-flag
  visibility gates (final_*_import_candidate / final_app_import_eligible), eligibility, tegevusala
  /valdkond /tapsustus /õigusakt tags, cross-sector "Kõik tegevusalad" logic,
  law/õigusakt search, /seadused pages, the /admin/* tools, koda.ee ingestion,
  the merge-ready importer, or running its tests/build. Read it before editing so
  you don't re-derive the architecture, re-break the public gate, or miss the
  Windows/DB and private-data gotchas.
---

# Koda search/admin app — working guide

Public tool that helps Estonian companies see what the Chamber (Koda) has done
for their sector: work wins, opinions, news, and topic history. Next.js 15 (App
Router) + Prisma 6 + PostgreSQL, Estonian UI. Repo: `github.com/Kauror/koda`,
default branch `main`.

## First moves in a session

1. Work from the latest `main`: `git fetch origin && git checkout main && git pull --ff-only origin main`. Never `git reset --hard`; if origin moved past local uncommitted work, snapshot it on a branch first (`git checkout -b wip/...; git add -A; git commit`) then ff `main`.
2. `npx prisma generate` if the schema changed since last checkout.
3. Commit/push **only when the user asks** (they typically say "commit"/"push to main"). End commit messages with the `Co-Authored-By: Claude ...` trailer. The user's pattern is to work on `main` directly and push there.

## Verify everything with these (they all run without a live DB)

```bash
npx tsc --noEmit
npm run search:test        # pure search/ranking + eligibility + law + cross-sector + splitTopics
npm run public-ui:test     # source-level UI assertions + content-display helpers
npm run site-texts:test
npm run admin-review:test   # admin-bundle filters, progress, status summary, route-guard, PGlite integration
npm run ingest:test         # ingestion (pure + PGlite integration)
npm run build
```

The tests are home-grown (`scripts/test-*.ts` via `tsx`, no framework) — each prints `[test] N passed, M failed`. Most logic lives in **pure** functions in `src/lib/*` so it's testable with plain objects; add cases to the matching `scripts/test-*.ts`. To prove a migration applies cleanly: `KODA_DB_DRIVER=pglite KODA_PGLITE_DIR=.pglite-verify npm run db:setup:pglite` then `rm -rf .pglite-verify`.

## Architecture map (where things live)

Read `references/architecture.md` for the full file-by-file map. The essentials:

- **`src/lib/eligibility.ts`** — the public gate. `isPublicSearchEligible()` is the single source of truth for "may this row be a public top-level result." Don't re-introduce source-type inference.
- **`src/lib/search-core.ts`** — pure scoring/grouping/filtering. `Candidate`, `scoreCandidate`, `passesActiveFilters`, `assignKind` (→ `toovoit`/`arvamus`/`uudis`/`kontekst`), cross-sector tiers, `isConservativeLawQuery`.
- **`src/lib/search.ts`** — Prisma orchestration: `fetchEligibleCandidates`, `toCandidate`, `search()` (law recognition, newest-first for laws, empty-result law fallback), `getFilterOptions`, `ResultCard`/`SearchResults`.
- **`src/lib/sector-relevance.ts`** — conservative keyword sector fallback for **no-sector** rows; `hasGenericSectorTag`.
- **`src/lib/topics.ts` / `activities.ts`** — canonical public filter allowlists (`PUBLIC_TOPIC_FILTERS` = the fixed valdkond list; `PUBLIC_ACTIVITY_FILTERS` = the 12 business sectors) + `canonicalTopicId`/`canonicalPublicActivitySlug`. The public Teema/Tegevusala filters are built from these allowlists (aliases fold into canonical ids), NOT from raw distinct content values — this is what keeps the filter lists clean (don't revert to dynamic distinct values).
- **`src/lib/public-date.ts`** (`computePublicDate`) — public date safety gate: placeholder/import/future dates are suppressed. Cards expose `displayDate`; never format `card.date` raw in public UI.
- **`src/lib/recipient.ts`** — recipient/ministry advanced metadata filter (`recipientFilterGroup`); `SearchQuery.recipient`, `FilterOptions.recipients`.
- **`src/lib/related.ts`** — strict related-content selection for detail pages.
- **`src/lib/law-match.ts` + `law-dictionary.ts`** — õigusakt detection (20-law dictionary) for recognized-law search + result-card law tags.
- **`src/lib/taxonomy-split.ts`** — `splitTopics`/`firstTopic`; repairs the `;`-for-`,` corruption in compound topic/activity names. Shared by importer and runtime.
- **`src/lib/admin-dates.ts`**, **`admin-bundle.ts`**, **`admin-status.ts`**, **`admin-review-ui.ts`** — admin tooling helpers.
- **`src/lib/ingestion/*`** — koda.ee ingestion (allowlist, parse, classify, orchestrator, staging-view).
- **`scripts/lib/merge-ready.ts` + `scripts/import-merge-ready.ts`** — the v1 app-import importer (opinions/web/töövõidud slim sheets + `koda_content_links_v1.xlsx` public_related_links). Writes `data/import/reports/import-report.json`.
- **Pages**: public `src/app/{page,tulemused,sisu/[id],seadused/[slug]}.tsx`; admin under `src/app/admin/(dash)/*` (landing, content, content-items, data-bundle, data-review[/id], taxonomy, laws, ingestion[/items], status, site-texts, tags, topics). APIs under `src/app/api/`.

## Data model & visibility (the load-bearing mental model)

The v1 package is **layered**: `web` (news/background/public web), `opinions` (official positions — **public** in v1), `toovoidud` (value cards / what changed for companies). Keep these roles visible in the UI; a töövõit is not a normal news card.

**Visibility is an explicit per-row gate, never inferred.** Public = the importer's `isPublic` (computed in `computeVisibility`) AND it survives `isPublicSearchEligible`, which blocks on: `importAction` ∉ {`import_public`,`enrichment_public`}, `publicDisplayAllowed !== true`, `needsHumanReview`, `numericClaimNeedsReview`, and blocking `publicDisplayStatus` (`support_only`/`numeric_review_hold`/`duplicate_only`/`source_quality_hold`/`blocked`/`admin_only`/`hide_or_review`/`review_required`). `adminVisibilityOverride` wins both directions. Internal states kept-but-hidden: `import_support_only`, `import_staging_only`, `do_not_import_public`, `enrichment_hold`.

**Tags** (Prisma `TagType`): `valdkond` (topic), `tegevusala` (activity/sector), `tapsustus` (situation), `oigusakt` (confirmed law). The generic tegevusala **"Kõik tegevusalad / valdkondadeülene"** means *cross-sector* — it must match **every** specific sector filter (ranked below exact matches via the primary/secondary/cross tiers in `scoreCandidate`). A row tagged for a *specific other* sector must NOT cross-leak.

**Public filters are canonical, not dynamic.** Teema/valdkond and Tegevusala checkboxes come from the fixed allowlists in `topics.ts`/`activities.ts` (counts fold aliases into canonical ids); the cross-sector label and internal-only topics are deliberately kept out of the checkboxes while still affecting ranking. Tegevusala is optional — searching by Teema alone is allowed. There's also an advanced **recipient** (ministry) metadata filter.

**Law search** is gated: public law matching uses confirmed `oigusakt` tags only when `lawSearchAllowed` (`lawHaystack`), and law-looking queries require a confirmed match — with a relaxed fallback to normal keyword search when nothing matches.

## Hard-won gotchas

- **No prod/server/DB access, and no live crawl.** Don't deploy, don't run the crawler against the live site, don't run destructive DB ops.
- **Private workbooks are gitignored.** `import:merge-ready`, `import:test`, `data:bundle` need the v1 `.xlsx` files in `data/import/` — absent in dev → report "requires private data files," don't fabricate. The importer already does backup → clear → import (repeatable replace) and writes `import-report.json` (the source for `/admin/status`).
- **Smoke-testing pages without a DB**: `npm run build`, then start with a throwaway env and curl, e.g. `APP_URL=http://localhost:3030 DATABASE_URL='postgresql://koda:koda@127.0.0.1:5432/koda' ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=test npx next start -p 3030`. Auth redirect (`/admin` → `/admin/login`) and DB-down-degrading pages work without a DB; pages that query Prisma will 500 unless a real DB is up. Log in via `POST /api/admin/login` (form-encoded email+password) to get the `koda_admin` cookie. Kill the port via PowerShell `Get-NetTCPConnection -LocalPort <p> | Stop-Process`.
- **Prisma engine**: the schema uses `engineType = "client"` (engine-free), so queries and the PGlite integration tests run even on the Windows dev box. (Older sessions hit `query_engine-windows.dll.node` errors — that's resolved by the client engine.)
- **Admin auth**: every `src/app/api/admin/*` route must call `requireAdmin`; admin pages are guarded by the `(dash)/layout.tsx` `isAdmin()` redirect. `login`/`logout` are intentionally open.

## Conventions

- Estonian, source-based UI copy. Conservative public gating; **never auto-publish**. Ingestion and review decisions are staging/review only — they never mutate live `ContentItem`.
- Keep new logic pure in `src/lib/*` and unit-test it; pages stay thin and degrade gracefully (try/catch around DB reads, friendly empty/error states, no leaked paths/stack traces).
- Persistent context across sessions also lives in the memory files named `koda-*` (e.g. `koda-search-ranking`, `koda-release-review`, `koda-merge-ready-import`) — check them too.

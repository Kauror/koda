# Local release check

Date: 2026-06-18

## Checked revision

- Branch: `main`
- Latest commit: `82ad249 Harden search cleanup and legacy crawler safety`
- Worktree: local release-prep changes are uncommitted.

## Commands run

```powershell
npx tsc --noEmit
npm run search:test
npm run public-ui:test
npm run site-texts:test
npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1
npm run data:validate-bundle -- --bundle=data/import/bundles/koda_data_bundle_v1
npm run build
```

## Results

- TypeScript check: passed.
- Search tests: passed, 60/60.
- Public UI tests: passed, 10/10.
- SiteText tests: passed, 6/6.
- Bundle generation: passed with warnings.
- Bundle validation: passed with warnings.
- Build: exited successfully.

Known local build warning:

- `npm run build` prints local Windows Prisma engine initialization warnings during route probing, but the command exits successfully. This is not a code-only deployment blocker for the Linux server target.

## Bundle validation summary

- `content_items.jsonl`: 4,933 rows.
- Web rows: 3,937.
- Opinion/support rows: 759.
- Annual/context rows: 237.
- `achievement_enrichment.jsonl`: 76 rows.
- Enrichment rows are not counted as content.
- `taxonomy.json`: 20 categories.
- `taxonomy_rules.json`: 20 topic rules, 11 sector relevance rules, 22 crawler classification rules.
- `review_candidates.jsonl`: 1,159 rows.
- `tag_dictionary.json`: 30 valdkonnad, 18 tegevusalad, 23 tapsustused.
- Reclassification candidates are review-only and were not applied to content rows.

Known bundle warnings:

- Some annual/opinion rows have null canonical URLs, expected for file-based sources.
- Achievement enrichment uses title/URL/year matching because exact target web IDs are not present in the enrichment workbook.
- Some optional enrichment fields are empty.
- Some content rows have empty tag arrays.

## Files changed since last step

- `.gitignore`
- `package.json`
- `docs/data-bundle-implementation-plan.md`
- `docs/local-release-check.md`
- `scripts/build-data-bundle.ts`
- `scripts/lib/data-bundle.ts`
- `scripts/validate-data-bundle.ts`

Generated local artifacts under `data/import/bundles/` are ignored and should not be committed. Source Excel workbooks under `data/import/*.xlsx` are also ignored.

## Safety checks

- The old crawler is legacy-only and refuses to run unless explicitly called with `npm run crawl -- --legacy-ok`; it also requires `CRAWLER_ENABLED=true`.
- No release check runs the crawler.
- No crawler output is mixed into the current bundle.
- The existing merge-ready Excel import path remains unchanged.
- The bundle generator and validator are database-free.
- No bundle import into PostgreSQL has been implemented.
- No bundle script runs during build or normal app startup.
- No production database credentials or server paths are hardcoded in the bundle scripts.
- Admin SiteText editing remains under the protected admin layout and API guard.

## Recommendation

Ready for code-only server deployment after committing and pushing the local code changes. Do not import the bundle into production yet.

Recommended later server order:

1. Code-only deploy.
2. Run app smoke checks.
3. Run search/sector audit on the server if available.
4. Do not import the bundle into production yet.
5. Add and test a separate local/staging bundle import task before any production data import.

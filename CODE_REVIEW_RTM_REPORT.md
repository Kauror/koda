# Koda Search RTM Review Report

Date: 2026-06-30
Repository: Kauror/koda
Branch: main

## 1. Scope

Performed a release-readiness / RTM review pass for the Koda public search app. The review focused on small, safe code-quality cleanup and verification only. No taxonomy, ranking strategy, data model, UI redesign, or import eligibility behavior was intentionally changed.

## 2. Git And GitHub State

- Remote: `origin https://github.com/Kauror/koda.git`
- Current branch: `main`
- Local HEAD: `163a6ba Combine public opinion and news results`
- `origin/main`: `163a6ba`
- Ahead/behind: `0 / 0`
- Open GitHub PRs: 0
- Open GitHub issues: 0
- GitHub workflows found: 0
- GitHub action runs found: 0
- GitHub CLI: not installed locally; GitHub checks were inspected through the GitHub REST API.

Review-start working tree:

- Tracked files were clean.
- Existing untracked local data artifacts were present and left untouched:
  - `data/import/koda_app_upload_cleaning_summary_v0_9_10.md`
  - `data/import/koda_data_package_v0_9_5_manifest.json`
  - `data/import/koda_toovoidud_industry_patch_v0_9_2_summary.md`
  - `data/packages/`

Final working tree after this review:

- Modified: `src/lib/search.ts`
- Added: `CODE_REVIEW_RTM_REPORT.md`
- The same pre-existing untracked local data artifacts remain untouched.

Recent commits:

- `163a6ba Combine public opinion and news results`
- `32d4607 Polish public work wins and admin taxonomy edits`
- `abac516 Remove result section counts`
- `2160d42 Refine public homepage and results copy`
- `118e930 Update homepage topic filters and work-win browser`

## 3. Check Matrix

| Check | Result | Notes |
| --- | --- | --- |
| `git fetch origin` | Pass | Remote state fetched successfully. |
| `git rev-list --left-right --count HEAD...origin/main` | Pass | `0 0`; local branch matched origin/main at review start. |
| `npm ci` | Pass | Installed 125 packages and audited 126 packages. Reported 3 vulnerabilities and deprecated `whatwg-encoding@3.1.1`. |
| `npm run build` | Pass | Prisma generate and Next.js 15.5.19 production build completed. |
| `npm run lint` | Blocked | `next lint` prompted interactively to configure ESLint. There is no repo ESLint config, so this is not currently CI-safe/non-interactive. Next also warns that `next lint` is deprecated in Next 16. |
| `npm run import:validate` | Fail - local data package mismatch | Validation ran, but local import files did not match expected v1.3 counts: toovoidud rows `90 != 122`, total importable rows `1849 != 1881`, phase2 standalone `0 != 18`, phase2 nested `0 != 14`, public related links `166 != 223`, policy threads `148 != 172`, public policy threads `140 != 172`. Report written under `data/import/reports/` (ignored). |
| `npm run import:test` | Fail - local data package mismatch | 31 passed, 10 failed. Failures match the same missing phase2/toovoidud/link/thread rows above; one mutation test had no matching row to mutate because the expected series/nested data is absent locally. |
| `npm run search:test` | Pass | 88 passed. |
| `npm run topics:test` | Pass | 47 passed. |
| `npm run activities:test` | Pass | 21 passed. |
| `npm run trust:test` | Pass | 25 passed. |
| `npm run public-ui:test` | Pass | 40 passed. |
| `npm run site-texts:test` | Pass | 6 passed. |
| `npm run admin-review:test` | Pass | 27 passed, 1 skipped. |
| `npm run nesting:test` | Pass | 11 passed. |
| `npm run ingest:test` | Pass | 19 passed. |
| `npx tsc --noEmit` | Pass | Extra TypeScript verification, no emit. |
| `npm audit --audit-level=high` | Fail | 3 vulnerabilities: `xlsx` high severity with no fix available; `postcss <8.5.10` moderate via Next. `npm audit fix --force` suggests a breaking/incorrect downgrade to `next@9.3.3`, so it should not be applied blindly. |
| `npm outdated` | Info / non-zero | Outdated packages include Prisma packages `6.19.3 -> 7.8.0`, Next `15.5.19 -> 16.2.9`, `pg 8.13.1 -> 8.22.0`, `@types/*`, `pglite-prisma-adapter`, TypeScript `5.9.3 -> 6.0.3`. |

## 4. Bugs Fixed / Cleanup Performed

- Removed an unused `canonicalPolicyThreadId` field from the combined opinion/news evidence-link query in `src/lib/search.ts`.
- This is a small performance and query-shape cleanup only. It does not change public result grouping, ranking, labels, taxonomy, or API response behavior.
- No behavior-changing bug fix was made because the review did not find a clear RTM-blocking product bug inside the scoped code path.

Post-patch verification:

- `npx tsc --noEmit` - pass.
- `npm run search:test` - pass, 88 passed.
- `npm run public-ui:test` - pass, 40 passed.
- `npm run build` - pass.

## 5. Performance Notes

- The public search flow builds combined "Koja seisukohad ja uudised" cards by querying evidence links for currently matched opinion/news rows. The cleanup reduces one unused selected column from that batched query.
- No broad performance rewrite was attempted. The existing approach is acceptable for the current result caps, but it should be watched if imported content volume grows significantly.

## 6. Dependency And Audit Notes

- `xlsx@0.18.5` is present as a dev dependency, but the Docker image intentionally installs dev dependencies for import/migration tooling, so the vulnerable package is present in the deployed container.
- The `xlsx` audit issue has no npm-provided fix. Practical mitigation is to keep XLSX import inputs trusted/admin-only, avoid exposing XLSX parsing to public upload paths, and plan a parser replacement or isolation pass.
- The `postcss` issue arrives through Next. Do not apply npm's force fix because the suggested downgrade to Next 9 is not a valid remediation for this app.
- Major upgrades to Next 16, Prisma 7, and TypeScript 6 should be handled as their own migration project with build/test/deploy validation.

## 7. Risks / Gaps

- No CI workflows exist in the repository. Release confidence depends on local/manual runs.
- `npm run lint` is not currently usable as a non-interactive release gate.
- Import validation and import tests cannot pass with the local import package currently present in `data/import`; the code may be fine, but the local data package is incomplete or stale versus the v1.3 expectations.
- The Docker image keeps dev tooling in production by design, which is useful for imports but increases dependency/audit surface.

## 8. RTM Verdict

NOT READY.

The application code builds, TypeScript checks pass, and the DB-free/public UI/search/topic/activity/trust/admin/nesting/ingestion tests passed. Public behavior from the latest combined opinion/news change is covered by tests and no immediate product-blocking regression was found.

The release process is not fully RTM-clean until:

- lint is made non-interactive and CI-safe,
- the correct v1.3 local import data package is supplied or validation expectations are intentionally updated,
- a dependency/audit mitigation plan is accepted for `xlsx`,
- minimal GitHub Actions CI is added.

## 9. Recommended Next Actions

1. Add a minimal GitHub Actions workflow after deciding which commands should gate PRs.
2. Replace `next lint` with a real ESLint setup or remove lint from the release gate until configured.
3. Re-run `npm run import:validate` and `npm run import:test` with the complete v1.3 import package.
4. Plan a small dependency hardening task for XLSX parsing and the Next/PostCSS advisory.

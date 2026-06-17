# Public detail page & evidence view (v1)

A clickable, source-based explanation page for a single public result, plus the
supporting evidence/context around it. Builds on the search/ranking layer
(`docs/search-ranking-v1.md`). No AI, no invented claims — everything shown comes
from imported fields.

## Route

`/sisu/[id]` — `[id]` resolves by **`externalId` first** (stable across
re-imports: `ACH000007`, `WEB000123`, `AR-2014-001`, …), falling back to the DB
`id`. Result cards link with `externalId ?? id`. Stable public identifiers are
preferred so links survive a DB reset + re-import.

Code:

| File | Responsibility |
| --- | --- |
| `src/app/sisu/[id]/page.tsx` | the page (server component, `force-dynamic`) |
| `src/lib/content-detail.ts` | `getContentDetail()`, `getEvidenceForContent()` |
| `src/lib/labels.ts` | Estonian source/outcome/dataset labels |
| `src/lib/eligibility.ts` | `isPublicSearchEligible` (direct access) + `isEvidenceEligible` |
| `src/lib/search-core.ts` | `rankRelatedOpinions()` |

## Direct-access rules

`getContentDetail(id)` loads the row and returns `null` (→ `notFound()` / 404)
unless `isPublicSearchEligible()` passes. So **hidden, supporting, opinion,
review, do-not-import and admin-hidden rows 404 on direct access**. Only the 803
public-eligible rows have their own page. Admin overrides are respected
(`adminVisibilityOverride === false` → 404; `=== true` → allowed).

## Page structure

1. **Header** — back link, töövõit/source badge + outcome badge, date/year,
   topic (`valdkond`) and sector (`tegevusala`) tags, title (admin override
   first).
2. **Summary** — `adminSummaryOverride || summary || companyRelevance ||
   kodaPosition || excerpt`.
3. **Achievement block** (achievements only) — from `AchievementEnrichment`:
   outcome, regulatory area, value type, Koda role, numeric impact statement,
   source-based evidence. Visually marked as a concrete töövõit.
4. **„Miks see ettevõtjale oluline on?"** — `companyRelevance` (existing field
   only; no generated claims).
5. **„Koja seisukoht ja mõju"** — `kodaPosition`, `sourceEvidence`, and an
   excerpt/body snippet only when no better field exists.
6. **Allikas** — source + dataset label, section, report year, source file,
   original `sourceUrl` ("Vaata allikat koda.ee-l →"), and the canonical URL when
   it differs.
7. **Seotud allikad ja taust** — evidence sections (below).
8. **Back/search links** — returns to the originating search via `?from=`.

## Source link behaviour

The detail page is the internal explanation; the **original Koda source URL is
always kept as a separate link** ("Vaata allikat …"), never replaced. Result
cards now show both: title + "Loe selgitust →" (internal detail) and "Vaata
allikat koda.ee-l →" (external source, click-tracked).

## Evidence retrieval & rules

`getEvidenceForContent(parent)` runs four batched queries (no N+1):

1. **Annual context** & **duplicate/canonical** — from `ContentEvidenceLink`
   (`annual_context`, `duplicate_canonical`), either link direction; the linked
   rows are loaded in one query.
2. **Supporting opinions** — hidden opinion rows (`sourceDataset=opinions`,
   `isPublic=false`) sharing ≥1 `valdkond` tag, ranked by shared topics + light
   text overlap (`rankRelatedOpinions`), **capped at 5**.
3. **Topic history** — other public, non-achievement rows on the same topic,
   oldest first, **capped at 4**.

Every evidence row must pass **`isEvidenceEligible`**: not admin-hidden, **not
`needsHumanReview`**, and **not `failed`/`weak` extraction** (conservative —
applies to linked rows too). Each evidence row shows its source label, title,
date and source URL.

### How hidden opinions are handled

Opinions are **supporting evidence only**. They appear under a public parent
labelled "Toetavad arvamused (toetav taustamaterjal, mitte eraldi avalik
tulemus)", are not linked to their own `/sisu` page (their direct URL 404s), and
the 215 review-flagged opinions are excluded entirely. An admin can still surface
a specific opinion as a real result via `adminVisibilityOverride = true`.

Evidence rows link to their own detail page **only** when they are themselves
public-eligible (computed from the full row, not the reduced candidate). Public
annual context rows therefore link through; hidden ones are shown as text only.

## Fields used for display

Title/summary/url go through `content-display.ts` (admin overrides first).
Internal/audit/debug fields (import status, merge readiness, content hash,
review reasons, confidence, extraction quality, raw body) are **not** rendered to
normal users.

## Wording / safety

Source-based phrasing only: "Allika põhjal", "Koja seisukoht", "Seotud allikad",
"Aastaaruande kontekst", "Toetavad arvamused". No certainty wording implying AI;
weak/failed-extraction rows never shown.

## Deferred

- Click tracking for internal detail navigation (only external source clicks are
  tracked today).
- Full evidence pagination / "show all related opinions".
- Richer body rendering (currently a guarded snippet only).
- `supporting_opinion` / `topic_history` explicit links in `ContentEvidenceLink`
  (currently topic-based at query time).
- PostgreSQL full-text/trigram for the opinion/topic match; AI summaries.

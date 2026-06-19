# Admin Data Review Tool

## Purpose

The admin data review tool lets authenticated Koda admins inspect the generated local data bundle online after deployment. It is for reviewing taxonomy, category, sector, tag and weight suggestions before any controlled data correction/import step.

The tool is deliberately non-destructive:

- it reads generated bundle files as read-only input;
- it stores review decisions in PostgreSQL;
- it does not edit `ContentItem` rows;
- it does not modify generated JSONL files;
- it does not modify source Excel workbooks;
- it does not run the crawler or import data.

## Required Bundle Files

Runtime bundle folder:

```text
data/import/bundles/koda_data_bundle_v1/
```

Required files:

- `manifest.json`
- `qa_report.json`
- `content_items.jsonl`
- `achievement_enrichment.jsonl`
- `taxonomy.json`
- `taxonomy_rules.json`
- `review_candidates.jsonl`
- `tag_dictionary.json`

Expected bundle invariants:

- content items: `4933`
- web rows: `3937`
- opinions rows: `759`
- annual rows: `237`
- achievement enrichment rows: `76`
- review candidates: `1159`
- enrichment rows are not counted as content
- reclassification candidates are suggestions only

## Routes

- `/admin` - admin landing page. Lists the major admin tools (SiteText, Data bundle, Data review, Content items, Taxonomy) with a one-line description each, plus dashboard counters and recent searches.
- `/admin/data-bundle` - bundle status, counts, file presence, warning/error summary and links.
- `/admin/data-review` - review candidate queue with filters, saved decision status and pagination.
- `/admin/data-review/[id]` - candidate detail, matching bundle content row, editable approved tags/weights and save actions.
- `/admin/content-items` - read-only browser for `content_items.jsonl`.
- `/admin/taxonomy` - read-only browser for taxonomy categories, rules, tag dictionary and boundary rules.
- `/api/admin/data-review/[id]` - protected POST endpoint for saving the current decision for one candidate.
- `/api/admin/data-review/export?format=csv` - protected CSV export.
- `/api/admin/data-review/export?format=jsonl` - protected JSONL export.

All routes live under the existing admin protection pattern used by `/admin/site-texts`.

## Admin UI Workflow

The admin pages share one consistent look so they read as a single admin area:
each page has an `<h1>` heading and a muted `.section-sub` intro line, cards/tables
use the same spacing, status labels reuse the `.flag` badges, primary/secondary
buttons and filter forms are styled identically, and info/warning callouts use the
shared `.notice` style. Raw JSON is only shown behind a collapsed technical
`<details>` section, and tables scroll horizontally on narrow screens so long
Estonian text never breaks the layout. Admin pages never display absolute
local/server paths or stack traces.

### Landing page

`/admin` opens with an **Admin tööriistad** card linking to each major tool with a
short description:

- **Avalehe tekstid (SiteText)** — edit homepage and public copy.
- **Andmepakett (Data bundle)** — inspect generated bundle status and QA.
- **Andmeülevaatus (Data review)** — approve/reject suggested category and sector changes.
- **Sisuread (Content items)** — browse generated content rows (read-only).
- **Taksonoomia (Taxonomy)** — inspect taxonomy and classification rules.

### Review progress

`/admin/data-review` and `/admin/data-bundle` show a progress card with counters:
total candidates, approved, rejected, needs review, undecided, and a progress bar.
**Progress percentage** = candidates with any saved decision ÷ total candidates.
Decisions whose `candidateId` is not in the current bundle are ignored. When the
bundle is missing the counters render as unavailable (`—`).

### Undecided-first workflow

`/admin/data-review` defaults to the **undecided** filter so still-to-review
candidates appear first. The decision filter offers: Undecided (default), Approved,
Rejected, Needs review, All. Even under **All**, undecided rows are sorted ahead of
already-decided rows. Already-reviewed candidates are never hidden — they remain
reachable through the filter options.

### Export buttons

`/admin/data-review` shows clearly visible **Ekspordi otsused (CSV)** and
**Ekspordi otsused (JSONL)** buttons. They link to the protected export endpoint
(`/api/admin/data-review/export?format=csv|jsonl`). If no decisions exist yet the
export simply returns an empty file. The export route remains admin-only.

### Decisions are not applied live

Both `/admin/data-review` and `/admin/data-review/[id]` show a prominent notice:

> Ülevaatuse otsused salvestatakse hilisemaks kontrollitud rakendamiseks. Need ei
> muuda avalikku sisu ega kategooriaid automaatselt.

(*Review decisions are saved for later controlled application. They do not change
public content or live categories automatically.*) Saving a decision only writes a
`DataReviewDecision` row — it never edits `ContentItem`, the generated bundle, or
the source workbooks.

## Missing Bundle Files

Every bundle-dependent admin page (`/admin/data-bundle`, `/admin/data-review`,
`/admin/content-items`, `/admin/taxonomy`) degrades gracefully when the bundle is
missing or unreadable. Instead of crashing or leaking a stack trace / absolute
path, it shows a friendly notice listing the missing files and the commands to
generate the bundle:

```bash
npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1
```

Then validate it:

```bash
npm run data:validate-bundle -- --bundle=data/import/bundles/koda_data_bundle_v1
```

A corrupt/unparseable bundle file produces the same kind of friendly, path-free
message rather than an unhandled 500.

## Database Model

`DataReviewDecision` stores one current decision per `candidateId`.

Important fields:

- `candidateId` - stable candidate key from `review_candidates.jsonl`; currently normalized from `contentId` when no explicit candidate ID exists.
- `contentExternalId`, `contentTitle`, `contentUrl` - copied snapshot fields for export/readability.
- `decision` - `approved`, `rejected` or `needs_review`.
- `approvedValdkonnad`, `approvedTegevusalad`, `approvedTapsustused` - JSON arrays of proposed approved tags.
- `approvedPublicPriority`, `approvedSectorWeight`, `approvedTopicWeight`, `approvedGeneralWeight` - optional proposed priority/weight values.
- `reviewerName`, `reviewerNote`, `reviewedAt` - review metadata.
- `sourceCandidateJson` - JSON snapshot of the original candidate row used for the decision.

There is intentionally no relation that automatically updates `ContentItem`.

## Running Migrations

Local development:

```powershell
npm run prisma:migrate
```

Deployment/staging:

```bash
npm run prisma:deploy
```

Do not run `prisma migrate reset` for this app data.

## Export Format

CSV and JSONL exports include:

- `candidateId`
- `contentExternalId`
- `decision`
- approved tags
- approved priority/weights
- `reviewerName`
- `reviewerNote`
- `reviewedAt`

These exports are intended for a later controlled taxonomy/category/weight correction pipeline.

## What This Tool Does Not Do

- It does not apply taxonomy changes to public results.
- It does not mutate imported `ContentItem` categories or weights.
- It does not edit source Excel files.
- It does not edit generated bundle files.
- It does not replace the existing Excel import path.
- It does not expose bundle JSONL through public routes.
- It does not run crawler or production import.

## Later Correction Flow

1. Generate and validate the bundle locally.
2. Deploy bundle files and code.
3. Koda admins review candidates online.
4. Export saved decisions from `/api/admin/data-review/export`.
5. Feed the export into a separate controlled correction/import step.
6. Re-run validation before applying any public taxonomy or weighting changes.

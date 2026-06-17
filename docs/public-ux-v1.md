# Public UX & Content v1

The public journey is: homepage -> search/filter -> grouped results -> clean public detail page -> optional public Koda source. It remains source-based and non-AI.

## Homepage

Major homepage copy is managed through `SiteText` with code-level fallbacks. Do not hardcode those editable text blocks back into `src/app/page.tsx`.

The homepage keeps example searches, DB-driven topic chips, and links to koda.ee.

## Search Form

- `Tegevusala` is the first visible selector and remains optional.
- Free-text search remains prominent and query-only search still works.
- `Teema / valdkond`, `Ettevõtte olukord / täpsustus`, and result type are behind `Täpsemad valikud (teema, olukord)`.
- Selected filters remain visible and removable.
- Query params remain: `q`, `valdkond`, `tegevusala`, `tapsustus`, `type`.

## Results

Results are grouped as:

1. `Töövõidud`
2. `Koja seisukohad ja selgitused`
3. `Taust ja teema ajalugu`

The `Töövõidud` group is compact by default: only the first two cards are shown, and the rest sit behind `Näita veel töövõite (X)`.

Cards use clean short summaries and contextual public source CTAs:

- `Loe uudist`
- `Loe koja arvamust`
- `Vaata töövõitu`
- `Loe konteksti`
- `Ava koda.ee allikas`

The generic `Vaata allikat` / `Vaata algallikat` wording is not used as the default public CTA.

## Freshness

Search still uses the core relevance score. Ordering now adds a conservative recency rule: within a modest score band, newer ordinary public content can appear above older ordinary content. Strong older achievements keep their source/outcome boost and can still outrank weak recent rows.

## Detail Pages

Public detail pages are reader-facing, not database-record pages.

Achievement pages are centered on `Koja töövõit` with:

- `Valdkond`
- `Tulemus`
- `Mõju`
- `Mida saavutati?`

Non-achievement pages show `Koja seisukoht ja mõju` and `Miks see ettevõtjale oluline on?` only when those sections add distinct content.

Public detail pages no longer show:

- `Algallikas` backend metadata blocks
- source dataset/layer/type metadata
- CSV/XLSX/import/source file names
- canonical/internal URL text
- `Seotud allikad ja taust` supporting-opinion blocks
- hidden opinion rows as public lists

`Teema ajalugu` remains visible where relevant, but uses contextual CTA labels and clean excerpts only.

## Preserved Backend Behavior

Import metadata, evidence links, supporting opinions, source fields, admin overrides, and `SiteText` remain in the database/code for admin or future workflows. This change hides backend-like material from public pages; it does not delete it.

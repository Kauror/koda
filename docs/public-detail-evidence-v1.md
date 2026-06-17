# Public Detail & Evidence v1

`/sisu/[id]` is the clean public explanation page for one public result. It resolves `[id]` by `externalId` first, then DB id, and still enforces `isPublicSearchEligible()`.

## Public Page Contract

The public page is intentionally not an import/debug/audit view.

It does not render:

- `Algallikas` metadata sections
- source dataset/layer/source-type metadata
- source file names from import, CSV, XLSX, or other source files
- canonical/internal URL text
- supporting opinion lists
- `Seotud allikad ja taust`
- duplicate/backend evidence sections

If a real public source URL exists, the page shows one contextual source button instead.

## Source CTA Labels

Source buttons use front-facing labels:

| Source | Label |
| --- | --- |
| Koda news / `meie_uudis` | `Loe uudist` |
| Koda opinion article / `meie_arvamus_article` | `Loe koja arvamust` |
| Achievement / `toovoit` | `Vaata töövõitu` |
| Annual context | `Loe konteksti` |
| Unknown public web source | `Ava koda.ee allikas` |

The generic `Vaata allikat` wording is avoided.

## Achievement Details

Achievement pages are centered on `Koja töövõit`:

- `Valdkond`
- `Tulemus`
- `Mõju`
- `Mida saavutati?`

The page uses `AchievementEnrichment`, `kodaPosition`, `sourceEvidence`, `summary`, and `companyRelevance` where useful, but deduplicates repeated text so the same sentence is not printed several times.

## Non-Achievement Details

Non-achievement pages keep:

- `Koja seisukoht ja mõju`
- `Miks see ettevõtjale oluline on?`
- optional contextual public source button
- optional `Teema ajalugu`

Empty, weak, or duplicate sections are hidden.

## Teema Ajalugu

`Teema ajalugu` remains public where relevant. It shows clean title/date/summary snippets and contextual source CTAs. Body snippets with obvious navigation/menu/import noise are refused; if no clean excerpt exists, no excerpt is shown.

## Evidence Data Is Preserved

`getEvidenceForContent()` still loads annual context, duplicates, supporting opinions, and topic history. The public route currently renders only topic history. Supporting opinions and other evidence remain available in the data layer for future admin/backend UI and are not deleted from the database.

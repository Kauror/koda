# Public activity filter — canonical business sectors

## Root cause

The public `Tegevusala` filter was built from the distinct `activity_primary` /
`activity_secondary` values on content rows (`getFilterOptions().tegevusalad` in
`src/lib/search.ts` tallied every distinct `tegevusala` tag). That surfaced two
non-sector values as checkboxes:

- `Kõik tegevusalad / valdkondadeülene` — cross-sector **fallback** logic, not a
  user-facing sector (a client-side `isGenericSectorOption` filter hid it, but it
  was still produced); and
- `Energia ja ressursimahukas tegevus` — a company **profile / situation /
  refinement**, not a standard business sector.

## Fix

`src/lib/activities.ts` is the single source of truth for the public sector
checkboxes: **12 canonical business sectors**, in canonical order. Slugs are
`slugify(label)`, i.e. the same slug the importer assigns to the DB tag, so
sector matching is unaffected.

- `getFilterOptions().tegevusalad` (`src/lib/search.ts`) now returns exactly the
  12 canonical sectors in canonical order; counts fold each candidate's sector
  tags into their canonical sector slug. It never returns distinct content
  values, the cross-sector label, or the energy profile.

## Preserved behaviour (unchanged)

- **Cross-sector fallback**: rows with `activity_primary = Kõik tegevusalad /
  valdkondadeülene` are still included under every specific sector filter as a
  low-ranked fallback (`hasGenericSectorTag` / `crossSectorMatch` in
  `search-core.ts`, ranked: primary 44 > secondary/exact 28 > cross-sector 10).
  The user never selects "Kõik tegevusalad".
- Sector-relevance keyword/topic fallback (`sector-relevance.ts`) is untouched.
- Public/import eligibility gates are untouched (support-only / staging-only /
  held rows stay hidden).

## Energy-intensive profile

`Energia ja ressursimahukas tegevus` is excluded from the main `Tegevusala`
filter and kept only as an internal tag/ranking signal. There is currently **no
refinement / "Olukord" / "Ettevõtte profiil" UI**, so per the task's fallback it
is hidden from the main filter for now. `activities.ts` carries a TODO: when a
refinement section is added, expose it as **"Oleme energiamahukas ettevõte"**,
mapped to `situation_tags = energiamahukas` (and/or this activity value / the
`Energia, elektrihind ja varustuskindlus` topic as a secondary relevance signal).
It must narrow results, never be a main sector checkbox.

## Tests

`npm run activities:test` (`scripts/test-activities.ts`, DB-free, 21 checks):

- A: filter == 12 canonical sectors, in canonical order;
- B: energy profile + cross-sector label absent; `isPublicActivityFilterVisible`
  / `canonicalPublicActivitySlug` behave correctly;
- cross-sector fallback included under Tööstus / Kaubandus / Info; ranking
  primary > exact > cross-sector;
- Info filter excludes unrelated industry-only / energy-only rows with no IT
  signal;
- a cross-sector töövõit is still included under a specific sector;
- eligibility: support-only / staging-only / enrichment-hold rows stay hidden.

`topics:test` (47), `search:test` (81), `public-ui:test` (22), `tsc --noEmit`
and `next build` are green.

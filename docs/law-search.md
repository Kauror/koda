# Law / õigusakt search (v1)

This feature lets users search for a law (e.g. *Jäätmeseadus*) and see the
Chamber's related work over time — work wins, opinions, news and context —
newest first.

## Components

| File | Role |
| --- | --- |
| `src/lib/law-dictionary.ts` | Canonical law names, slugs, abbreviations, aliases, weak keywords, related valdkond. |
| `src/lib/law-match.ts` | Pure, null-safe matching/extraction (`detectLaw`, `extractLawMentions`, `lawMentionForSlug`, `rankLawContent`). |
| `src/lib/search.ts` | Recognizes the law from the query and returns law-aware, newest-first results. |
| `src/app/seadused/[slug]/page.tsx` | Public law page. |
| `src/app/admin/(dash)/laws/page.tsx` | Admin dictionary + per-law match counts. |

## How the dictionary works

Each `LawEntry` has a canonical name, an ASCII `slug` (used in
`/seadused/[slug]`), an optional official `abbreviation`, optional `aliases`,
optional narrow `weakKeywords`, and optional `relatedValdkond` tag slugs.

The dictionary is **conservative on purpose**: only specific legal-act names,
exact aliases and official abbreviations are listed. Broad everyday words
(`jäätmed`, `pakend`, `maks`, `töö`) are deliberately **not** registered, so
they never match a law.

## Aliases and inflected forms

Matching is case-insensitive and normalizes text the same way search does
(lowercase, punctuation → spaces).

- **Inflected forms are handled automatically** — no need to list them. A law
  name matches when it appears with a left word boundary, optionally followed by
  a short Estonian case ending (≤ 5 letters). So `Jäätmeseadus` matches
  `jäätmeseaduse`, `jäätmeseadusega`, `jäätmeseadusele`, etc.
- **Aliases** are alternative full names / spellings (e.g. the no-space form
  `töölepinguseadus`, or `andmekaitseseadus` for the Isikuandmete kaitse seadus).
  They are matched the same inflection-aware way but reported as `alias`.
- **Abbreviations** (e.g. `KMS`, `TLS`) match only as a standalone token and
  only when ≥ 3 characters (so ambiguous 2-letter codes like `LS`/`ÄS` are not
  matched).

## Confidence levels

| Match type | Confidence | Used for recognition? | Confirmed tag? |
| --- | --- | --- | --- |
| `exact_name` | high | yes | yes |
| `inflected_name` | high | yes | yes |
| `alias` | medium | yes | yes |
| `abbreviation` | medium | yes | yes |
| `weak_keyword` | low | **no** | **no** |

`detectLaw()` (query recognition) and `lawMentionForSlug(…, "medium")` (content
matching) ignore `weak_keyword` matches.

## Law search vs normal keyword search

- On a normal search, free text is scored against titles/summaries/body as
  before. Existing search is unchanged.
- When the query is **recognized as a law** (high/medium match), the search:
  1. sets `recognizedLaw` (the results page shows *"Tuvastasime õigusakti …"*
     with a link to `/seadused/[slug]`);
  2. lets a confirmed law match satisfy the free-text requirement, so content
     that mentions the law only in an **inflected** form is still found;
  3. orders results **newest-first** (still grouped Töövõidud / Seisukohad /
     Uudised / Taust; group order unchanged, so work wins still lead).
- If the match is **uncertain** (only a weak/broad term), nothing is recognized
  and the query falls back to normal keyword search.

## Adding a new law

Add an entry to `LAWS` in `src/lib/law-dictionary.ts`:

```ts
{
  slug: "uus-seadus",            // ASCII, kebab-case, unique
  canonicalName: "Uus seadus",   // official Estonian name
  abbreviation: "US",            // optional; matched only if ≥ 3 chars
  aliases: ["uusseadus"],        // optional alternative spellings
  weakKeywords: ["uus teema"],   // optional narrow topical hints (low conf.)
  relatedValdkond: ["..."],      // optional valdkond tag slugs
}
```

Inflected forms are automatic — do not enumerate them. Keep aliases specific and
avoid broad words. Add a matching test in `scripts/test-search.ts`.

## Why weak matches require review

Weak keywords are topical hints, not proof that a row is about the law. They are
surfaced only as **suggestions** (low confidence) on `/admin/laws` and the
data-review detail page, and are never treated as confirmed/public law tags and
never trigger law-aware search. A human reviewer decides whether a weak match is
real before it is acted on.

## Date-first workflow & later steps

Law-aware results default to newest-first. Year and `dateFrom`/`dateTo` range
filters are a documented later step; today the date-first ordering plus the
existing source-type/category filters cover the core workflow.

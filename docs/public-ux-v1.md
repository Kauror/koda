# Public UX & content (v1)

How the public journey reads and behaves: homepage → search/filter → grouped
results → detail page → original source/evidence. This is a content/UX layer over
the search (`docs/search-ranking-v1.md`) and detail (`docs/public-detail-evidence-v1.md`)
work — no ranking, eligibility or import logic changed.

## Homepage concept

Positioned as a **source-based Koda value-discovery tool** — explicitly *not* a
chatbot, news archive or Excel database. The hero states it is an "allikapõhine
ülevaade sellest, mida koda on ettevõtjate huvide kaitseks teinud ja öelnud" and
notes results come from Koda's public materials and indexed sources.

Above the fold: one prominent free-text search field (the form), a row of example
searches (Maksud ja aruandlus, Tööjõud ja tööõigus, Pakendid, Energia,
Välistööjõud, Ekspordiga seotud teemad, "Mida on koda saavutanud?"), then
DB-driven topic chips ("Sirvi teemade kaupa") and links to koda.ee.

## Search/filter UX

- **Free text is primary**: a large labelled input ("Otsi teemat või märksõna")
  with an inline "Otsi" button; everything else is optional.
- **No mandatory sector**: tegevusala and "Ettevõtte olukord" (tapsustus) live
  behind a "Täpsemad valikud" disclosure and are clearly marked optional.
- **Selected filters are visible and removable**: active topic/sector/situation
  selections render as removable chips (`.chip-remove`) regardless of whether the
  advanced section is open.
- Submits on Enter (`enterKeyHint="search"`) and via two buttons.

Query params are unchanged: `q`, `valdkond`, `tegevusala`, `tapsustus`, `type`.

## Result group meanings

The results page shows the active query + filter chips, a total count, and three
self-explaining groups (each with a one-line description and a count):

1. **Töövõidud** — concrete outcomes/wins Koda achieved.
2. **Koja seisukohad ja selgitused** — public positions, proposals, warnings and
   explanatory news.
3. **Taust ja teema ajalugu** — annual-report context and longer topic history.

If results are only background ("Taust" only), a notice suggests broadening. If
there are no results, the empty state suggests broader topics (DB chips) and
links to koda.ee.

## Card CTA logic

Each card shows: badges (type + outcome) + date, title (→ detail), short summary,
topic tags + muted sector tags, an evidence hint, and **two distinct actions**:

- **"Vaata kokkuvõtet"** → internal `/sisu/[id]` source-based summary (primary).
- **"Ava algallikas →"** → original Koda source URL (only when present;
  click-tracked).

The original source link is never the only CTA. Admin override fields
(`adminDisplayTitleOverride`, `adminSummaryOverride`) are used for title/summary.

## Detail-page sections

- **Allikapõhine kokkuvõte** — the summary (admin override first).
- **Konkreetne töövõit** — achievements only, from `AchievementEnrichment`.
- **Miks see ettevõtjale oluline on?** — `companyRelevance` (existing field only).
- **Koja seisukoht ja mõju** — `kodaPosition` + source evidence.
- **Algallikas** — source/dataset labels, section, report year, file, original
  URL ("Ava algallikas"), canonical URL if different.
- **Seotud allikad ja taust** — annual context, **toetavad arvamused** (styled
  visually secondary), teema ajalugu, duplicates.

## Source/evidence wording principles

Consistent Estonian, source-based, no overclaiming: "Allikapõhine kokkuvõte",
"Koja seisukoht", "Toetav arvamus", "Aastaaruande kontekst", "Seotud allikas",
"Algallikas", "Töövõit", "Teema ajalugu", "Allika põhjal". Avoided: AI/"guaranteed
impact"/legal-advice phrasing.

## Empty/error states

- No results → suggested broader topics + koda.ee link.
- Only background results → "leidsime peamiselt tausta…" notice.
- Missing source URL → "Avalik allikalink puudub (toetav allikas)".
- Detail not found / not public → `notFound()` (404).
- Empty evidence section → simply not rendered.

## Mobile & accessibility

- Search row and card actions stack on ≤640px; the submit button goes full-width.
- Source links get padding for larger tap targets on mobile.
- Semantic headings (h1/h2/h3), `aria-label`s on the search input and filter
  groups, `aria-expanded` on the disclosure, `.sr-only` text on remove chips.
- Badges/tags wrap (`flex-wrap`); brand-token colours keep contrast.
- Keyboard: form submits on Enter; all actions are real buttons/links.

## Deferred

- Internal-detail click tracking (only external source clicks tracked today).
- Richer mobile nav / sticky search.
- Per-group "show more" pagination beyond current caps.
- PostgreSQL full-text/trigram and AI summaries (future orders).
- Visual design refresh / full brand pass.

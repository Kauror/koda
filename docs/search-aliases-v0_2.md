# Search aliases v0.2

Search aliases are a deterministic relevance layer for free-text queries in
`/tulemused?q=...` and `/api/search?q=...`. They do not add chatbot behavior,
LLM calls, embeddings, semantic search, or new public service routes.

## Data and seeding

- Seed data lives in `data/search/koda_search_alias_seed_v0_2.json`.
- The database table is `SearchAlias`.
- Run `npm run search-aliases:seed` after migrations to upsert the seed.
- The seed script computes `normalizedAlias` from `alias`, validates uniqueness,
  and is safe to run repeatedly. It does not delete custom aliases.
- The v0.2 JSON contains a few punctuation/spacing variants that collapse to
  the same normalized alias (for example hyphen vs space). The seed keeps the
  highest-weight/earliest row for each normalized alias and logs the skipped
  duplicate count.

## Matching and expansion

`src/lib/search-aliases.ts` normalizes aliases and queries case-insensitively and
accent-insensitively. Matching is phrase/token-window based, not arbitrary
substring matching.

Matched aliases produce soft ranking signals:

- `targetKind = valdkond` -> topic boost when the target resolves to a canonical
  public topic.
- `targetKind = tegevusala` -> sector boost when the target is a canonical public
  sector.
- `targetKind = law` -> law/text boost terms.
- `targetKind = service`, `market`, `intent`, `free_text_boost` -> text boost
  terms only.

`unknown_review` aliases are stored and can be matched for diagnostics, but they
do not create scoring or filter signals. The internal topic
`oigusloome_kvaliteet_kaasamine` is never exposed as a public filter; related
aliases are background text boosts only.

## Updating aliases

1. Edit or replace `data/search/koda_search_alias_seed_v0_2.json`.
2. Keep broad or ambiguous aliases as `targetKind = unknown_review` until search
   logs or manual review justify enabling them.
3. Re-run `npm run search-aliases:seed`.
4. Run `npm run search:test` and `npm run public-ui:test`.

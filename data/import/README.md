# `data/import/` - structured source files

This folder is the active local import source for the Koda public search app.
The workbooks themselves are git-ignored local data files, but their expected
names and sheets are fixed by the importer.

| File | Main sheet | Role | Expected rows |
| --- | --- | --- | ---: |
| `koda_web_content_v0_9_4_cleaned.xlsx` | `web_content_v0_9` | web/news/opinion article content | 3804 |
| `koda_opinions_v0_9_1.xlsx` | `opinions_v0_9` | formal opinion content | 759 |
| `koda_toovoidud_enrichment_v0_9_1.xlsx` | `toovoidud_v0_9` | toovoidud value cards | 97 |
| `koda_taxonomy_rules_v0_9_1.txt` | n/a | taxonomy reference only | n/a |

- Total content rows before public exclusions = **4660**.
- Public gates come from `import_action` and `public_display_allowed`.
- Candidate links stay admin/review-only and are not imported as public
  relations.
- Candidate law tags are stored as source metadata only; public law search uses
  confirmed `law_tags_confirmed` tags.
- Older v1 merge-ready workbooks are archived outside this active import folder
  and should not be copied back for production/staging imports.

Generated reports are written to `data/import/reports/`; pre-replacement JSON
backups are written to `data/import/backups/`. Both folders are git-ignored.

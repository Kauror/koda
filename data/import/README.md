# `data/import/` — merge-ready source files

Put the four cleaned v1 merge-ready workbooks here (they are **git-ignored** –
they are local source data, not committed):

| File | Main sheet | Role | Expected rows |
| --- | --- | --- | --- |
| `koda_web_index_v1_merge_ready.xlsx` | `web_merge_ready` | content source | 3937 |
| `koda_opinions_v1_merge_ready.xlsx` | `opinions_merge_ready` | content source (supporting evidence) | 759 |
| `koda_annual_reports_v1_merge_ready.xlsx` | `annual_reports_merge_ready` | content source (context/history) | 237 |
| `koda_toovoidud_enrichment_v1_merge_ready.xlsx` | `toovoidud_enrichment_ready` | **enrichment only** | 76 |

- Total content rows before public exclusions = **4933** (3937 + 759 + 237).
- The töövõidud file is **enrichment only** and creates **0** content rows.
  If the import ever produces 5009 content rows, it wrongly appended this file.

All other sheets in each workbook (inspection / QA / rules_notes / review
sheets) are **ignored** by the importer.

Generated QA reports are written to `data/import/reports/` (also git-ignored):
`validation-report.json`, `import-report.json`, `import-report.md`.

See [`docs/import-merge-ready.md`](../../docs/import-merge-ready.md) for the
full workflow.

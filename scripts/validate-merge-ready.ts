/**
 * Validate the four merge-ready workbooks WITHOUT touching the database.
 *
 *   npm run import:validate
 *
 * Checks (Task 3 steps 2-6, Task 8):
 *   - required files / sheets / columns exist
 *   - expected row counts (web 3937, opinions 759, annual 237, enrichment 76)
 *   - total content = 4933 before exclusions (guards against the 5009 trap)
 *   - no duplicate external content IDs within a source
 *   - required merge fields present
 *   - enum/status values are known
 *   - 76 canonical achievements, 76/76 enrichment matches, 0 content rows from enrichment
 *
 * Writes data/import/reports/validation-report.json and exits non-zero on failure.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadEnv } from "./env";
import { IMPORT_DIR, stageAndAnalyze } from "./lib/merge-ready";

loadEnv();

async function main() {
  console.log("[validate] Reading merge-ready workbooks from", IMPORT_DIR);
  const { analysis } = await stageAndAnalyze();

  const c = analysis.rowCounts;
  console.log("\n=== Row counts ===");
  console.log(`  web:        ${c.web} / ${analysis.expected.web}`);
  console.log(`  opinions:   ${c.opinions} / ${analysis.expected.opinions}`);
  console.log(`  annual:     ${c.annual_reports} / ${analysis.expected.annual_reports}`);
  console.log(`  enrichment: ${c.enrichment} / ${analysis.expected.enrichment} (enrichment-only, 0 content rows)`);
  console.log(`  TOTAL content staged: ${analysis.totalContentStaged} / ${analysis.expected.totalContentBeforeExclusions}`);

  console.log("\n=== Visibility (conservative gating) ===");
  console.log(`  public:                  ${analysis.visibility.public}`);
  console.log(`  hidden/supporting:       ${analysis.visibility.hiddenOrSupporting}`);
  console.log(`  needs human review:      ${analysis.visibility.needsReview}`);
  console.log(`  do_not_import_yet:       ${analysis.visibility.doNotImport}`);
  console.log(`  weak/failed extraction:  ${analysis.visibility.weakOrFailedExtraction}`);

  console.log("\n=== Per dataset ===");
  for (const [ds, v] of Object.entries(analysis.perDataset)) {
    console.log(`  ${ds.padEnd(15)} total=${v.total} public=${v.public} hidden=${v.hidden} review=${v.needsReview} achievements=${v.achievements}`);
  }

  console.log("\n=== Achievement enrichment ===");
  console.log(`  canonical achievements:  ${analysis.canonicalAchievements}`);
  console.log(`  enrichment rows:         ${analysis.enrichment.rows}`);
  console.log(`  matched:                 ${analysis.enrichment.matched}`);
  console.log(`  failed:                  ${analysis.enrichment.failed}`);
  console.log(`  content rows created:    ${analysis.enrichment.contentRowsCreated}`);

  if (analysis.invalidEnumValues.length) {
    console.log(`\n=== Invalid enum values (${analysis.invalidEnumValues.length}) ===`);
    for (const i of analysis.invalidEnumValues.slice(0, 20))
      console.log(`  ${i.dataset} ${i.externalId} ${i.field}="${i.message}"`);
  }
  if (analysis.missingRequiredFields.length) {
    console.log(`\n=== Missing required fields (${analysis.missingRequiredFields.length}) ===`);
    for (const i of analysis.missingRequiredFields.slice(0, 20))
      console.log(`  ${i.dataset} ${i.externalId} ${i.field}`);
  }
  if (analysis.duplicateContentHashGroups.length) {
    console.log(`\n  note: ${analysis.duplicateContentHashGroups.length} duplicate content-hash group(s) (informational)`);
  }

  // Write the validation report.
  const reportsDir = resolve(IMPORT_DIR, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const report = { timestamp: new Date().toISOString(), kind: "validation", ...analysis };
  writeFileSync(resolve(reportsDir, "validation-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n[validate] Wrote ${resolve(reportsDir, "validation-report.json")}`);

  if (!analysis.ok) {
    console.error("\n[validate] FAIL:");
    for (const e of analysis.errors) console.error("  - " + e);
    process.exitCode = 1;
    return;
  }
  console.log("\n[validate] PASS — all merge-ready checks succeeded.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

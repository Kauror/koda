/**
 * Validate the v1 Koda app-import package without touching the database.
 *
 *   npm run import:validate
 *
 * Writes data/import/reports/validation-report.json and prints a PASS/FAIL
 * summary. Hard errors fail the run; warnings (e.g. the informational
 * public-related-link count, smoke-test WARN rows) do not.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadEnv } from "./env";
import { FILES, IMPORT_DIR, SHEETS, activeInputFileName, stageAndAnalyze } from "./lib/merge-ready";

loadEnv();

function main() {
  console.log("[validate] Reading v1 package from", IMPORT_DIR);
  const { analysis } = stageAndAnalyze();
  const c = analysis.rowCounts;

  console.log("\n=== Input files ===");
  console.log(`  opinions: ${activeInputFileName(FILES.opinions)} (${SHEETS.opinions})`);
  console.log(`  web:      ${activeInputFileName(FILES.web)} (${SHEETS.web})`);
  console.log(`  toovoidud:${activeInputFileName(FILES.toovoidud)} (${SHEETS.toovoidud})`);
  console.log(`  links:    ${activeInputFileName(FILES.links)}`);
  console.log(`  taxonomy: ${analysis.taxonomyReference.fileName} (${analysis.taxonomyReference.bytes} bytes)`);

  console.log("\n=== Import row counts ===");
  console.log(`  web:       ${c.web} / ${analysis.expected.web}`);
  console.log(`  opinions:  ${c.opinions} / ${analysis.expected.opinions}`);
  console.log(`  toovoidud: ${c.toovoidud} / ${analysis.expected.toovoidud}`);
  console.log(`  TOTAL:     ${c.total} / ${analysis.expected.totalImportable}`);

  console.log("\n=== Excluded/review rows (never imported) ===");
  console.log(`  web:       ${analysis.excludedCounts.web} / ${analysis.expected.webExcluded}`);
  console.log(`  opinions:  ${analysis.excludedCounts.opinions} / ${analysis.expected.opinionsExcluded}`);
  console.log(`  toovoidud: ${analysis.excludedCounts.toovoidud} / ${analysis.expected.toovoidudExcluded}`);

  console.log("\n=== Public rows ===");
  for (const [ds, v] of Object.entries(analysis.perDataset)) {
    console.log(`  ${ds.padEnd(10)} total=${v.total} public=${v.public} hidden=${v.hidden} review=${v.needsReview}`);
  }

  console.log("\n=== Cross-layer links (koda_content_links_v1.xlsx) ===");
  console.log(`  public related links: ${analysis.links.publicRelated} (confidence: ${JSON.stringify(analysis.links.byConfidence)})`);
  console.log(`  candidate/review:     ${analysis.links.candidate}`);
  console.log(`  blocked/rejected:     ${analysis.links.blocked}`);
  console.log(`  missing/excluded tgt: ${analysis.links.missingTargets}`);
  console.log(`  links to non-imported:${analysis.links.targetsNotImported.length}`);
  console.log(`  links to excluded:    ${analysis.links.targetsExcluded.length}`);
  console.log(`  low/rejected public:  ${analysis.links.lowOrRejected.length}`);

  console.log("\n=== Cross-layer smoke test ===");
  for (const t of analysis.smokeTest.rows) {
    console.log(`  ${t.testId} ${t.status.padEnd(4)} [${t.severity}] ${t.testName}${t.issueCount ? ` (${t.issueCount})` : ""}`);
  }

  console.log("\n=== Töövõit date regressions ===");
  for (const dr of analysis.dateRegressions) {
    console.log(`  ${dr.ok ? "ok  " : "FAIL"} ${dr.id} ${dr.field}="${dr.value}" — ${dr.note}`);
  }

  console.log("\n=== Public safety ===");
  console.log(`  empty public summary rows: ${analysis.missingSummaryRows.length}`);
  console.log(`  raw-fragment summary rows: ${analysis.rawFragmentSummaryRows.length}`);
  console.log(`  cross-sector display tags: ${analysis.crossSectorDisplayTagRows.length}`);
  console.log(`  FALSE import-flag rows:    ${analysis.importFlagViolations.length}`);
  console.log(`  confirmed public law rows: ${analysis.law.publicConfirmedLawTagRows}`);

  if (analysis.warnings.length) {
    console.log("\n=== Warnings (non-fatal) ===");
    for (const w of analysis.warnings) console.log("  - " + w);
  }

  const reportsDir = resolve(IMPORT_DIR, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const report = { timestamp: new Date().toISOString(), kind: "v1-validation", ...analysis };
  writeFileSync(resolve(reportsDir, "validation-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n[validate] Wrote ${resolve(reportsDir, "validation-report.json")}`);

  if (!analysis.ok) {
    console.error("\n[validate] FAIL:");
    for (const e of analysis.errors) console.error("  - " + e);
    process.exitCode = 1;
    return;
  }
  console.log("\n[validate] PASS - all v1 package checks succeeded.");
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

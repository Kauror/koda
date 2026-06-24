/**
 * Validate the structured v0.9.4/v0.9.1 package without touching the database.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadEnv } from "./env";
import { IMPORT_DIR, stageAndAnalyze } from "./lib/merge-ready";

loadEnv();

async function main() {
  console.log("[validate] Reading structured package from", IMPORT_DIR);
  const { analysis } = await stageAndAnalyze();
  const c = analysis.rowCounts;

  console.log("\n=== Row counts ===");
  console.log(`  web:             ${c.web} / ${analysis.expected.web}`);
  console.log(`  opinions:        ${c.opinions} / ${analysis.expected.opinions}`);
  console.log(`  toovoidud:       ${c.toovoidud} / ${analysis.expected.toovoidud}`);
  console.log(`  approved links:  ${c.approvedLinks} / ${analysis.expected.approvedLinks}`);
  console.log(`  candidate links: ${c.candidateLinks} / ${analysis.expected.candidateLinks}`);
  console.log(`  TOTAL content staged: ${analysis.totalContentStaged} / ${analysis.expected.totalContentBeforeExclusions}`);

  console.log("\n=== Public rows ===");
  for (const [ds, v] of Object.entries(analysis.perDataset)) {
    console.log(`  ${ds.padEnd(10)} total=${v.total} public=${v.public} hidden=${v.hidden} review=${v.needsReview}`);
  }

  console.log("\n=== Held/support/staging ===");
  console.log(`  web support-only:        ${analysis.visibility.supportOnly}`);
  console.log(`  staging-only rows:       ${analysis.visibility.stagingOnly}`);
  console.log(`  do-not-import web rows:  ${analysis.visibility.doNotImportPublic}`);
  console.log(`  held toovoidud rows:     ${analysis.visibility.heldToovoidud}`);
  console.log(`  review-required rows:    ${analysis.visibility.needsReview}`);
  console.log(`  numeric-review rows:     ${analysis.visibility.numericReview}`);

  console.log("\n=== Links and law search ===");
  console.log(`  approved public relations:    ${analysis.links.approvedPublicEligible}`);
  console.log(`  approved admin/blocked links: ${analysis.links.approvedAdminOrBlocked}`);
  console.log(`  candidate links admin-only:   ${analysis.links.candidateAdminOnly}`);
  console.log(`  public confirmed law rows:    ${analysis.law.publicConfirmedLawTagRows}`);
  console.log(`  candidate-law-tag rows:       ${analysis.law.candidateLawTagRows}`);

  if (analysis.invalidEnumValues.length) {
    console.log(`\n=== Invalid enum values (${analysis.invalidEnumValues.length}) ===`);
    for (const i of analysis.invalidEnumValues.slice(0, 20)) console.log(`  ${i.dataset} ${i.externalId} ${i.field}="${i.message}"`);
  }
  if (analysis.missingRequiredFields.length) {
    console.log(`\n=== Missing required fields (${analysis.missingRequiredFields.length}) ===`);
    for (const i of analysis.missingRequiredFields.slice(0, 20)) console.log(`  ${i.dataset} ${i.externalId} ${i.field}`);
  }
  if (analysis.duplicateContentHashGroups.length) {
    console.log(`\n  note: ${analysis.duplicateContentHashGroups.length} duplicate content-hash group(s) (informational)`);
  }

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
  console.log("\n[validate] PASS - all structured package checks succeeded.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

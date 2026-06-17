/**
 * Deterministic checks for the merge-ready import (no database required).
 *
 *   npm run import:test
 *
 * Covers Task 8: row counts, total = 4933, enrichment creates no content rows,
 * 76/76 enrichment matching, review-needed rows excluded from public, opinion
 * rows are supporting evidence, duplicate external IDs fail, invalid enum
 * values fail, and staging is deterministic (idempotency proxy).
 */
import assert from "node:assert";
import { loadEnv } from "./env";
import {
  analyze,
  computeVisibility,
  matchEnrichment,
  stageAllContent,
  stageEnrichment,
  ALLOWED,
  EXPECTED_ROWS,
  type StagedContent,
} from "./lib/merge-ready";

loadEnv();

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL- ${name}`);
    console.log("        " + (e as Error).message);
  }
}

async function main() {
  console.log("[test] staging workbooks (twice, for determinism check)...");
  const staged = await stageAllContent();
  const staged2 = await stageAllContent();
  const enrichment = await stageEnrichment();
  const webAch = staged.web.filter((s) => s.isAchievement);
  const matches = matchEnrichment(enrichment, webAch);
  const analysis = analyze(staged, enrichment, matches);

  console.log("\n[test] running checks:");

  check("web row count = 3937", () => assert.equal(staged.web.length, EXPECTED_ROWS.web));
  check("opinions row count = 759", () => assert.equal(staged.opinions.length, EXPECTED_ROWS.opinions));
  check("annual row count = 237", () => assert.equal(staged.annual_reports.length, EXPECTED_ROWS.annual_reports));
  check("enrichment row count = 76", () => assert.equal(enrichment.length, EXPECTED_ROWS.enrichment));

  check("total content = 4933 before exclusions (not 5009)", () =>
    assert.equal(staged.all.length, EXPECTED_ROWS.totalContentBeforeExclusions));

  check("enrichment creates 0 content rows", () => assert.equal(analysis.enrichment.contentRowsCreated, 0));
  check("all enrichment rows are role=enrichment_only", () => assert.equal(analysis.enrichment.allEnrichmentOnly, true));

  check("76 canonical achievements in web", () => assert.equal(webAch.length, 76));
  check("76/76 enrichment rows match a canonical achievement", () => {
    assert.equal(analysis.enrichment.matched, 76);
    assert.equal(analysis.enrichment.failed, 0);
  });

  check("no public row needs human review", () => {
    const bad = staged.all.filter((s) => s.isPublic && s.needsHumanReview);
    assert.equal(bad.length, 0);
  });

  check("review-needed rows are excluded from public eligibility", () => {
    const sample: StagedContent = { ...staged.web[0], needsHumanReview: true, importStatus: "import_public_candidate", extractionQuality: "good", publicDisplayStatus: "main_result_candidate", mergeReadiness: "ready_for_merge_public" };
    assert.equal(computeVisibility(sample), false);
  });

  check("opinion rows are imported as supporting evidence (none public)", () => {
    const publicOpinions = staged.opinions.filter((s) => s.isPublic);
    assert.equal(publicOpinions.length, 0);
  });

  check("do_not_import_yet rows are not public", () => {
    const bad = staged.all.filter((s) => s.importStatus === "do_not_import_yet" && s.isPublic);
    assert.equal(bad.length, 0);
  });

  check("weak/failed extraction public candidates are excluded", () => {
    const sample: StagedContent = { ...staged.web[0], importStatus: "import_public_candidate", needsHumanReview: false, extractionQuality: "weak", publicDisplayStatus: "main_result_candidate", mergeReadiness: "ready_for_merge_public" };
    assert.equal(computeVisibility(sample), false);
  });

  check("duplicate external IDs are detected as errors", () => {
    const dup = { ...staged, web: [...staged.web, staged.web[0]] };
    const a = analyze(dup as typeof staged, enrichment, matchEnrichment(enrichment, dup.web.filter((s) => s.isAchievement)));
    assert.ok(a.errors.some((e) => e.includes("duplicate external IDs")), "expected duplicate-id error");
    assert.ok(!a.ok);
  });

  check("invalid enum values are detected", () => {
    const broken = { ...staged.web[0], importStatus: "totally_unknown_status" };
    const web = [broken, ...staged.web.slice(1)];
    const mutated = { web, opinions: staged.opinions, annual_reports: staged.annual_reports, all: [...web, ...staged.opinions, ...staged.annual_reports] };
    const a = analyze(mutated, enrichment, matches);
    assert.ok(a.invalidEnumValues.length >= 1, "expected an invalid enum value");
  });

  check("all real import_status values are in the allow-list", () => {
    for (const s of staged.all) {
      if (s.importStatus) assert.ok(ALLOWED.importStatus.has(s.importStatus), `bad import_status ${s.importStatus}`);
    }
  });

  check("staging is deterministic (idempotency proxy)", () => {
    assert.equal(JSON.stringify(staged2.all.map((s) => [s.externalId, s.contentHash, s.isPublic])),
      JSON.stringify(staged.all.map((s) => [s.externalId, s.contentHash, s.isPublic])));
  });

  check("overall analysis passes", () => assert.ok(analysis.ok, analysis.errors.join("; ")));

  console.log(`\n[test] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

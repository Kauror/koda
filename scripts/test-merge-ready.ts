/**
 * Deterministic checks for the structured v0.9.10 app-upload package.
 */
import assert from "node:assert";
import { loadEnv } from "./env";
import {
  analyze,
  computeVisibility,
  stageAllContent,
  stageLinks,
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
  console.log("[test] staging package twice for determinism check...");
  const staged = await stageAllContent();
  const staged2 = await stageAllContent();
  const links = await stageLinks();
  const analysis = analyze(staged, links);

  console.log("\n[test] running checks:");
  check("web row count = 1132", () => assert.equal(staged.web.length, EXPECTED_ROWS.web));
  check("opinions row count = 428", () => assert.equal(staged.opinions.length, EXPECTED_ROWS.opinions));
  check("toovoidud row count = 73", () => assert.equal(staged.toovoidud.length, EXPECTED_ROWS.toovoidud));
  check("total content = 1633", () => assert.equal(staged.all.length, EXPECTED_ROWS.totalContentBeforeExclusions));

  check("web public count = 1132", () => assert.equal(analysis.perDataset.web.public, EXPECTED_ROWS.webPublic));
  check("opinions public count = 428", () => assert.equal(analysis.perDataset.opinions.public, EXPECTED_ROWS.opinionsPublic));
  check("toovoidud public count = 73", () => assert.equal(analysis.perDataset.toovoidud.public, EXPECTED_ROWS.toovoidudPublic));
  check("toovoidud held count = 0", () => assert.equal(analysis.visibility.heldToovoidud, EXPECTED_ROWS.toovoidudHold));
  check("candidate links are admin-only", () => {
    assert.equal(analysis.links.candidateRows, EXPECTED_ROWS.candidateLinks);
    assert.equal(analysis.blockers.candidateLinksPublic, 0);
  });

  check("support-only rows are not public", () => assert.equal(analysis.blockers.supportOnlyPublic.length, 0));
  check("staging-only rows are not public", () => assert.equal(analysis.blockers.stagingOnlyPublic.length, 0));
  check("held toovoidud rows are not public", () => assert.equal(analysis.blockers.heldToovoidudPublic.length, 0));
  check("no public row needs human review", () => assert.equal(analysis.publicRowsWithReviewFlag.length, 0));
  check("no public row needs numeric review", () => assert.equal(analysis.publicRowsWithNumericReviewFlag.length, 0));

  check("visibility requires explicit import action and public flag", () => {
    const sample: StagedContent = {
      ...staged.web.find((s) => s.isPublic)!,
      importAction: "import_support_only",
      publicDisplayAllowed: true,
    };
    assert.equal(computeVisibility(sample), false);
  });

  check("public toovoidud row can be public", () => {
    const sample = staged.toovoidud.find((s) => s.publicDisplayAllowed === true)!;
    assert.equal(computeVisibility(sample), true);
  });

  check("law search uses confirmed tags only", () => {
    const publicLawRows = staged.all.filter((s) => s.isPublic && s.lawSearchAllowed && s.lawTagsConfirmed);
    assert.ok(publicLawRows.length > 0, "expected public confirmed law-tag rows");
    assert.ok(publicLawRows.every((s) => s.oigusaktid.length > 0), "confirmed law tags should become oigusakt tags");
  });

  check("duplicate external IDs are detected as errors", () => {
    const dup = { ...staged, web: [...staged.web, staged.web[0]] };
    const a = analyze({ ...dup, all: [...dup.web, ...dup.opinions, ...dup.toovoidud] }, links);
    assert.ok(a.errors.some((e) => e.includes("duplicate external IDs")), "expected duplicate-id error");
    assert.ok(!a.ok);
  });

  check("staging is deterministic", () => {
    assert.equal(
      JSON.stringify(staged2.all.map((s) => [s.externalId, s.contentHash, s.isPublic])),
      JSON.stringify(staged.all.map((s) => [s.externalId, s.contentHash, s.isPublic]))
    );
  });

  check("overall analysis passes", () => assert.ok(analysis.ok, analysis.errors.join("; ")));

  console.log(`\n[test] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

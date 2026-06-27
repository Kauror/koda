/**
 * Deterministic checks for the v1 Koda app-import package.
 *
 *   npm run import:test
 */
import assert from "node:assert";
import { loadEnv } from "./env";
import {
  EXPECTED_ROWS,
  SHEETS,
  analyze,
  computeVisibility,
  evidenceLinkTypeForTarget,
  sheetNames,
  stageAllContent,
  stageExcludedIds,
  stageLinkWorkbook,
  FILES,
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

function main() {
  console.log("[test] staging v1 package twice for determinism check...");
  const staged = stageAllContent();
  const staged2 = stageAllContent();
  const links = stageLinkWorkbook();
  const excluded = stageExcludedIds();
  const analysis = analyze(staged, links, excluded);

  const byId = (rows: StagedContent[], id: string) => rows.find((s) => s.externalId === id);

  console.log("\n[test] running checks:");

  // ---- v1 sheet names ----
  check("v1 import sheet names exist in each workbook", () => {
    assert.ok(sheetNames(FILES.opinions).includes(SHEETS.opinions), "opinions_app_import");
    assert.ok(sheetNames(FILES.web).includes(SHEETS.web), "web_app_import");
    assert.ok(sheetNames(FILES.toovoidud).includes(SHEETS.toovoidud), "toovoidud_app_import");
    assert.ok(sheetNames(FILES.links).includes(SHEETS.publicRelatedLinks), "public_related_links");
    assert.ok(sheetNames(FILES.links).includes(SHEETS.smokeTest), "cross_layer_smoke_test");
  });
  check("v1 excluded/review sheet names exist", () => {
    assert.ok(sheetNames(FILES.opinions).includes(SHEETS.opinionsExcluded));
    assert.ok(sheetNames(FILES.web).includes(SHEETS.webExcluded));
    assert.ok(sheetNames(FILES.toovoidud).includes(SHEETS.toovoidudExcluded));
  });

  // ---- v1 counts ----
  check("web import rows = 1131", () => assert.equal(staged.web.length, EXPECTED_ROWS.web));
  check("opinions import rows = 750", () => assert.equal(staged.opinions.length, EXPECTED_ROWS.opinions));
  check("toovoidud import rows = 90", () => assert.equal(staged.toovoidud.length, EXPECTED_ROWS.toovoidud));
  check("total importable rows = 1971", () => assert.equal(staged.all.length, EXPECTED_ROWS.totalImportable));
  check("excluded/review counts (1 / 9 / 7)", () => {
    assert.equal(excluded.web.length, EXPECTED_ROWS.webExcluded);
    assert.equal(excluded.opinions.length, EXPECTED_ROWS.opinionsExcluded);
    assert.equal(excluded.toovoidud.length, EXPECTED_ROWS.toovoidudExcluded);
  });

  // ---- import flags + summary fields ----
  check("every import row has the layer import flag TRUE", () =>
    assert.ok(staged.all.every((s) => s.importEligible), "all import rows must be import-eligible"));
  check("every import row has a non-empty public summary", () =>
    assert.ok(staged.all.every((s) => s.summary && s.summary.trim() !== ""), "all rows need a summary"));
  check("no import-sheet row has a FALSE import flag", () => assert.equal(analysis.importFlagViolations.length, 0));

  // ---- public gate ----
  check("all import-eligible rows are public (v1 gate)", () => {
    assert.equal(analysis.perDataset.web.public, EXPECTED_ROWS.web);
    assert.equal(analysis.perDataset.opinions.public, EXPECTED_ROWS.opinions);
    assert.equal(analysis.perDataset.toovoidud.public, EXPECTED_ROWS.toovoidud);
  });
  check("computeVisibility requires the import flag", () => {
    const sample: StagedContent = { ...staged.web.find((s) => s.isPublic)!, importEligible: false };
    assert.equal(computeVisibility(sample), false);
  });
  check("computeVisibility requires a summary", () => {
    const sample: StagedContent = { ...staged.opinions.find((s) => s.isPublic)!, summary: "" };
    assert.equal(computeVisibility(sample), false);
  });

  // ---- no excluded rows imported ----
  check("no excluded/review id appears in the import sheets", () => {
    const importIds = new Set(staged.all.map((s) => s.externalId));
    for (const ids of [excluded.web, excluded.opinions, excluded.toovoidud]) {
      for (const id of ids) assert.ok(!importIds.has(id), `${id} leaked into import`);
    }
  });

  // ---- public links target only imported rows; candidate links are not public ----
  check("public related links target only imported content", () => {
    assert.equal(analysis.links.targetsNotImported.length, 0);
    assert.equal(analysis.links.targetsExcluded.length, 0);
  });
  check("public related links have acceptable confidence (high/curated_medium)", () =>
    assert.equal(analysis.links.lowOrRejected.length, 0));
  check("candidate/review and blocked links exist but are kept out of public links", () => {
    assert.ok(analysis.links.candidate > 0, "candidate sheet should have rows");
    assert.ok(analysis.links.blocked > 0, "blocked sheet should have rows");
    // Public links come only from public_related_links, a different sheet.
    assert.ok(analysis.links.publicRelated > 0);
  });
  check("evidenceLinkTypeForTarget maps each layer", () => {
    assert.equal(evidenceLinkTypeForTarget("opinions"), "related_opinion");
    assert.equal(evidenceLinkTypeForTarget("web"), "related_news");
    assert.equal(evidenceLinkTypeForTarget("toovoidud"), "related_work_win");
  });

  // ---- display tags never expose the cross-sector fallback ----
  check("public activity display tags never contain Kõik tegevusalad / valdkondadeülene", () =>
    assert.equal(analysis.crossSectorDisplayTagRows.length, 0));

  // ---- töövõit date regressions ----
  check("töövõit date regressions all safe", () => {
    for (const dr of analysis.dateRegressions) assert.ok(dr.ok, `${dr.id} ${dr.field}=${dr.value}: ${dr.note}`);
    assert.ok(analysis.dateRegressions.length >= 2, "expected panditulumaks + soolise tasakaalu checks");
  });
  check("panditulumaks does not use 2026-06-24 as display date", () => {
    const pandi = staged.toovoidud.find((s) => s.title.toLowerCase().includes("panditulumaks"));
    assert.ok(pandi, "panditulumaks töövõit present");
    assert.notEqual(pandi!.date?.toISOString().slice(0, 10), "2026-06-24");
  });
  check("börsiettevõtete soolise tasakaalu töövõit uses year precision, deadline 30.06.2026 stays a deadline", () => {
    const sooline = staged.toovoidud.find((s) => s.title.toLowerCase().includes("soolise tasakaalu"));
    assert.ok(sooline, "soolise tasakaalu töövõit present");
    assert.equal(sooline!.displayDatePrecision, "year");
    assert.notEqual(sooline!.date?.toISOString().slice(0, 10), "2026-12-31");
    assert.equal(sooline!.deadlineDate?.toISOString().slice(0, 10), "2026-06-30");
  });

  // ---- specific regression rows ----
  check("WEB-00002 sugar tax is importable and public", () => {
    const row = byId(staged.web, "WEB-00002");
    assert.ok(row, "WEB-00002 present");
    assert.ok(row!.isPublic, "WEB-00002 public");
    assert.ok(row!.summary && row!.summary.length > 0);
  });
  check("Uudiste arhiiv (WEB-03801) is excluded, not imported", () => {
    assert.ok(!byId(staged.web, "WEB-03801"), "must not be in import sheet");
    assert.ok(excluded.web.includes("WEB-03801"), "must be in web_excluded_review");
  });
  check("Oliver Väärtnõu organization news (WEB-02846) creates no sector relationship", () => {
    const row = byId(staged.web, "WEB-02846");
    assert.ok(row, "WEB-02846 present");
    assert.equal(row!.tegevusalad.length, 0, "org news must have no sector/activity tags");
    assert.equal(row!.publicActivityDisplayTags, null, "no display tags");
  });

  // ---- public summaries free of raw date fragments (warning, surfaced) ----
  check("raw-fragment summaries are surfaced as a warning, not a hard error", () => {
    assert.ok(analysis.ok, `analysis should pass: ${analysis.errors.join("; ")}`);
    // It is acceptable for the producer package to carry rare residual fragments;
    // they must be reported as warnings, never silently dropped.
    if (analysis.rawFragmentSummaryRows.length > 0) {
      assert.ok(analysis.warnings.some((w) => w.includes("raw date fragment")));
    }
  });

  // ---- smoke test ----
  check("cross-layer smoke test has no blocker failures", () => assert.equal(analysis.smokeTest.blockerFailures.length, 0));
  check("taxonomy rulebook file is recorded", () => {
    assert.ok(analysis.taxonomyReference.fileName.includes("koda_taxonomy_rules_v1"));
    assert.ok(analysis.taxonomyReference.bytes > 0);
  });

  // ---- duplicate detection still works ----
  check("duplicate external IDs are detected as errors", () => {
    const dup = { ...staged, web: [...staged.web, staged.web[0]] };
    const a = analyze({ ...dup, all: [...dup.web, ...dup.opinions, ...dup.toovoidud] }, links, excluded);
    assert.ok(a.errors.some((e) => e.includes("duplicate external IDs")), "expected duplicate-id error");
    assert.ok(!a.ok);
  });

  // ---- determinism ----
  check("staging is deterministic", () => {
    assert.equal(
      JSON.stringify(staged2.all.map((s) => [s.externalId, s.contentHash, s.isPublic])),
      JSON.stringify(staged.all.map((s) => [s.externalId, s.contentHash, s.isPublic]))
    );
  });

  check("overall v1 analysis passes", () => assert.ok(analysis.ok, analysis.errors.join("; ")));

  console.log(`\n[test] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

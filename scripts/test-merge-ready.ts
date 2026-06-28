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
  stageNewsOnlyToovoitIds,
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
  const newsOnly = stageNewsOnlyToovoitIds();
  const analysis = analyze(staged, links, excluded, newsOnly);

  const byId = (rows: StagedContent[], id: string) => rows.find((s) => s.externalId === id);

  console.log("\n[test] running checks:");

  // ---- v1 sheet names ----
  check("v1 import sheet names exist in each workbook", () => {
    assert.ok(sheetNames(FILES.opinions).includes(SHEETS.opinions), "opinions_app_import");
    assert.ok(sheetNames(FILES.web).includes(SHEETS.web), "web_app_import");
    assert.ok(sheetNames(FILES.toovoidud).includes(SHEETS.toovoidud), "toovoidud_app_import");
    assert.ok(sheetNames(FILES.links).includes(SHEETS.publicRelatedLinks), "public_related_links");
    assert.ok(sheetNames(FILES.links).includes(SHEETS.policyThreads), "policy_threads");
  });
  check("v1 excluded/review sheet names exist", () => {
    assert.ok(sheetNames(FILES.opinions).includes(SHEETS.opinionsExcluded));
    assert.ok(sheetNames(FILES.web).includes(SHEETS.webExcluded));
    assert.ok(sheetNames(FILES.toovoidud).includes(SHEETS.toovoidudExcluded));
  });

  // ---- v1 counts ----
  check(`web import rows = ${EXPECTED_ROWS.web}`, () => assert.equal(staged.web.length, EXPECTED_ROWS.web));
  check(`opinions import rows = ${EXPECTED_ROWS.opinions}`, () => assert.equal(staged.opinions.length, EXPECTED_ROWS.opinions));
  check(`toovoidud import rows = ${EXPECTED_ROWS.toovoidud} (v1.2)`, () => assert.equal(staged.toovoidud.length, EXPECTED_ROWS.toovoidud));
  check(`total importable rows = ${EXPECTED_ROWS.totalImportable}`, () => assert.equal(staged.all.length, EXPECTED_ROWS.totalImportable));
  check(`excluded/review counts (${EXPECTED_ROWS.webExcluded} / ${EXPECTED_ROWS.opinionsExcluded} / ${EXPECTED_ROWS.toovoidudExcluded})`, () => {
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
  check("all import-eligible rows are public (v1 gate); töövõidud = 122", () => {
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
  check("public related links and policy threads match final counts", () => {
    assert.equal(analysis.links.publicRelated, EXPECTED_ROWS.publicRelatedLinks);
    assert.equal(analysis.rowCounts.policyThreads, EXPECTED_ROWS.policyThreads);
    assert.equal(analysis.rowCounts.publicPolicyThreads, EXPECTED_ROWS.publicPolicyThreads);
    assert.equal(analysis.links.candidate, 0);
    assert.equal(analysis.links.blocked, 0);
  });
  check("evidenceLinkTypeForTarget maps each layer", () => {
    assert.equal(evidenceLinkTypeForTarget("opinions"), "related_opinion");
    assert.equal(evidenceLinkTypeForTarget("opinion"), "related_opinion");
    assert.equal(evidenceLinkTypeForTarget("web"), "related_news");
    assert.equal(evidenceLinkTypeForTarget("toovoidud"), "related_work_win");
    assert.equal(evidenceLinkTypeForTarget("toovoit"), "related_work_win");
  });

  // ---- display tags never expose the cross-sector fallback ----
  check("public activity display tags never contain Kõik tegevusalad / valdkondadeülene", () =>
    assert.equal(analysis.crossSectorDisplayTagRows.length, 0));
  check("organization news rows do not materialize public sector tags", () => {
    const withSectorTags = staged.web.filter((s) => s.contentRoleFinal === "organization_news" && s.tegevusalad.length > 0);
    assert.equal(withSectorTags.length, 0);
  });

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
  check("börsiettevõtete soolise tasakaalu töövõit does not use 2026-12-31 as its date", () => {
    // The v1.5 slim sheet no longer carries display_date_precision/deadline_date;
    // the safety invariant is that the year-end placeholder is never the date.
    const sooline = staged.toovoidud.find((s) => s.title.toLowerCase().includes("soolise tasakaalu"));
    assert.ok(sooline, "soolise tasakaalu töövõit present");
    assert.notEqual(sooline!.date?.toISOString().slice(0, 10), "2026-12-31");
  });

  // ---- v1.2 töövõidud nesting / backfill ----
  check("töövõit row_origin breakdown is 90 / 18 / 14", () => {
    assert.equal(analysis.toovoidudOrigins["original_90_locked"] ?? 0, EXPECTED_ROWS.toovoidudOriginal90);
    assert.equal(analysis.toovoidudOrigins["phase2_new_standalone"] ?? 0, EXPECTED_ROWS.toovoidudPhase2Standalone);
    assert.equal(analysis.toovoidudOrigins["phase2_series_nested"] ?? 0, EXPECTED_ROWS.toovoidudSeriesNested);
  });
  check("töövõit ids are unique (no duplicate toovoit_id)", () => {
    assert.deepEqual(analysis.duplicateExternalIds.toovoidud ?? [], []);
    const ids = new Set(staged.toovoidud.map((s) => s.externalId));
    assert.equal(ids.size, staged.toovoidud.length);
  });
  check("108 standalone top-level cards, 14 nested rows, 7 policy threads", () => {
    assert.equal(analysis.nesting.topLevel, 108);
    assert.equal(analysis.nesting.nested, 14);
    assert.equal(analysis.nesting.threads, 7);
  });
  check("every nested row resolves to a parent or a policy thread (none unresolved)", () =>
    assert.equal(analysis.nesting.unresolved.length, 0));
  check("phase2_series_nested rows all use a nested display_type", () =>
    assert.equal(analysis.nesting.seriesNotNested.length, 0));
  check("no nested row references a missing parent töövõit", () =>
    assert.equal(analysis.nesting.invalidParentRefs.length, 0));
  check("no unknown display_type / row_origin values", () => {
    assert.equal(analysis.nesting.invalidDisplayType.length, 0);
    assert.equal(analysis.nesting.invalidRowOrigin.length, 0);
  });
  check("news_only_recommendations (7) are NOT imported as töövõidud", () => {
    assert.equal(analysis.newsOnly.count, EXPECTED_ROWS.toovoidudNewsOnly);
    assert.equal(analysis.newsOnly.leakedIntoImport.length, 0);
  });
  check("an unknown display_type fails validation (loud, not silent)", () => {
    const broken = staged.toovoidud.map((s, i) => (i === 0 ? { ...s, displayType: "totally_made_up" } : s));
    const a = analyze({ ...staged, toovoidud: broken, all: [...staged.web, ...staged.opinions, ...broken] }, links, excluded);
    assert.ok(!a.ok, "analysis must fail on an unknown display_type");
    assert.ok(a.errors.some((e) => e.includes("unknown display_type")));
  });
  check("a series/nested row left as standalone_card fails validation", () => {
    const idx = staged.toovoidud.findIndex((s) => s.rowOrigin === "phase2_series_nested");
    assert.ok(idx >= 0, "have a series/nested row to mutate");
    const broken = staged.toovoidud.map((s, i) => (i === idx ? { ...s, displayType: "standalone_card" } : s));
    const a = analyze({ ...staged, toovoidud: broken, all: [...staged.web, ...staged.opinions, ...broken] }, links, excluded);
    assert.ok(!a.ok && a.errors.some((e) => e.includes("standalone display_type")));
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

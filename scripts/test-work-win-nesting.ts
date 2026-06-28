/**
 * Pure unit tests for the v1.2 töövõidud nesting/timeline model.
 *
 *   npm run nesting:test
 *
 * DB-free: exercises src/lib/work-win-nesting.ts on synthetic rows so the
 * series/nested/timeline resolution is verified without a database.
 */
import assert from "node:assert";
import {
  compareTimeline,
  compareTimelineDesc,
  isNestedDisplay,
  isStandaloneDisplay,
  isValidDisplayType,
  isValidRowOrigin,
  resolveWorkWinNesting,
  timelineStageLabel,
  type WorkWinNestingInput,
} from "../src/lib/work-win-nesting";

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

function row(p: Partial<WorkWinNestingInput> & { id: string }): WorkWinNestingInput {
  return {
    externalId: p.id,
    rowOrigin: null,
    displayType: null,
    parentToovoitId: null,
    parentCandidateId: null,
    policyThreadKey: null,
    policyThreadTitle: null,
    timelineYear: null,
    timelineStage: null,
    ...p,
  };
}

console.log("[test] work-win nesting (pure):");

check("valid value guards", () => {
  assert.ok(isValidRowOrigin("phase2_series_nested"));
  assert.ok(!isValidRowOrigin("nope"));
  assert.ok(isValidDisplayType("timeline_item_in_policy_thread"));
  assert.ok(!isValidDisplayType("totally_made_up"));
});

check("standalone/null display is top-level; the three nested types are nested", () => {
  assert.ok(isStandaloneDisplay(null)); // legacy default
  assert.ok(isStandaloneDisplay("standalone_card"));
  assert.ok(!isNestedDisplay("standalone_card"));
  for (const d of ["nested_under_existing_card", "nested_under_new_series_card", "timeline_item_in_policy_thread"]) {
    assert.ok(isNestedDisplay(d), d);
    assert.ok(!isStandaloneDisplay(d), d);
  }
});

check("timelineStageLabel maps known stages, null for unknown", () => {
  assert.equal(timelineStageLabel("riigikogu_adoption"), "Riigikogu vastuvõtmine");
  assert.equal(timelineStageLabel("final_entry_into_force"), "Jõustumine");
  assert.equal(timelineStageLabel("unclear"), null);
  assert.equal(timelineStageLabel(null), null);
});

check("compareTimeline orders by year then chronological stage", () => {
  const a = row({ id: "a", timelineYear: 2016, timelineStage: "riigikogu_adoption" });
  const b = row({ id: "b", timelineYear: 2022, timelineStage: "proposal" });
  const c = row({ id: "c", timelineYear: 2022, timelineStage: "final_entry_into_force" });
  const sorted = [c, b, a].sort(compareTimeline).map((r) => r.id);
  assert.deepEqual(sorted, ["a", "b", "c"]);
});

check("compareTimelineDesc orders latest-first (newest year/stage on top, no-year last)", () => {
  const a = row({ id: "a", timelineYear: 2016, timelineStage: "riigikogu_adoption" });
  const b = row({ id: "b", timelineYear: 2022, timelineStage: "proposal" });
  const c = row({ id: "c", timelineYear: 2022, timelineStage: "final_entry_into_force" });
  const d = row({ id: "d", timelineYear: null }); // unknown year sinks to the bottom
  const sorted = [a, d, b, c].sort(compareTimelineDesc).map((r) => r.id);
  // 2022 final_entry_into_force, 2022 proposal, 2016, then the no-year row.
  assert.deepEqual(sorted, ["c", "b", "a", "d"]);
});

check("standalone rows are all top-level; no nested, no threads", () => {
  const rows = [
    row({ id: "T1", displayType: "standalone_card" }),
    row({ id: "T2", displayType: "standalone_card" }),
    row({ id: "T3" }), // null display ⇒ standalone (legacy)
  ];
  const n = resolveWorkWinNesting(rows);
  assert.equal(n.topLevelIds.size, 3);
  assert.equal(n.nestedIds.size, 0);
  assert.equal(n.threads.length, 0);
  assert.equal(n.unresolved.length, 0);
});

check("nested_under_existing_card folds under its parent_toovoit_id", () => {
  const rows = [
    row({ id: "TOOVOIT-0001", displayType: "standalone_card" }),
    row({
      id: "SERIES-0011",
      displayType: "nested_under_existing_card",
      parentToovoitId: "TOOVOIT-0001",
      policyThreadKey: "security_tax_profit_tax_thread",
      timelineYear: 2025,
    }),
  ];
  const n = resolveWorkWinNesting(rows);
  assert.deepEqual([...(n.topLevelIds)], ["TOOVOIT-0001"]);
  assert.ok(n.nestedIds.has("SERIES-0011"));
  assert.deepEqual(n.childrenByParentId.get("TOOVOIT-0001"), ["SERIES-0011"]);
  assert.equal(n.parentIdByMemberId.get("SERIES-0011"), "TOOVOIT-0001");
  // Singleton thread key for the child does NOT create a thread card.
  assert.equal(n.threads.length, 0);
});

check("timeline items with no top-level parent group into a policy thread, sorted", () => {
  const key = "foreign_labour_and_migration_flexibility";
  const title = "Välistööjõu ja töörände paindlikumaks muutmine";
  const rows = [
    row({ id: "S1", displayType: "timeline_item_in_policy_thread", parentCandidateId: key, policyThreadKey: key, policyThreadTitle: title, timelineYear: 2022, timelineStage: "riigikogu_adoption" }),
    row({ id: "S2", displayType: "timeline_item_in_policy_thread", parentCandidateId: key, policyThreadKey: key, policyThreadTitle: title, timelineYear: 2016, timelineStage: "riigikogu_adoption" }),
    row({ id: "S3", displayType: "timeline_item_in_policy_thread", parentCandidateId: key, policyThreadKey: key, policyThreadTitle: title, timelineYear: 2026, timelineStage: "final_entry_into_force" }),
  ];
  const n = resolveWorkWinNesting(rows);
  assert.equal(n.topLevelIds.size, 0);
  assert.equal(n.threads.length, 1);
  const t = n.threads[0];
  assert.equal(t.key, key);
  assert.equal(t.title, title);
  assert.equal(t.latestYear, 2026);
  assert.deepEqual(t.memberIds, ["S3", "S1", "S2"]); // latest-first: 2026, 2022, 2016
  for (const id of ["S1", "S2", "S3"]) assert.equal(n.threadKeyByMemberId.get(id), key);
});

check("nested_under_new_series_card with a non-imported parent falls back to its thread", () => {
  const key = "minor_employment_flexibility";
  const rows = [
    row({ id: "S4", displayType: "timeline_item_in_policy_thread", policyThreadKey: key, timelineYear: 2017, timelineStage: "simplification" }),
    row({ id: "S8", displayType: "nested_under_new_series_card", parentCandidateId: "P2CAND-0037", policyThreadKey: key, timelineYear: 2026, timelineStage: "final_entry_into_force" }),
  ];
  const n = resolveWorkWinNesting(rows);
  // P2CAND-0037 is not an imported top-level row, so S8 joins the thread, not a card.
  assert.equal(n.threads.length, 1);
  assert.deepEqual(n.threads[0].memberIds, ["S8", "S4"]); // latest-first: 2026, 2017
  assert.equal(n.unresolved.length, 0);
});

check("parent_toovoit_id takes priority over policy thread for attachment", () => {
  const rows = [
    row({ id: "P", displayType: "standalone_card", policyThreadKey: "shared" }),
    row({ id: "C", displayType: "nested_under_existing_card", parentToovoitId: "P", policyThreadKey: "shared", timelineYear: 2024 }),
  ];
  const n = resolveWorkWinNesting(rows);
  assert.deepEqual(n.childrenByParentId.get("P"), ["C"]);
  assert.equal(n.threads.length, 0); // attached to the card, not grouped as a thread
});

check("a nested row with neither parent nor thread is reported as unresolved", () => {
  const rows = [row({ id: "orphan", displayType: "timeline_item_in_policy_thread" })];
  const n = resolveWorkWinNesting(rows);
  assert.equal(n.unresolved.length, 1);
  assert.equal(n.unresolved[0].id, "orphan");
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

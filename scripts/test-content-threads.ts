/**
 * Pure unit tests for admin-managed topic threads.
 *
 *   npm run threads:test
 *
 * DB-free: exercises src/lib/content-threads.ts on synthetic rows so role/status
 * validation, chronological ordering, externalId resolution and the public gate
 * are verified without a database.
 */
import assert from "node:assert";
import {
  compareThreadItems,
  filterPublicThreadMembers,
  isThreadPublic,
  isValidRole,
  isValidStatus,
  resolveThreadMembers,
  roleLabel,
  statusLabel,
  type ThreadItemMeta,
} from "../src/lib/content-threads";
import type { EligibilityFields } from "../src/lib/eligibility";

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

type Row = { id: string; externalId: string | null; date: Date | null } & EligibilityFields;

function row(p: Partial<Row> & { id: string }): Row {
  return {
    id: p.id,
    externalId: p.externalId ?? p.id,
    date: p.date ?? null,
    isPublic: p.isPublic ?? true,
    isHidden: p.isHidden ?? false,
    needsHumanReview: p.needsHumanReview ?? false,
    numericClaimNeedsReview: p.numericClaimNeedsReview,
    importStatus: p.importStatus ?? null,
    importAction: p.importAction ?? null,
    publicDisplayAllowed: p.publicDisplayAllowed ?? null,
    publicDisplayStatus: p.publicDisplayStatus ?? null,
    adminVisibilityOverride: p.adminVisibilityOverride ?? null,
    sourceDataset: p.sourceDataset ?? "web",
  };
}

function meta(p: Partial<ThreadItemMeta> & { contentExternalId: string }): ThreadItemMeta {
  return {
    contentExternalId: p.contentExternalId,
    role: p.role ?? null,
    note: p.note ?? null,
    sortOrder: p.sortOrder ?? 0,
    isAnchor: p.isAnchor ?? false,
  };
}

console.log("[test] content threads (pure):");

check("role validation + labels", () => {
  assert.ok(isValidRole("work_win"));
  assert.ok(isValidRole("milestone"));
  assert.ok(!isValidRole("nope"));
  assert.ok(!isValidRole(null));
  assert.strictEqual(roleLabel("work_win"), "Töövõit");
  assert.strictEqual(roleLabel(null), "—");
  assert.strictEqual(roleLabel("bogus"), "—");
});

check("status validation + public gate", () => {
  assert.ok(isValidStatus("draft"));
  assert.ok(isValidStatus("internal"));
  assert.ok(isValidStatus("public"));
  assert.ok(!isValidStatus("published"));
  assert.ok(isThreadPublic("public"));
  assert.ok(!isThreadPublic("draft"));
  assert.ok(!isThreadPublic("internal"));
  assert.ok(!isThreadPublic(null));
  assert.strictEqual(statusLabel("public"), "Avalik");
});

check("resolveThreadMembers orders chronologically (oldest first) by date", () => {
  const items = [
    meta({ contentExternalId: "C" }),
    meta({ contentExternalId: "A" }),
    meta({ contentExternalId: "B" }),
  ];
  const content = [
    row({ id: "A", date: new Date("2023-01-01") }),
    row({ id: "B", date: new Date("2024-01-01") }),
    row({ id: "C", date: new Date("2025-01-01") }),
  ];
  const { members, unresolved } = resolveThreadMembers(items, content);
  assert.deepStrictEqual(members.map((m) => m.content.id), ["A", "B", "C"]);
  assert.strictEqual(unresolved.length, 0);
});

check("undated members sort last", () => {
  const items = [meta({ contentExternalId: "X" }), meta({ contentExternalId: "Y" })];
  const content = [row({ id: "X", date: null }), row({ id: "Y", date: new Date("2020-01-01") })];
  const { members } = resolveThreadMembers(items, content);
  assert.deepStrictEqual(members.map((m) => m.content.id), ["Y", "X"]);
});

check("manual sortOrder overrides chronological order", () => {
  const items = [
    meta({ contentExternalId: "A", sortOrder: 0 }), // 2023
    meta({ contentExternalId: "B", sortOrder: -1 }), // 2024 but pinned first
  ];
  const content = [
    row({ id: "A", date: new Date("2023-01-01") }),
    row({ id: "B", date: new Date("2024-01-01") }),
  ];
  const { members } = resolveThreadMembers(items, content);
  assert.deepStrictEqual(members.map((m) => m.content.id), ["B", "A"]);
});

check("compareThreadItems tie-break is stable by id", () => {
  const a = { meta: meta({ contentExternalId: "a" }), content: row({ id: "a", date: new Date("2024-01-01") }) };
  const b = { meta: meta({ contentExternalId: "b" }), content: row({ id: "b", date: new Date("2024-01-01") }) };
  assert.ok(compareThreadItems(a, b) < 0);
  assert.ok(compareThreadItems(b, a) > 0);
});

check("unresolved externalIds are reported, not thrown", () => {
  const items = [meta({ contentExternalId: "GONE" }), meta({ contentExternalId: "HERE" })];
  const content = [row({ id: "HERE" })];
  const { members, unresolved } = resolveThreadMembers(items, content);
  assert.deepStrictEqual(members.map((m) => m.content.id), ["HERE"]);
  assert.deepStrictEqual(unresolved, ["GONE"]);
});

check("filterPublicThreadMembers hides draft/internal threads entirely", () => {
  const items = [meta({ contentExternalId: "A" })];
  const content = [row({ id: "A" })];
  const { members } = resolveThreadMembers(items, content);
  assert.strictEqual(filterPublicThreadMembers("draft", members).length, 0);
  assert.strictEqual(filterPublicThreadMembers("internal", members).length, 0);
  assert.strictEqual(filterPublicThreadMembers("public", members).length, 1);
});

check("public thread drops non-eligible members (defence in depth)", () => {
  const items = [
    meta({ contentExternalId: "OK" }),
    meta({ contentExternalId: "HIDDEN" }),
    meta({ contentExternalId: "REVIEW" }),
    meta({ contentExternalId: "FORCED_OFF" }),
    meta({ contentExternalId: "FORCED_ON" }),
  ];
  const content = [
    row({ id: "OK", date: new Date("2024-01-01") }),
    row({ id: "HIDDEN", isHidden: true }),
    row({ id: "REVIEW", needsHumanReview: true }),
    row({ id: "FORCED_OFF", adminVisibilityOverride: false }),
    // not otherwise public, but admin forced it on
    row({ id: "FORCED_ON", isPublic: false, adminVisibilityOverride: true, date: new Date("2025-01-01") }),
  ];
  const { members } = resolveThreadMembers(items, content);
  const publicMembers = filterPublicThreadMembers("public", members);
  const ids = publicMembers.map((m) => m.content.id).sort();
  assert.deepStrictEqual(ids, ["FORCED_ON", "OK"]);
});

console.log(`\n[test] content threads: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

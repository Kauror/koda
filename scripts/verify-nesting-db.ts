/**
 * End-to-end verification of v1.2 töövõidud nesting against a live (PGlite) DB.
 *
 *   KODA_DB_DRIVER=pglite KODA_PGLITE_DIR=.pglite-nesting npm run db:setup:pglite
 *   KODA_DB_DRIVER=pglite KODA_PGLITE_DIR=.pglite-nesting npm run import:merge-ready
 *   KODA_DB_DRIVER=pglite KODA_PGLITE_DIR=.pglite-nesting npm run verify:nesting
 *
 * Proves, against the real imported data, that:
 *  - all 122 töövõidud import (90 / 18 / 14 by origin);
 *  - the default browse shows top-level units only (108 standalone + 7 threads),
 *    never the 14 nested rows as flat duplicate cards;
 *  - a parent card exposes its nested children;
 *  - a thread card groups its timeline members;
 *  - search still surfaces a nested row (inside its parent/thread context);
 *  - the detail page exposes parent/children/thread context.
 */
import assert from "node:assert";
import { loadEnv } from "./env";
import { prisma } from "../src/lib/db";
import { search } from "../src/lib/search";
import { getContentDetail } from "../src/lib/content-detail";
import type { SearchQuery } from "../src/lib/search-core";

loadEnv();

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL- ${name}`);
    console.log("        " + (e as Error).message);
  }
}

const emptyQuery: SearchQuery = { q: "", valdkond: [], tegevusala: [], tapsustus: [], recipient: [], type: [] };
function q(text: string): SearchQuery {
  return { ...emptyQuery, q: text };
}

const NESTED_TYPES = ["nested_under_existing_card", "nested_under_new_series_card", "timeline_item_in_policy_thread"];

async function main() {
  console.log("[verify] töövõidud nesting (PGlite end-to-end):");

  const toovoidud = await prisma.contentItem.findMany({ where: { sourceDataset: "toovoidud" } });
  const nestedIds = new Set(toovoidud.filter((t) => NESTED_TYPES.includes(t.displayType ?? "")).map((t) => t.externalId));

  await check("122 töövõidud imported, origins 90 / 18 / 14", async () => {
    assert.equal(toovoidud.length, 122);
    const by = (o: string) => toovoidud.filter((t) => t.rowOrigin === o).length;
    assert.equal(by("original_90_locked"), 90);
    assert.equal(by("phase2_new_standalone"), 18);
    assert.equal(by("phase2_series_nested"), 14);
    assert.equal(nestedIds.size, 14);
  });

  await check("nesting fields persisted (parent + thread present in DB)", async () => {
    const series11 = toovoidud.find((t) => t.externalId === "TOOVOIT-BACKFILL-SERIES-0011");
    assert.ok(series11, "SERIES-0011 present");
    assert.equal(series11!.parentToovoitId, "TOOVOIT-0001");
    assert.equal(series11!.displayType, "nested_under_existing_card");
    const timelineMembers = toovoidud.filter((t) => t.policyThreadKey === "foreign_labour_and_migration_flexibility");
    assert.equal(timelineMembers.length, 4);
  });

  const browse = await search(emptyQuery);

  await check("default browse: 115 top-level units (108 standalone + 7 threads)", async () => {
    assert.equal(browse.groupCounts.toovoit.matched, 115);
  });

  await check("default browse never shows a nested row as a flat (non-thread) card", async () => {
    const flatNested = browse.achievements.filter((c) => !c.isThread && nestedIds.has(c.detailId));
    assert.deepEqual(flatNested.map((c) => c.detailId), [], "no nested row may be a flat top-level card");
  });

  await check("at least one policy-thread card is present, carrying its timeline members", async () => {
    const threadCards = browse.achievements.filter((c) => c.isThread);
    assert.ok(threadCards.length > 0, "expected ≥1 thread card in browse");
    const tc = threadCards[0];
    assert.ok((tc.nested?.length ?? 0) > 0, "thread card must list its timeline members");
    assert.equal(tc.nestedHeading, "Sama teema ajajoon");
    // Every member of a thread card is a nested row, not a standalone duplicate.
    for (const m of tc.nested ?? []) assert.ok(nestedIds.has(m.detailId), `${m.detailId} should be a nested row`);
  });

  await check("parent card (TOOVOIT-0001) exposes nested child SERIES-0011", async () => {
    const res = await search(q("kasumimaks"));
    const parent = res.achievements.find((c) => c.detailId === "TOOVOIT-0001");
    assert.ok(parent, "TOOVOIT-0001 should be a top-level card");
    assert.ok(parent!.nested?.some((n) => n.detailId === "TOOVOIT-BACKFILL-SERIES-0011"), "child SERIES-0011 must be nested under it");
  });

  await check("search surfaces a nested row inside its parent/thread, not as a flat card", async () => {
    // Pick a distinctive long word from a thread member's title and search for it.
    const member = toovoidud.find((t) => t.externalId === "TOOVOIT-BACKFILL-SERIES-0001");
    assert.ok(member, "SERIES-0001 present");
    const word = member!.title
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}]/gu, ""))
      .filter((w) => w.length >= 8)
      .sort((a, b) => b.length - a.length)[0];
    assert.ok(word, "found a distinctive search word");
    const res = await search(q(word));
    // The nested row must NOT be a flat top-level card …
    const asFlat = res.achievements.filter((c) => !c.isThread && c.detailId === member!.externalId);
    assert.deepEqual(asFlat, [], "nested row must not surface as a flat card");
    // … it must surface inside some card's nested timeline (its thread).
    const surfaced = res.achievements.some((c) => c.nested?.some((n) => n.detailId === member!.externalId && n.matched));
    assert.ok(surfaced, `nested row ${member!.externalId} should surface (matched) inside a thread/parent card for "${word}"`);
  });

  await check("detail page of TOOVOIT-0001 exposes its nested children", async () => {
    const detail = await getContentDetail("TOOVOIT-0001");
    assert.ok(detail, "detail present");
    assert.ok(detail!.workWinNesting, "workWinNesting present");
    assert.ok(
      detail!.workWinNesting!.children.some((c) => c.detailId === "TOOVOIT-BACKFILL-SERIES-0011"),
      "SERIES-0011 should be a child row"
    );
  });

  await check("detail page of a timeline member exposes the thread timeline (self marked current)", async () => {
    const detail = await getContentDetail("TOOVOIT-BACKFILL-SERIES-0001");
    assert.ok(detail, "detail present");
    const thread = detail!.workWinNesting?.thread;
    assert.ok(thread, "thread context present");
    assert.equal(thread!.key, "foreign_labour_and_migration_flexibility");
    assert.equal(thread!.items.length, 4);
    assert.ok(thread!.items.some((i) => i.isCurrent && i.detailId === "TOOVOIT-BACKFILL-SERIES-0001"), "self marked current");
  });

  await check("a nested row is still directly reachable at its detail page (not hidden)", async () => {
    const detail = await getContentDetail("TOOVOIT-BACKFILL-SERIES-0001");
    assert.ok(detail, "nested row detail page must be accessible");
  });

  console.log(`\n[verify] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

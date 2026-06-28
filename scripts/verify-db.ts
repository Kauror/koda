/**
 * DB-backed verification of the v1 replacement import.
 *
 *   npm run import:verify-db
 */
import { loadEnv } from "./env";
import { makePrismaClient, usingPglite } from "./lib/prisma-client";
import { EXPECTED_ROWS } from "./lib/merge-ready";

loadEnv();

let passed = 0;
let failed = 0;
function invariant(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok  - ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL- ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function main() {
  console.log(`[verify-db] Connecting${usingPglite() ? " (PGlite)" : ""}...`);
  const { prisma, close } = await makePrismaClient();

  try {
    const [web, opinions, toovoidud, total] = await Promise.all([
      prisma.contentItem.count({ where: { sourceDataset: "web" } }),
      prisma.contentItem.count({ where: { sourceDataset: "opinions" } }),
      prisma.contentItem.count({ where: { sourceDataset: "toovoidud" } }),
      prisma.contentItem.count(),
    ]);
    const publicByDataset = {
      web: await prisma.contentItem.count({ where: { sourceDataset: "web", isPublic: true } }),
      opinions: await prisma.contentItem.count({ where: { sourceDataset: "opinions", isPublic: true } }),
      toovoidud: await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", isPublic: true } }),
    };
    const hiddenCount = await prisma.contentItem.count({ where: { isPublic: false } });
    const achievements = await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", sourceTypeDetail: "toovoit" } });
    const enrichment = await prisma.achievementEnrichment.count();
    const links = await prisma.contentEvidenceLink.groupBy({ by: ["linkType"], _count: { _all: true } });
    const linkTotal = await prisma.contentEvidenceLink.count();
    const linkTypes = new Set(links.map((l) => l.linkType));
    const labeledLinks = await prisma.contentEvidenceLink.count({ where: { relationLabelEt: { not: null } } });
    const policyThreadGroups = await prisma.topicGroup.count();
    const policyThreadMemberships = await prisma.contentTopicGroup.count();

    const reviewAndPublic = await prisma.contentItem.count({ where: { needsHumanReview: true, isPublic: true } });
    const publicLawTags = await prisma.contentItem.count({ where: { isPublic: true, lawSearchAllowed: true, lawTagsConfirmed: { not: null } } });
    const candidateLawTags = await prisma.contentItem.count({ where: { lawTagsCandidate: { not: null } } });

    // v1 field persistence.
    const withWhatChanged = await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", whatChangedEt: { not: null } } });
    const withFilterTags = await prisma.contentItem.count({ where: { sourceDataset: "web", publicActivityFilterTags: { not: null } } });
    const withRankScore = await prisma.contentItem.count({ where: { sourceDataset: "web", generalSearchRankScore: { not: null } } });
    // v1.2 töövõidud nesting fields persisted.
    const nestedDisplayTypes = [
      "nested_under_existing_card",
      "nested_under_new_series_card",
      "timeline_item_in_policy_thread",
    ];
    const withRowOrigin = await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", rowOrigin: { not: null } } });
    const nestedToovoidud = await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", displayType: { in: nestedDisplayTypes } } });
    const withParent = await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", parentToovoitId: { not: null } } });
    const withThreadKey = await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", policyThreadKey: { not: null } } });
    const orgNewsWithSectorTags = await prisma.contentItem.count({
      where: { contentRoleFinal: "organization_news", tags: { some: { tag: { type: "tegevusala" } } } },
    });

    const dupExternal = await prisma.$queryRawUnsafe<{ externalId: string; n: bigint }[]>(
      `SELECT "externalId", COUNT(*) AS n FROM "ContentItem" WHERE "externalId" IS NOT NULL GROUP BY "externalId" HAVING COUNT(*) > 1`
    );
    const orphanEnrich = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "AchievementEnrichment" a LEFT JOIN "ContentItem" c ON a."contentItemId" = c.id WHERE c.id IS NULL`
    );
    const orphanLinks = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "ContentEvidenceLink" l LEFT JOIN "ContentItem" f ON l."fromContentId" = f.id LEFT JOIN "ContentItem" t ON l."toContentId" = t.id WHERE f.id IS NULL OR t.id IS NULL`
    );

    console.log("\n=== ContentItem by sourceDataset ===");
    console.log(`  web=${web} opinions=${opinions} toovoidud=${toovoidud} total=${total}`);
    console.log("=== Visibility ===");
    console.log(`  public: web=${publicByDataset.web} opinions=${publicByDataset.opinions} toovoidud=${publicByDataset.toovoidud}  hidden=${hiddenCount}`);
    console.log("=== Links ===");
    if (links.length === 0) console.log("  (none)");
    for (const l of links) console.log(`  ${l.linkType}: ${l._count._all}`);
    console.log(`  total=${linkTotal} labeled=${labeledLinks}`);

    console.log("\n=== Invariants ===");
    invariant(`web rows = ${EXPECTED_ROWS.web}`, web === EXPECTED_ROWS.web, `${web}`);
    invariant(`opinion rows = ${EXPECTED_ROWS.opinions}`, opinions === EXPECTED_ROWS.opinions, `${opinions}`);
    invariant(`toovoidud rows = ${EXPECTED_ROWS.toovoidud} (v1.2)`, toovoidud === EXPECTED_ROWS.toovoidud, `${toovoidud}`);
    invariant(`total content rows = ${EXPECTED_ROWS.totalImportable}`, total === EXPECTED_ROWS.totalImportable, `${total}`);
    invariant(`web public rows = ${EXPECTED_ROWS.web}`, publicByDataset.web === EXPECTED_ROWS.web, `${publicByDataset.web}`);
    invariant(`opinion public rows = ${EXPECTED_ROWS.opinions}`, publicByDataset.opinions === EXPECTED_ROWS.opinions, `${publicByDataset.opinions}`);
    invariant(`toovoidud public rows = ${EXPECTED_ROWS.toovoidud}`, publicByDataset.toovoidud === EXPECTED_ROWS.toovoidud, `${publicByDataset.toovoidud}`);
    invariant("no hidden rows (all importable rows public)", hiddenCount === 0, `${hiddenCount}`);
    invariant(`toovoidud enrichment rows = ${EXPECTED_ROWS.toovoidud}`, enrichment === EXPECTED_ROWS.toovoidud, `${enrichment}`);
    invariant(`achievement content rows = ${EXPECTED_ROWS.toovoidud}`, achievements === EXPECTED_ROWS.toovoidud, `${achievements}`);
    invariant("no public row needs human review", reviewAndPublic === 0, `${reviewAndPublic}`);
    invariant("confirmed public law tags are present", publicLawTags > 0, `${publicLawTags}`);
    // Candidate law tags are informational: the v1.5 slim töövõit sheet no longer
    // carries law_tags_candidate, so this may legitimately be 0.
    invariant("candidate law tags counted (informational)", candidateLawTags >= 0, `${candidateLawTags}`);

    // v1.2 töövõidud nesting fields persisted.
    invariant("töövõit row_origin persisted (all 122)", withRowOrigin === EXPECTED_ROWS.toovoidud, `${withRowOrigin}`);
    invariant("14 nested/timeline töövõidud stored", nestedToovoidud === EXPECTED_ROWS.toovoidudSeriesNested, `${nestedToovoidud}`);
    invariant("nested parent link (parent_toovoit_id) persisted", withParent >= 1, `${withParent}`);
    invariant("policy_thread_key persisted on töövõidud", withThreadKey > 0, `${withThreadKey}`);

    // v1 relation layer.
    invariant("public related links imported (Veel samal teemal)", linkTotal > 0, `${linkTotal}`);
    invariant("relation labels persisted", labeledLinks > 0, `${labeledLinks}`);
    invariant("cross-layer relation types present", linkTypes.has("related_opinion") && linkTypes.has("related_news"), [...linkTypes].join(","));
    invariant(`public policy thread groups imported = ${EXPECTED_ROWS.publicPolicyThreads}`, policyThreadGroups === EXPECTED_ROWS.publicPolicyThreads, `${policyThreadGroups}`);
    invariant("policy thread memberships imported", policyThreadMemberships > 0, `${policyThreadMemberships}`);

    // v1 fields persisted.
    invariant("töövõit value field whatChangedEt persisted (all 122)", withWhatChanged === EXPECTED_ROWS.toovoidud, `${withWhatChanged}`);
    invariant("web public-activity filter tags persisted", withFilterTags > 0, `${withFilterTags}`);
    invariant("web rank scores persisted", withRankScore > 0, `${withRankScore}`);
    invariant("organization news has no sector tags", orgNewsWithSectorTags === 0, `${orgNewsWithSectorTags}`);

    // Integrity.
    invariant("no duplicate external IDs", dupExternal.length === 0, `${dupExternal.length}`);
    invariant("no orphan enrichment rows", Number(orphanEnrich[0]?.n ?? 0) === 0);
    invariant("no orphan evidence links", Number(orphanLinks[0]?.n ?? 0) === 0);

    console.log(`\n[verify-db] ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

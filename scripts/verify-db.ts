/**
 * DB-backed verification of the structured merge-ready replacement import.
 *
 * Invariant labels are derived from EXPECTED_ROWS (scripts/lib/merge-ready.ts)
 * so the printed expectation can never drift from the value actually asserted.
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

    const reviewAndPublic = await prisma.contentItem.count({ where: { needsHumanReview: true, isPublic: true } });
    const numericReviewPublic = await prisma.contentItem.count({ where: { numericClaimNeedsReview: true, isPublic: true } });
    const supportPublic = await prisma.contentItem.count({ where: { importAction: "import_support_only", isPublic: true } });
    const stagingPublic = await prisma.contentItem.count({ where: { importAction: "import_staging_only", isPublic: true } });
    const doNotImportPublic = await prisma.contentItem.count({ where: { importAction: "do_not_import_public", isPublic: true } });
    const heldPublic = await prisma.contentItem.count({ where: { importAction: "enrichment_hold", isPublic: true } });
    const candidateLawTags = await prisma.contentItem.count({ where: { lawTagsCandidate: { not: null } } });
    const publicLawTags = await prisma.contentItem.count({ where: { isPublic: true, lawSearchAllowed: true, lawTagsConfirmed: { not: null } } });
    const supportOnly = await prisma.contentItem.count({ where: { sourceDataset: "web", importAction: "import_support_only" } });
    const stagingOnly = await prisma.contentItem.count({ where: { importAction: "import_staging_only" } });
    const webDoNotImport = await prisma.contentItem.count({ where: { sourceDataset: "web", importAction: "do_not_import_public" } });
    const heldToovoidud = await prisma.contentItem.count({ where: { sourceDataset: "toovoidud", importAction: "enrichment_hold" } });

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
    console.log(`  web:       ${web}`);
    console.log(`  opinions:  ${opinions}`);
    console.log(`  toovoidud: ${toovoidud}`);
    console.log(`  total:     ${total}`);

    console.log("\n=== Visibility ===");
    console.log(`  public by dataset: web=${publicByDataset.web} opinions=${publicByDataset.opinions} toovoidud=${publicByDataset.toovoidud}`);
    console.log(`  hidden/support/staging/held: ${hiddenCount}`);

    console.log("\n=== Links ===");
    if (links.length === 0) console.log("  (none)");
    for (const l of links) console.log(`  ${l.linkType}: ${l._count._all}`);
    console.log(`  total: ${linkTotal}`);

    console.log("\n=== Invariants ===");
    const stagingOnlyExpected = EXPECTED_ROWS.webStagingOnly + EXPECTED_ROWS.opinionsStagingOnly;
    invariant(`web rows = ${EXPECTED_ROWS.web}`, web === EXPECTED_ROWS.web, `${web}`);
    invariant(`opinion rows = ${EXPECTED_ROWS.opinions}`, opinions === EXPECTED_ROWS.opinions, `${opinions}`);
    invariant(`toovoidud rows = ${EXPECTED_ROWS.toovoidud}`, toovoidud === EXPECTED_ROWS.toovoidud, `${toovoidud}`);
    invariant(`total content rows = ${EXPECTED_ROWS.totalContentBeforeExclusions}`, total === EXPECTED_ROWS.totalContentBeforeExclusions, `${total}`);
    invariant(`web public rows = ${EXPECTED_ROWS.webPublic}`, publicByDataset.web === EXPECTED_ROWS.webPublic, `${publicByDataset.web}`);
    invariant(`opinion public rows = ${EXPECTED_ROWS.opinionsPublic}`, publicByDataset.opinions === EXPECTED_ROWS.opinionsPublic, `${publicByDataset.opinions}`);
    invariant(`toovoidud public rows = ${EXPECTED_ROWS.toovoidudPublic}`, publicByDataset.toovoidud === EXPECTED_ROWS.toovoidudPublic, `${publicByDataset.toovoidud}`);
    invariant(`web support-only rows = ${EXPECTED_ROWS.webSupportOnly}`, supportOnly === EXPECTED_ROWS.webSupportOnly, `${supportOnly}`);
    invariant(`staging-only rows = ${stagingOnlyExpected}`, stagingOnly === stagingOnlyExpected, `${stagingOnly}`);
    invariant(`web do-not-import rows = ${EXPECTED_ROWS.webDoNotImportPublic}`, webDoNotImport === EXPECTED_ROWS.webDoNotImportPublic, `${webDoNotImport}`);
    invariant(`held toovoidud rows = ${EXPECTED_ROWS.toovoidudHold}`, heldToovoidud === EXPECTED_ROWS.toovoidudHold, `${heldToovoidud}`);
    invariant(`toovoidud enrichment rows = ${EXPECTED_ROWS.toovoidud}`, enrichment === EXPECTED_ROWS.toovoidud, `${enrichment}`);
    invariant(`achievement content rows = ${EXPECTED_ROWS.toovoidud}`, achievements === EXPECTED_ROWS.toovoidud, `${achievements}`);
    invariant("no public row needs human review", reviewAndPublic === 0, `${reviewAndPublic}`);
    invariant("no public row needs numeric review", numericReviewPublic === 0, `${numericReviewPublic}`);
    invariant("no support-only row is public", supportPublic === 0, `${supportPublic}`);
    invariant("no staging-only row is public", stagingPublic === 0, `${stagingPublic}`);
    invariant("no do-not-import row is public", doNotImportPublic === 0, `${doNotImportPublic}`);
    invariant("no held toovoidud row is public", heldPublic === 0, `${heldPublic}`);
    invariant("confirmed public law tags are present", publicLawTags > 0, `${publicLawTags}`);
    invariant("candidate law tags are stored but not filter tags", candidateLawTags > 0, `${candidateLawTags}`);
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

/**
 * DB-backed verification of the merge-ready import.
 *
 *   npm run import:verify-db                 # against DATABASE_URL
 *   KODA_DB_DRIVER=pglite npm run import:verify-db   # against local PGlite
 *
 * Queries the database after an import and reports counts + invariants. Exits
 * non-zero if any core invariant is violated, so it can gate CI / a release.
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
    // --- Counts by source dataset ---
    const [web, opinions, annual, mergeTotal, crawlerOrSeed] = await Promise.all([
      prisma.contentItem.count({ where: { sourceDataset: "web" } }),
      prisma.contentItem.count({ where: { sourceDataset: "opinions" } }),
      prisma.contentItem.count({ where: { sourceDataset: "annual_reports" } }),
      prisma.contentItem.count({ where: { sourceDataset: { not: null } } }),
      prisma.contentItem.count({ where: { sourceDataset: null } }),
    ]);

    const [publicCount, hiddenCount] = await Promise.all([
      prisma.contentItem.count({ where: { sourceDataset: { not: null }, isPublic: true } }),
      prisma.contentItem.count({ where: { sourceDataset: { not: null }, isPublic: false } }),
    ]);

    const achievements = await prisma.contentItem.count({ where: { sourceTypeDetail: "toovoit" } });
    const enrichment = await prisma.achievementEnrichment.count();

    const publicByDataset = {
      web: await prisma.contentItem.count({ where: { sourceDataset: "web", isPublic: true } }),
      opinions: await prisma.contentItem.count({ where: { sourceDataset: "opinions", isPublic: true } }),
      annual_reports: await prisma.contentItem.count({ where: { sourceDataset: "annual_reports", isPublic: true } }),
    };

    // --- Evidence links by type ---
    const links = await prisma.contentEvidenceLink.groupBy({ by: ["linkType"], _count: { _all: true } });
    const linkTotal = await prisma.contentEvidenceLink.count();

    // --- Safety gates ---
    const reviewAndPublic = await prisma.contentItem.count({ where: { needsHumanReview: true, isPublic: true } });
    const doNotImportPublic = await prisma.contentItem.count({ where: { importStatus: "do_not_import_yet", isPublic: true } });
    const adminOnlyPublic = await prisma.contentItem.count({ where: { publicDisplayStatus: "admin_only", isPublic: true } });
    const hideReviewPublic = await prisma.contentItem.count({ where: { publicDisplayStatus: "hide_or_review", isPublic: true } });
    const publicOpinions = publicByDataset.opinions;

    // --- Duplicate external IDs (raw, ignoring null) ---
    const dupExternal = await prisma.$queryRawUnsafe<{ externalId: string; n: bigint }[]>(
      `SELECT "externalId", COUNT(*) AS n FROM "ContentItem" WHERE "externalId" IS NOT NULL GROUP BY "externalId" HAVING COUNT(*) > 1`
    );
    // --- Duplicate enrichment (per content item / per standalone id) ---
    const dupEnrichByContent = await prisma.$queryRawUnsafe<{ contentItemId: string; n: bigint }[]>(
      `SELECT "contentItemId", COUNT(*) AS n FROM "AchievementEnrichment" GROUP BY "contentItemId" HAVING COUNT(*) > 1`
    );
    // --- Orphans (FKs should prevent these; verify anyway) ---
    const orphanEnrich = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "AchievementEnrichment" a LEFT JOIN "ContentItem" c ON a."contentItemId" = c.id WHERE c.id IS NULL`
    );
    const orphanLinks = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "ContentEvidenceLink" l LEFT JOIN "ContentItem" f ON l."fromContentId" = f.id LEFT JOIN "ContentItem" t ON l."toContentId" = t.id WHERE f.id IS NULL OR t.id IS NULL`
    );

    // --- Report ---
    console.log("\n=== ContentItem by sourceDataset ===");
    console.log(`  web:            ${web}`);
    console.log(`  opinions:       ${opinions}`);
    console.log(`  annual_reports: ${annual}`);
    console.log(`  merge-ready total: ${mergeTotal}`);
    console.log(`  (crawler/seed rows, sourceDataset=null): ${crawlerOrSeed}`);

    console.log("\n=== Visibility ===");
    console.log(`  public: ${publicCount}  hidden/supporting: ${hiddenCount}`);
    console.log(`  public by dataset: web=${publicByDataset.web} opinions=${publicByDataset.opinions} annual=${publicByDataset.annual_reports}`);

    console.log("\n=== Achievements / enrichment ===");
    console.log(`  canonical achievement rows: ${achievements}`);
    console.log(`  achievement enrichment rows: ${enrichment}`);

    console.log("\n=== Evidence links by type ===");
    if (links.length === 0) console.log("  (none)");
    for (const l of links) console.log(`  ${l.linkType}: ${l._count._all}`);
    console.log(`  total: ${linkTotal}`);

    console.log("\n=== Invariants ===");
    invariant("web rows = 3937", web === EXPECTED_ROWS.web, `${web}`);
    invariant("opinion rows = 759", opinions === EXPECTED_ROWS.opinions, `${opinions}`);
    invariant("annual rows = 237", annual === EXPECTED_ROWS.annual_reports, `${annual}`);
    invariant("merge-ready total = 4933 (not 5009)", mergeTotal === EXPECTED_ROWS.totalContentBeforeExclusions, `${mergeTotal}`);
    invariant("canonical achievements = 76", achievements === EXPECTED_ROWS.canonicalAchievements, `${achievements}`);
    invariant("achievement enrichment rows = 76", enrichment === EXPECTED_ROWS.enrichment, `${enrichment}`);
    invariant("enrichment did not add content rows (total still 4933)", mergeTotal === EXPECTED_ROWS.totalContentBeforeExclusions);
    invariant("no public row needs human review", reviewAndPublic === 0, `${reviewAndPublic}`);
    invariant("no do_not_import_yet row is public", doNotImportPublic === 0, `${doNotImportPublic}`);
    invariant("no admin_only row is public", adminOnlyPublic === 0, `${adminOnlyPublic}`);
    invariant("no hide_or_review row is public", hideReviewPublic === 0, `${hideReviewPublic}`);
    invariant("opinion rows are hidden/supporting (none public)", publicOpinions === 0, `${publicOpinions}`);
    invariant("no duplicate external IDs", dupExternal.length === 0, `${dupExternal.length} dup group(s)`);
    invariant("no duplicate enrichment per content item", dupEnrichByContent.length === 0, `${dupEnrichByContent.length}`);
    invariant("no orphan enrichment rows", Number(orphanEnrich[0]?.n ?? 0) === 0);
    invariant("no orphan evidence links", Number(orphanLinks[0]?.n ?? 0) === 0);
    invariant("public count > 0", publicCount > 0, `${publicCount}`);

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

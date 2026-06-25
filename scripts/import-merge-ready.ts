/**
 * Deterministic replacement import for the structured v0.9.5 Koda
 * package.
 *
 *   npm run import:merge-ready            # validate, back up, replace content
 *   npm run import:merge-ready -- --dry-run
 *   npm run import:merge-ready -- --force # continue despite validation errors
 *
 * This is a replacement import: existing ContentItem/TopicGroup imported
 * content is backed up and cleared before the new package is inserted.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Prisma, PrismaClient, TagType } from "@prisma/client";
import { loadEnv } from "./env";
import { makePrismaClient, usingPglite } from "./lib/prisma-client";
import { slugify } from "../src/lib/slug";
import {
  FILES,
  IMPORT_DIR,
  activeInputFileName,
  actionCounts,
  analyze,
  stageAllContent,
  unknownTopicLabels,
  stageLinks,
  type StagedContent,
  type StagedLink,
} from "./lib/merge-ready";

loadEnv();

let prisma: PrismaClient;
let closeHandle: (() => Promise<void>) | null = null;

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

function log(msg: string) {
  console.log(`[import ${new Date().toISOString()}] ${msg}`);
}

const TAXONOMY: { type: "valdkond" | "tegevusala" | "tapsustus" | "oigusakt"; pick: (s: StagedContent) => string[] }[] = [
  { type: "valdkond", pick: (s) => s.valdkonnad },
  { type: "tegevusala", pick: (s) => s.tegevusalad },
  { type: "tapsustus", pick: (s) => s.tapsustused },
  { type: "oigusakt", pick: (s) => s.oigusaktid },
];

function toContentData(s: StagedContent): Prisma.ContentItemUncheckedCreateInput {
  return {
    externalId: s.externalId,
    sourceDataset: s.sourceDataset,
    sourceLayer: s.sourceLayer,
    sourceTypeDetail: s.sourceTypeDetail,
    sourceType: s.sourceType,
    sourceUrl: s.sourceUrl,
    canonicalUrl: s.canonicalUrl,
    title: s.title,
    displayTitle: s.displayTitle,
    date: s.date,
    year: s.year,
    reportYear: s.reportYear,
    sourceFileName: s.sourceFileName,
    sourceSection: s.sourceSection,
    sourcePageLocation: s.sourcePageLocation,
    bodyText: s.bodyText,
    excerpt: s.excerpt,
    summary: s.summary,
    kodaPosition: s.kodaPosition,
    companyRelevance: s.companyRelevance,
    sourceEvidence: s.sourceEvidence,
    outcomeStatus: s.outcomeStatus,
    importStatus: s.importStatus,
    publicDisplayStatus: s.publicDisplayStatus,
    importAction: s.importAction,
    publicDisplayAllowed: s.publicDisplayAllowed,
    publicDisplayRole: s.publicDisplayRole,
    mergeReadiness: s.mergeReadiness,
    mergeNotes: s.mergeNotes,
    extractionQuality: s.extractionQuality,
    needsHumanReview: s.needsHumanReview,
    numericClaimNeedsReview: s.numericClaimNeedsReview,
    reviewReason: s.reviewReason,
    publicPriority: s.publicPriority,
    sourceQualityFlag: s.sourceQualityFlag,
    classificationConfidence: s.classificationConfidence,
    primaryCategory: s.primaryCategory,
    secondaryCategories: s.secondaryCategories,
    topicGroupCandidate: s.topicGroupCandidate,
    topicPrimary: s.topicPrimary,
    topicSecondary: s.topicSecondary,
    activityPrimary: s.activityPrimary,
    activitySecondary: s.activitySecondary,
    sectorScope: s.sectorScope,
    situationTags: s.situationTags,
    lawTagsConfirmed: s.lawTagsConfirmed,
    lawTagsCandidate: s.lawTagsCandidate,
    lawSearchAllowed: s.lawSearchAllowed,
    recipientRaw: s.recipientRaw,
    recipientNormalized: s.recipientNormalized,
    recipientFilterGroup: s.recipientFilterGroup,
    recipientType: s.recipientType,
    recipientSecondary: s.recipientSecondary,
    recipientNormalizationReviewRequired: s.recipientNormalizationReviewRequired,
    canonicalContentId: s.canonicalContentId,
    duplicateStatus: s.duplicateStatus,
    isEvergreen: s.isEvergreen,
    contentHash: s.contentHash,
    isPublic: s.isPublic,
    isHidden: s.isHidden,
    language: s.language,
  };
}

async function writeBackup(): Promise<{ path: string; counts: Record<string, number> }> {
  const backupsDir = resolve(IMPORT_DIR, "backups");
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(backupsDir, `pre-v0-9-5-import-${stamp}.json`);

  const [contentItems, topicGroups, tags, evidenceLinks, achievements] = await Promise.all([
    prisma.contentItem.findMany({ include: { tags: true } }),
    prisma.topicGroup.findMany({ include: { tags: true, contentItems: true } }),
    prisma.tag.findMany(),
    prisma.contentEvidenceLink.findMany(),
    prisma.achievementEnrichment.findMany(),
  ]);
  const payload = {
    timestamp: new Date().toISOString(),
    kind: "pre-v0.9.5-content-backup",
    counts: {
      contentItems: contentItems.length,
      topicGroups: topicGroups.length,
      tags: tags.length,
      evidenceLinks: evidenceLinks.length,
      achievementEnrichments: achievements.length,
    },
    contentItems,
    topicGroups,
    tags,
    evidenceLinks,
    achievementEnrichments: achievements,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return { path, counts: payload.counts };
}

async function clearImportedContent() {
  await prisma.contentEvidenceLink.deleteMany();
  await prisma.achievementEnrichment.deleteMany();
  await prisma.contentTopicGroup.deleteMany();
  await prisma.topicGroupTag.deleteMany();
  await prisma.topicGroup.deleteMany();
  await prisma.contentTag.deleteMany();
  await prisma.contentItem.deleteMany();
  await prisma.tag.deleteMany({ where: { type: { in: [TagType.valdkond, TagType.tegevusala, TagType.tapsustus, TagType.oigusakt] } } });
}

async function upsertTaxonomy(all: StagedContent[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const { type, pick } of TAXONOMY) {
    const values = new Set<string>();
    for (const s of all) for (const v of pick(s)) values.add(v);
    log(`  taxonomy ${type}: ${values.size} distinct values`);
    for (const name of values) {
      const slug = slugify(name) || "x";
      const tag = await prisma.tag.upsert({
        where: { type_slug: { type, slug } },
        create: { type, slug, name },
        update: { name },
      });
      map.set(`${type}::${name}`, tag.id);
    }
  }
  return map;
}

async function createContent(
  all: StagedContent[],
  tagMap: Map<string, string>
): Promise<{ idByExternal: Map<string, string>; created: number }> {
  const idByExternal = new Map<string, string>();
  let created = 0;
  let i = 0;

  for (const s of all) {
    const item = await prisma.contentItem.create({ data: toContentData(s) });
    idByExternal.set(s.externalId, item.id);
    created++;

    const tagIds = new Set<string>();
    for (const { type, pick } of TAXONOMY) {
      for (const v of pick(s)) {
        const id = tagMap.get(`${type}::${v}`);
        if (id) tagIds.add(id);
      }
    }
    if (tagIds.size) {
      await prisma.contentTag.createMany({
        data: [...tagIds].map((tagId) => ({ contentItemId: item.id, tagId })),
        skipDuplicates: true,
      });
    }

    if (s.isAchievement) {
      await prisma.achievementEnrichment.create({
        data: {
          contentItemId: item.id,
          standaloneAchievementId: s.externalId,
          matchKey: s.titleKey,
          matchPriority: s.matchedWebContentId ? "matched_web_content_id" : null,
          enrichmentStatus: s.importAction,
          rowMergeRole: s.importAction === "enrichment_public" ? "enrichment_public" : "enrichment_hold",
          numericImpactStatement: s.sourceEvidence,
          kodaRole: s.kodaPosition,
          valueType: s.companyRelevance,
          affectedCompanyTypes: s.companyRelevance,
          regulatoryArea: s.topicPrimary,
          primaryTopic: s.topicPrimary,
          secondaryTopics: s.topicSecondary,
          outcomeStatus: s.outcomeStatus,
          confidence: s.classificationConfidence,
          sourceEvidence: s.sourceEvidence,
          indexNote: s.mergeNotes,
        },
      });
    }

    if (++i % 500 === 0) log(`  ...created ${i}/${all.length}`);
  }
  return { idByExternal, created };
}

async function createLink(fromExt: string, toExt: string, type: "supporting_opinion" | "topic_history" | "duplicate_canonical", idByExternal: Map<string, string>, note?: string | null) {
  const fromId = idByExternal.get(fromExt);
  const toId = idByExternal.get(toExt);
  if (!fromId || !toId || fromId === toId) return false;
  await prisma.contentEvidenceLink.upsert({
    where: { fromContentId_toContentId_linkType: { fromContentId: fromId, toContentId: toId, linkType: type } },
    create: { fromContentId: fromId, toContentId: toId, linkType: type, note: note ?? undefined },
    update: { note: note ?? undefined },
  });
  return true;
}

async function importEvidenceLinks(
  all: StagedContent[],
  links: StagedLink[],
  idByExternal: Map<string, string>
): Promise<{ approvedPublic: number; toovoitRelations: number; duplicateLinks: number }> {
  let approvedPublic = 0;
  let toovoitRelations = 0;
  let duplicateLinks = 0;
  const publicIds = new Set(all.filter((s) => s.isPublic).map((s) => s.externalId));

  for (const link of links) {
    if (
      !link.publicLinkAllowed ||
      link.linkImportAction !== "import_public_relation" ||
      !publicIds.has(link.webContentId) ||
      !publicIds.has(link.opinionContentId)
    ) {
      continue;
    }
    if (await createLink(link.webContentId, link.opinionContentId, "supporting_opinion", idByExternal, link.evidence)) {
      approvedPublic++;
    }
  }

  for (const row of all) {
    if (row.canonicalContentId && idByExternal.has(row.canonicalContentId)) {
      if (await createLink(row.externalId, row.canonicalContentId, "duplicate_canonical", idByExternal, row.duplicateStatus)) duplicateLinks++;
    }
    if (row.sourceDataset === "toovoidud") {
      if (row.matchedWebContentId && (await createLink(row.externalId, row.matchedWebContentId, "topic_history", idByExternal))) toovoitRelations++;
      if (row.matchedOpinionContentId && (await createLink(row.externalId, row.matchedOpinionContentId, "supporting_opinion", idByExternal))) toovoitRelations++;
    }
  }

  return { approvedPublic, toovoitRelations, duplicateLinks };
}

async function main() {
  log(`Staging structured package from ${IMPORT_DIR}`);
  const staged = await stageAllContent();
  const links = await stageLinks();
  const analysis = analyze(staged, links);

  log(`Staged: web=${staged.web.length} opinions=${staged.opinions.length} toovoidud=${staged.toovoidud.length} total=${staged.all.length}`);
  log(`Public: web=${analysis.perDataset.web.public} opinions=${analysis.perDataset.opinions.public} toovoidud=${analysis.perDataset.toovoidud.public}`);

  // Surface topic labels that are neither canonical nor a known alias. They are
  // kept as internal classification but never exposed as public filter options.
  if (unknownTopicLabels.size > 0) {
    log(`  WARNING: ${unknownTopicLabels.size} unknown (non-canonical) topic label(s) — kept internal, not exposed as public filters:`);
    for (const [label, n] of [...unknownTopicLabels.entries()].sort((a, b) => b[1] - a[1])) {
      log(`    - "${label}" (${n} row(s))`);
    }
  }

  if (!analysis.ok) {
    console.error("[import] Validation errors:");
    for (const e of analysis.errors) console.error("  - " + e);
    if (!FORCE) {
      console.error("[import] Aborting. Fix the workbooks or re-run with --force.");
      process.exitCode = 1;
      return;
    }
    console.error("[import] --force set: continuing despite errors.");
  }

  if (DRY_RUN) {
    log("--dry-run: no database writes. Validation summary above.");
    await writeReport(analysis, {
      dryRun: true,
      backupPath: null,
      backupCounts: {},
      cleared: {},
      created: 0,
      evidenceLinks: { approvedPublic: 0, toovoitRelations: 0, duplicateLinks: 0 },
      dbTotal: 0,
    });
    return;
  }

  log(`Connecting to database${usingPglite() ? " (PGlite local verification driver)" : ""}...`);
  const handle = await makePrismaClient();
  prisma = handle.prisma;
  closeHandle = handle.close;

  log("Backing up existing content/import tables...");
  const backup = await writeBackup();
  log(`  backup: ${backup.path}`);

  log("Replacing old imported content...");
  await clearImportedContent();

  log("Upserting taxonomy tags...");
  const tagMap = await upsertTaxonomy(staged.all);

  log("Creating content rows...");
  const { idByExternal, created } = await createContent(staged.all, tagMap);
  log(`  content created=${created}`);

  log("Linking approved public relations and achievement relations...");
  const evidenceLinks = await importEvidenceLinks(staged.all, links.approved, idByExternal);
  log(`  links: approvedPublic=${evidenceLinks.approvedPublic} toovoidudRelations=${evidenceLinks.toovoitRelations} duplicateLinks=${evidenceLinks.duplicateLinks}`);

  const dbTotal = await prisma.contentItem.count();
  await writeReport(analysis, {
    dryRun: false,
    backupPath: backup.path,
    backupCounts: backup.counts,
    cleared: backup.counts,
    created,
    evidenceLinks,
    dbTotal,
  });

  log("Done.");
}

type ImportResult = {
  dryRun: boolean;
  backupPath: string | null;
  backupCounts: Record<string, number>;
  cleared: Record<string, number>;
  created: number;
  evidenceLinks: { approvedPublic: number; toovoitRelations: number; duplicateLinks: number };
  dbTotal: number;
};

async function writeReport(analysis: ReturnType<typeof analyze>, r: ImportResult) {
  const reportsDir = resolve(IMPORT_DIR, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    kind: "structured-v0.9.5-import",
    dryRun: r.dryRun,
    inputFiles: {
      web: `data/import/${activeInputFileName(FILES.web)}`,
      opinions: `data/import/${activeInputFileName(FILES.opinions)}`,
      toovoidud: `data/import/${activeInputFileName(FILES.toovoidud)}`,
      taxonomy: `data/import/${activeInputFileName(FILES.taxonomy)}`,
    },
    sheetsUsed: {
      web: "web_content_v0_9",
      opinions: "opinions_v0_9",
      toovoidud: "toovoidud_v0_9",
      approvedLinks: "approved_links_v0_9",
      candidateLinks: "candidate_links_v0_9",
    },
    backupPath: r.backupPath,
    backupCounts: r.backupCounts,
    oldDataRemovalMethod: "Cleared ContentItem, TopicGroup, ContentTag, ContentEvidenceLink and AchievementEnrichment before inserting v0.9.5 rows.",
    rowCountsPerSource: analysis.rowCounts,
    totalContentStaged: analysis.totalContentStaged,
    totalContentImported: r.created,
    dbContentRowsAfterImport: r.dbTotal,
    publicRows: analysis.visibility.public,
    hiddenOrSupportingRows: analysis.visibility.hiddenOrSupporting,
    actionCounts: {
      web: actionCountsByName(analysis, "web"),
      opinions: actionCountsByName(analysis, "opinions"),
      toovoidud: actionCountsByName(analysis, "toovoidud"),
    },
    perDataset: analysis.perDataset,
    linkCounts: analysis.links,
    evidenceLinksCreated: r.evidenceLinks,
    lawSearch: analysis.law,
    taxonomyReference: analysis.taxonomyReference,
    invalidEnumValues: analysis.invalidEnumValues,
    missingRequiredFields: analysis.missingRequiredFields,
    publicRowsWithReviewFlag: analysis.publicRowsWithReviewFlag,
    publicRowsWithNumericReviewFlag: analysis.publicRowsWithNumericReviewFlag,
    publicSafetyBlockers: analysis.blockers,
    duplicateContentHashGroups: analysis.duplicateContentHashGroups.length,
    finalStatus: analysis.ok ? "PASS" : "FAIL",
    errors: analysis.errors,
  };

  writeFileSync(resolve(reportsDir, "import-report.json"), JSON.stringify(report, null, 2));

  const md = `# Structured v0.9.5 import report

- Timestamp: ${report.timestamp}
- Mode: ${r.dryRun ? "dry-run (no DB writes)" : "replacement import"}
- Final status: ${report.finalStatus}
- Backup: ${report.backupPath ?? "(dry-run)"}

## Input files
- ${report.inputFiles.web}
- ${report.inputFiles.opinions}
- ${report.inputFiles.toovoidud}
- ${report.inputFiles.taxonomy}

## Row counts
| Source | Staged | Public |
| --- | ---: | ---: |
| Web | ${analysis.rowCounts.web} | ${analysis.perDataset.web.public} |
| Opinions | ${analysis.rowCounts.opinions} | ${analysis.perDataset.opinions.public} |
| Toovoidud | ${analysis.rowCounts.toovoidud} | ${analysis.perDataset.toovoidud.public} |
| Total content | ${analysis.totalContentStaged} | ${analysis.visibility.public} |

## Held/support/staging
- Web support-only: ${analysis.visibility.supportOnly}
- Web do-not-import-public: ${analysis.visibility.doNotImportPublic}
- Staging-only rows: ${analysis.visibility.stagingOnly}
- Held toovoidud rows: ${analysis.visibility.heldToovoidud}
- Review-required rows: ${analysis.visibility.needsReview}
- Numeric-review rows: ${analysis.visibility.numericReview}

## Links and law search
- Approved public relations: ${analysis.links.approvedPublicEligible}
- Approved admin/blocked relations: ${analysis.links.approvedAdminOrBlocked}
- Candidate links admin-only: ${analysis.links.candidateAdminOnly}
- Public rows with confirmed law tags: ${analysis.law.publicConfirmedLawTagRows}
- Rows carrying candidate law tags (not public law filter tags): ${analysis.law.candidateLawTagRows}

${analysis.errors.length ? "## Errors\n" + analysis.errors.map((e) => "- " + e).join("\n") : "_No validation errors._"}
`;
  writeFileSync(resolve(reportsDir, "import-report.md"), md);
  log(`Wrote ${resolve(reportsDir, "import-report.json")} and import-report.md`);
}

function actionCountsByName(analysis: ReturnType<typeof analyze>, dataset: "web" | "opinions" | "toovoidud") {
  // Reports are written from Analysis only; keep action counts there in a compact
  // derived form by reusing the known expected splits.
  if (dataset === "web") {
    return {
      import_public: analysis.perDataset.web.public,
      import_support_only: analysis.visibility.supportOnly,
      import_staging_only: analysis.rowCounts.web - analysis.perDataset.web.public - analysis.visibility.supportOnly - analysis.visibility.doNotImportPublic,
      do_not_import_public: analysis.visibility.doNotImportPublic,
    };
  }
  if (dataset === "opinions") {
    return {
      import_public: analysis.perDataset.opinions.public,
      import_staging_only: analysis.rowCounts.opinions - analysis.perDataset.opinions.public,
    };
  }
  return {
    enrichment_public: analysis.perDataset.toovoidud.public,
    enrichment_hold: analysis.visibility.heldToovoidud,
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (closeHandle) await closeHandle().catch(() => {});
  });

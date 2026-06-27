/**
 * Deterministic replacement import for the **v1** Koda app-import package.
 *
 *   npm run import:merge-ready            # validate, back up, replace content
 *   npm run import:merge-ready -- --dry-run
 *   npm run import:merge-ready -- --force # continue despite validation errors
 *
 * This is a replacement import: existing ContentItem/TopicGroup imported content
 * is backed up and cleared before the new v1 package is inserted. Public related
 * links come exclusively from koda_content_links_v1.xlsx `public_related_links`.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Prisma, PrismaClient, TagType, EvidenceLinkType } from "@prisma/client";
import { loadEnv } from "./env";
import { makePrismaClient, usingPglite } from "./lib/prisma-client";
import { slugify } from "../src/lib/slug";
import {
  FILES,
  IMPORT_DIR,
  SHEETS,
  activeInputFileName,
  analyze,
  evidenceLinkTypeForTarget,
  stageAllContent,
  stageExcludedIds,
  stageLinkWorkbook,
  unknownTopicLabels,
  type Analysis,
  type LinkWorkbook,
  type PublicRelatedLink,
  type StagedContent,
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
    importStatus: s.importAction,
    publicDisplayStatus: s.publicDisplayStatus,
    importAction: s.importAction,
    publicDisplayAllowed: s.isPublic,
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
    // v1 fields.
    contentRoleFinal: s.contentRoleFinal,
    publicActivityFilterTags: s.publicActivityFilterTags,
    publicActivityDisplayTags: s.publicActivityDisplayTags,
    publicSectorPageAllowed: s.publicSectorPageAllowed,
    sectorResultEligibility: s.sectorResultEligibility,
    generalSearchEligibility: s.generalSearchEligibility,
    recommendedAppVisibilityFinal: s.recommendedAppVisibilityFinal,
    publicSectorRankScore: s.publicSectorRankScore,
    generalSearchRankScore: s.generalSearchRankScore,
    displayDatePrecision: s.displayDatePrecision,
    dateConfidence: s.dateConfidence,
    dateBasis: s.dateBasis,
    effectiveDate: s.effectiveDate,
    deadlineDate: s.deadlineDate,
    whatChangedEt: s.whatChangedEt,
    kodaRoleEt: s.kodaRoleEt,
    businessValueEt: s.businessValueEt,
    beforeAfterEt: s.beforeAfterEt,
    workWinTypePrimary: s.workWinTypePrimary,
    workWinTypeSecondary: s.workWinTypeSecondary,
    canonicalPolicyThreadId: s.canonicalPolicyThreadId,
    policyThreadId: s.policyThreadId,
  };
}

async function writeBackup(): Promise<{ path: string; counts: Record<string, number> }> {
  const backupsDir = resolve(IMPORT_DIR, "backups");
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(backupsDir, `pre-v1-import-${stamp}.json`);

  const [contentItems, topicGroups, tags, evidenceLinks, achievements] = await Promise.all([
    prisma.contentItem.findMany({ include: { tags: true } }),
    prisma.topicGroup.findMany({ include: { tags: true, contentItems: true } }),
    prisma.tag.findMany(),
    prisma.contentEvidenceLink.findMany(),
    prisma.achievementEnrichment.findMany(),
  ]);
  const payload = {
    timestamp: new Date().toISOString(),
    kind: "pre-v1-content-backup",
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

    // Achievement (töövõit) enrichment carries the v1 value fields used on the
    // achievement detail page.
    if (s.isAchievement) {
      await prisma.achievementEnrichment.create({
        data: {
          contentItemId: item.id,
          standaloneAchievementId: s.externalId,
          matchKey: s.titleKey,
          matchPriority: s.matchedWebContentId ? "matched_web_content_id" : null,
          enrichmentStatus: s.importAction,
          rowMergeRole: "work_win_import",
          numericImpactStatement: s.businessValueEt ?? s.sourceEvidence,
          kodaRole: s.kodaRoleEt,
          valueType: s.workWinTypePrimary,
          affectedCompanyTypes: s.companyRelevance,
          regulatoryArea: s.topicPrimary,
          primaryTopic: s.topicPrimary,
          secondaryTopics: s.topicSecondary,
          outcomeStatus: s.outcomeStatus,
          confidence: s.classificationConfidence,
          sourceEvidence: s.whatChangedEt ?? s.sourceEvidence,
          indexNote: s.dateBasis,
        },
      });
    }

    if (++i % 500 === 0) log(`  ...created ${i}/${all.length}`);
  }
  return { idByExternal, created };
}

async function upsertEvidenceLink(
  fromId: string,
  toId: string,
  type: EvidenceLinkType,
  data: Partial<Prisma.ContentEvidenceLinkUncheckedCreateInput>
): Promise<boolean> {
  if (!fromId || !toId || fromId === toId) return false;
  await prisma.contentEvidenceLink.upsert({
    where: { fromContentId_toContentId_linkType: { fromContentId: fromId, toContentId: toId, linkType: type } },
    create: { fromContentId: fromId, toContentId: toId, linkType: type, ...data },
    update: data,
  });
  return true;
}

/**
 * Public related links → ContentEvidenceLink. Source comes ONLY from the v1
 * koda_content_links_v1.xlsx `public_related_links` sheet. Candidate/review/
 * blocked/missing links are never imported as public relations. Both endpoints
 * must be imported public content.
 */
async function importPublicRelatedLinks(
  all: StagedContent[],
  publicRelated: PublicRelatedLink[],
  idByExternal: Map<string, string>
): Promise<{ publicRelated: number; duplicateLinks: number; skipped: number }> {
  const publicIds = new Set(all.filter((s) => s.isPublic).map((s) => s.externalId));
  let publicRel = 0;
  let skipped = 0;

  for (const l of publicRelated) {
    const fromId = idByExternal.get(l.sourceContentId);
    const toId = idByExternal.get(l.targetContentId);
    if (!fromId || !toId || !publicIds.has(l.sourceContentId) || !publicIds.has(l.targetContentId)) {
      skipped++;
      continue;
    }
    const type = evidenceLinkTypeForTarget(l.targetLayer) as EvidenceLinkType;
    const ok = await upsertEvidenceLink(fromId, toId, type, {
      note: l.relationLabelEt ?? undefined,
      relationLabelEt: l.relationLabelEt ?? undefined,
      linkConfidence: l.linkConfidence ?? undefined,
      linkBasis: l.linkBasis ?? undefined,
      canonicalPolicyThreadId: l.canonicalPolicyThreadId ?? undefined,
      sortPriority: l.sortPriority ?? undefined,
    });
    if (ok) publicRel++;
  }

  // Duplicate→canonical links keep deduped rows pointing at their canonical row.
  let duplicateLinks = 0;
  for (const row of all) {
    if (row.canonicalContentId && row.canonicalContentId !== row.externalId && idByExternal.has(row.canonicalContentId)) {
      const ok = await upsertEvidenceLink(
        idByExternal.get(row.externalId)!,
        idByExternal.get(row.canonicalContentId)!,
        EvidenceLinkType.duplicate_canonical,
        { note: row.duplicateStatus ?? undefined }
      );
      if (ok) duplicateLinks++;
    }
  }

  return { publicRelated: publicRel, duplicateLinks, skipped };
}

async function main() {
  log(`Staging v1 package from ${IMPORT_DIR}`);
  const staged = stageAllContent();
  const links = stageLinkWorkbook();
  const excluded = stageExcludedIds();
  const analysis = analyze(staged, links, excluded);

  log(`Staged: web=${staged.web.length} opinions=${staged.opinions.length} toovoidud=${staged.toovoidud.length} total=${staged.all.length}`);
  log(`Public: web=${analysis.perDataset.web.public} opinions=${analysis.perDataset.opinions.public} toovoidud=${analysis.perDataset.toovoidud.public}`);
  log(`Public related links available: ${links.publicRelated.length}`);

  if (unknownTopicLabels.size > 0) {
    log(`  WARNING: ${unknownTopicLabels.size} unknown (non-canonical) topic label(s) — kept internal, not public filters:`);
    for (const [label, n] of [...unknownTopicLabels.entries()].sort((a, b) => b[1] - a[1])) log(`    - "${label}" (${n} row(s))`);
  }
  for (const w of analysis.warnings) log(`  warning: ${w}`);

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
    writeReport(analysis, links, {
      dryRun: true,
      backupPath: null,
      backupCounts: {},
      created: 0,
      evidenceLinks: { publicRelated: 0, duplicateLinks: 0, skipped: 0 },
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

  log("Importing public related links (Veel samal teemal / evidence)...");
  const evidenceLinks = await importPublicRelatedLinks(staged.all, links.publicRelated, idByExternal);
  log(`  links: publicRelated=${evidenceLinks.publicRelated} duplicateLinks=${evidenceLinks.duplicateLinks} skipped=${evidenceLinks.skipped}`);

  const dbTotal = await prisma.contentItem.count();
  writeReport(analysis, links, {
    dryRun: false,
    backupPath: backup.path,
    backupCounts: backup.counts,
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
  created: number;
  evidenceLinks: { publicRelated: number; duplicateLinks: number; skipped: number };
  dbTotal: number;
};

function writeReport(analysis: Analysis, links: LinkWorkbook, r: ImportResult) {
  const reportsDir = resolve(IMPORT_DIR, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    kind: "structured-v1-import",
    dryRun: r.dryRun,
    inputFiles: {
      opinions: `data/import/${activeInputFileName(FILES.opinions)}`,
      web: `data/import/${activeInputFileName(FILES.web)}`,
      toovoidud: `data/import/${activeInputFileName(FILES.toovoidud)}`,
      links: `data/import/${activeInputFileName(FILES.links)}`,
      taxonomy: `data/import/${activeInputFileName(FILES.taxonomy)}`,
    },
    sheetsUsed: {
      opinions: SHEETS.opinions,
      opinionsExcluded: SHEETS.opinionsExcluded,
      web: SHEETS.web,
      webExcluded: SHEETS.webExcluded,
      toovoidud: SHEETS.toovoidud,
      toovoidudExcluded: SHEETS.toovoidudExcluded,
      publicRelatedLinks: SHEETS.publicRelatedLinks,
      smokeTest: SHEETS.smokeTest,
    },
    backupPath: r.backupPath,
    backupCounts: r.backupCounts,
    oldDataRemovalMethod:
      "Cleared ContentItem, TopicGroup, ContentTag, ContentEvidenceLink and AchievementEnrichment before inserting v1 rows.",
    importRowCounts: { web: analysis.rowCounts.web, opinions: analysis.rowCounts.opinions, toovoidud: analysis.rowCounts.toovoidud, total: analysis.rowCounts.total },
    excludedRowCounts: analysis.excludedCounts,
    totalContentImported: r.created,
    dbContentRowsAfterImport: r.dbTotal,
    publicRows: analysis.visibility.public,
    hiddenRows: analysis.visibility.hidden,
    perDataset: analysis.perDataset,
    publicRelatedLinks: analysis.links.publicRelated,
    publicRelatedLinkConfidence: analysis.links.byConfidence,
    candidateLinks: analysis.links.candidate,
    blockedLinks: analysis.links.blocked,
    missingTargets: analysis.links.missingTargets,
    evidenceLinksCreated: r.evidenceLinks,
    smokeTest: {
      total: analysis.smokeTest.rows.length,
      pass: analysis.smokeTest.rows.filter((t) => t.status === "PASS").length,
      warn: analysis.smokeTest.rows.filter((t) => t.status === "WARN").length,
      blockerFailures: analysis.smokeTest.blockerFailures.map((t) => t.testId),
    },
    dateRegressions: analysis.dateRegressions,
    lawSearch: analysis.law,
    taxonomyReference: analysis.taxonomyReference,
    missingInvalidFields: {
      missingRequired: analysis.missingRequiredFields.length,
      missingSummary: analysis.missingSummaryRows.length,
      rawFragmentSummaries: analysis.rawFragmentSummaryRows.length,
      crossSectorDisplayTags: analysis.crossSectorDisplayTagRows.length,
      falseImportFlags: analysis.importFlagViolations.length,
    },
    publicSafetyBlockers: {
      targetsNotImported: analysis.links.targetsNotImported.length,
      targetsExcluded: analysis.links.targetsExcluded.length,
      lowOrRejectedLinks: analysis.links.lowOrRejected.length,
      smokeTestBlockerFailures: analysis.smokeTest.blockerFailures.length,
    },
    warnings: analysis.warnings,
    finalStatus: analysis.ok ? "PASS" : "FAIL",
    errors: analysis.errors,
    // TODO: import policy_threads into a first-class structure (TopicGroup) so a
    // single thread can be navigated across opinion/news/work-win. For now the
    // canonical_policy_thread_id is preserved on content + links.
    todo: ["Import policy_threads as a first-class TopicGroup/policy-thread structure."],
  };

  writeFileSync(resolve(reportsDir, "import-report.json"), JSON.stringify(report, null, 2));

  const md = `# Structured v1 import report

- Timestamp: ${report.timestamp}
- Mode: ${r.dryRun ? "dry-run (no DB writes)" : "replacement import"}
- Final status: ${report.finalStatus}
- Backup: ${report.backupPath ?? "(dry-run)"}

## Input files
- ${report.inputFiles.opinions} (${SHEETS.opinions})
- ${report.inputFiles.web} (${SHEETS.web})
- ${report.inputFiles.toovoidud} (${SHEETS.toovoidud})
- ${report.inputFiles.links} (relation layer)
- ${report.inputFiles.taxonomy} (rulebook, not imported)

## Row counts
| Source | Imported | Public | Excluded/review |
| --- | ---: | ---: | ---: |
| Web | ${analysis.rowCounts.web} | ${analysis.perDataset.web.public} | ${analysis.excludedCounts.web} |
| Opinions | ${analysis.rowCounts.opinions} | ${analysis.perDataset.opinions.public} | ${analysis.excludedCounts.opinions} |
| Töövõidud | ${analysis.rowCounts.toovoidud} | ${analysis.perDataset.toovoidud.public} | ${analysis.excludedCounts.toovoidud} |
| Total | ${analysis.rowCounts.total} | ${analysis.visibility.public} | — |

## Cross-layer links (${report.inputFiles.links})
- Public related links: ${analysis.links.publicRelated} (confidence ${JSON.stringify(analysis.links.byConfidence)})
- Public relations created in DB: ${r.evidenceLinks.publicRelated}
- Candidate/review links (not public): ${analysis.links.candidate}
- Blocked/rejected links (not public): ${analysis.links.blocked}
- Missing/excluded target references: ${analysis.links.missingTargets}

## Smoke test
- ${report.smokeTest.pass}/${report.smokeTest.total} PASS, ${report.smokeTest.warn} WARN, blocker failures: ${report.smokeTest.blockerFailures.length ? report.smokeTest.blockerFailures.join(", ") : "none"}

## Taxonomy rulebook
- ${analysis.taxonomyReference.fileName} (${analysis.taxonomyReference.bytes} bytes, reference only)

${analysis.warnings.length ? "## Warnings\n" + analysis.warnings.map((w) => "- " + w).join("\n") + "\n" : ""}${analysis.errors.length ? "## Errors\n" + analysis.errors.map((e) => "- " + e).join("\n") : "_No validation errors._"}
`;
  writeFileSync(resolve(reportsDir, "import-report.md"), md);
  log(`Wrote ${resolve(reportsDir, "import-report.json")} and import-report.md`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (closeHandle) await closeHandle().catch(() => {});
  });

/**
 * Deterministic, idempotent import of the merge-ready workbooks into Postgres.
 *
 *   npm run import:merge-ready            # validate, then import
 *   npm run import:merge-ready -- --force # import even if validation has warnings
 *   npm run import:merge-ready -- --dry-run
 *
 * Pipeline (Task 3):
 *   1. Read + stage the three real content sources and the enrichment source.
 *   2. Validate (counts, enums, required fields, 76/76 enrichment match).
 *   3. Upsert taxonomy tags from the cleaned filter_*_merge fields.
 *   4. Upsert content rows by externalId (idempotent), applying public gating.
 *   5. Left-join achievement enrichment onto the 76 canonical web achievements
 *      (never creating new content rows).
 *   6. Populate the evidence graph (duplicate/canonical + resolvable relations).
 *   7. Write data/import/reports/import-report.{json,md}.
 *
 * The standalone töövõidud file is enrichment only: it adds 0 content rows.
 * Expected content rows = 4933 (web 3937 + opinions 759 + annual 237).
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { loadEnv } from "./env";
import { makePrismaClient, usingPglite } from "./lib/prisma-client";
import { slugify } from "../src/lib/slug";
import {
  IMPORT_DIR,
  stageAllContent,
  stageEnrichment,
  matchEnrichment,
  analyze,
  type StagedContent,
  type StagedEnrichment,
} from "./lib/merge-ready";

loadEnv();

// Assigned in main() from makePrismaClient (native engine by default, PGlite
// adapter when KODA_DB_DRIVER=pglite).
let prisma: PrismaClient;
let closeHandle: (() => Promise<void>) | null = null;

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

function log(msg: string) {
  console.log(`[import ${new Date().toISOString()}] ${msg}`);
}

// Taxonomy tag types backed by the merge fields.
const TAXONOMY: { type: "valdkond" | "tegevusala" | "tapsustus"; pick: (s: StagedContent) => string[] }[] = [
  { type: "valdkond", pick: (s) => s.valdkonnad },
  { type: "tegevusala", pick: (s) => s.tegevusalad },
  { type: "tapsustus", pick: (s) => s.tapsustused },
];

async function upsertTaxonomy(all: StagedContent[]): Promise<Map<string, string>> {
  // key `${type}::${value}` -> tagId
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
    mergeReadiness: s.mergeReadiness,
    mergeNotes: s.mergeNotes,
    extractionQuality: s.extractionQuality,
    needsHumanReview: s.needsHumanReview,
    reviewReason: s.reviewReason,
    publicPriority: s.publicPriority,
    primaryCategory: s.primaryCategory,
    secondaryCategories: s.secondaryCategories,
    topicGroupCandidate: s.topicGroupCandidate,
    canonicalContentId: s.canonicalContentId,
    duplicateStatus: s.duplicateStatus,
    isEvergreen: s.isEvergreen,
    contentHash: s.contentHash,
    isPublic: s.isPublic,
    isHidden: s.isHidden,
    language: s.language,
  };
}

async function upsertContent(
  all: StagedContent[],
  tagMap: Map<string, string>
): Promise<{ idByExternal: Map<string, string>; created: number; updated: number }> {
  const idByExternal = new Map<string, string>();
  let created = 0;
  let updated = 0;
  let i = 0;
  for (const s of all) {
    const data = toContentData(s);
    const existing = await prisma.contentItem.findUnique({ where: { externalId: s.externalId }, select: { id: true } });
    const item = await prisma.contentItem.upsert({
      where: { externalId: s.externalId },
      create: data,
      // Importer owns these fields; admin-only fields (manualWeight, AI fields,
      // topic-group membership) are never touched here.
      update: data,
    });
    idByExternal.set(s.externalId, item.id);
    if (existing) updated++;
    else created++;

    // Refresh the merge-taxonomy tags for this item (idempotent): remove the
    // importer-owned tag types, then re-attach. Other tag types are preserved.
    await prisma.contentTag.deleteMany({
      where: { contentItemId: item.id, tag: { type: { in: ["valdkond", "tegevusala", "tapsustus"] } } },
    });
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

    if (++i % 500 === 0) log(`  ...upserted ${i}/${all.length}`);
  }
  return { idByExternal, created, updated };
}

async function importEnrichment(
  enrichment: StagedEnrichment[],
  webAchievements: StagedContent[],
  idByExternal: Map<string, string>
): Promise<{ matched: number; failed: string[] }> {
  const matches = matchEnrichment(enrichment, webAchievements);
  const failed: string[] = [];
  let matched = 0;
  for (const m of matches) {
    if (!m.matched || !m.contentExternalId) {
      failed.push(m.enrichment.achievementTitle);
      continue;
    }
    const contentItemId = idByExternal.get(m.contentExternalId);
    if (!contentItemId) {
      failed.push(m.enrichment.achievementTitle);
      continue;
    }
    const e = m.enrichment;
    const data = {
      standaloneAchievementId: e.standaloneAchievementId,
      matchKey: e.matchKey,
      matchPriority: e.matchPriority,
      enrichmentStatus: e.enrichmentStatus,
      rowMergeRole: e.rowMergeRole,
      numericImpactStatement: e.numericImpactStatement,
      kodaRole: e.kodaRole,
      valueType: e.valueType,
      affectedCompanyTypes: e.affectedCompanyTypes,
      affectedBusinessFunctions: e.affectedBusinessFunctions,
      regulatoryArea: e.regulatoryArea,
      primaryTopic: e.primaryTopic,
      secondaryTopics: e.secondaryTopics,
      outcomeStatus: e.outcomeStatus,
      confidence: e.confidence,
      sourceEvidence: e.sourceEvidence,
      indexNote: e.indexNote,
    };
    await prisma.achievementEnrichment.upsert({
      where: { contentItemId },
      create: { contentItemId, ...data },
      update: data,
    });
    matched++;
  }
  return { matched, failed };
}

/** Deterministic evidence links: duplicate/canonical + resolvable related ids. */
async function importEvidenceLinks(
  all: StagedContent[],
  idByExternal: Map<string, string>
): Promise<number> {
  let count = 0;
  const link = async (fromExt: string, toExt: string, linkType: "duplicate_canonical" | "annual_context" | "topic_history" | "supporting_opinion", note?: string) => {
    if (fromExt === toExt) return;
    const fromId = idByExternal.get(fromExt);
    const toId = idByExternal.get(toExt);
    if (!fromId || !toId) return;
    await prisma.contentEvidenceLink.upsert({
      where: { fromContentId_toContentId_linkType: { fromContentId: fromId, toContentId: toId, linkType } },
      create: { fromContentId: fromId, toContentId: toId, linkType, note },
      update: { note },
    });
    count++;
  };

  for (const s of all) {
    // Duplicate -> canonical.
    if (s.canonicalContentId && idByExternal.has(s.canonicalContentId)) {
      await link(s.externalId, s.canonicalContentId, "duplicate_canonical", s.duplicateStatus ?? undefined);
    }
    // Annual rows reference related content ids (topic history / context).
    if (s.sourceDataset === "annual_reports" && s.canonicalContentId) {
      for (const rel of s.canonicalContentId.split(/[;,\s]+/).filter(Boolean)) {
        if (idByExternal.has(rel)) await link(rel, s.externalId, "annual_context");
      }
    }
  }
  return count;
}

async function main() {
  log(`Staging merge-ready workbooks from ${IMPORT_DIR}`);
  const staged = await stageAllContent();
  const enrichment = await stageEnrichment();
  const webAchievements = staged.web.filter((s) => s.isAchievement);
  const matches = matchEnrichment(enrichment, webAchievements);
  const analysis = analyze(staged, enrichment, matches);

  log(`Staged: web=${staged.web.length} opinions=${staged.opinions.length} annual=${staged.annual_reports.length} total=${staged.all.length}`);
  log(`Enrichment: ${enrichment.length} rows, matched=${analysis.enrichment.matched}/${enrichment.length}`);

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
    await writeReport(analysis, { created: 0, updated: 0, enrichmentMatched: 0, enrichmentFailed: [], evidenceLinks: 0, dbTotal: 0, dryRun: true });
    return;
  }

  log(`Connecting to database${usingPglite() ? " (PGlite local verification driver)" : ""}...`);
  const handle = await makePrismaClient();
  prisma = handle.prisma;
  closeHandle = handle.close;

  log("Upserting taxonomy tags...");
  const tagMap = await upsertTaxonomy(staged.all);

  log("Upserting content rows (idempotent by externalId)...");
  const { idByExternal, created, updated } = await upsertContent(staged.all, tagMap);
  log(`  content: created=${created} updated=${updated}`);

  log("Enriching canonical achievements (no new content rows)...");
  const enr = await importEnrichment(enrichment, webAchievements, idByExternal);
  log(`  enrichment: matched=${enr.matched} failed=${enr.failed.length}`);

  log("Linking evidence graph...");
  const evidenceLinks = await importEvidenceLinks(staged.all, idByExternal);
  log(`  evidence links: ${evidenceLinks}`);

  const dbTotal = await prisma.contentItem.count({ where: { sourceDataset: { not: null } } });
  log(`  ContentItem rows from merge-ready datasets in DB: ${dbTotal}`);

  await writeReport(analysis, {
    created,
    updated,
    enrichmentMatched: enr.matched,
    enrichmentFailed: enr.failed,
    evidenceLinks,
    dbTotal,
    dryRun: false,
  });

  if (enr.failed.length > 0 && !FORCE) {
    console.error(`[import] ${enr.failed.length} enrichment row(s) failed to match. See report.`);
    process.exitCode = 1;
    return;
  }
  log("Done.");
}

type ImportResult = {
  created: number;
  updated: number;
  enrichmentMatched: number;
  enrichmentFailed: string[];
  evidenceLinks: number;
  dbTotal: number;
  dryRun: boolean;
};

async function writeReport(analysis: ReturnType<typeof analyze>, r: ImportResult) {
  const reportsDir = resolve(IMPORT_DIR, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    kind: "import",
    dryRun: r.dryRun,
    inputFiles: {
      web: "data/import/koda_web_index_v1_merge_ready.xlsx",
      opinions: "data/import/koda_opinions_v1_merge_ready.xlsx",
      annual_reports: "data/import/koda_annual_reports_v1_merge_ready.xlsx",
      enrichment: "data/import/koda_toovoidud_enrichment_v1_merge_ready.xlsx",
    },
    sheetsUsed: {
      web: "web_merge_ready",
      opinions: "opinions_merge_ready",
      annual_reports: "annual_reports_merge_ready",
      enrichment: "toovoidud_enrichment_ready",
    },
    rowCountsPerSource: analysis.rowCounts,
    totalContentStaged: analysis.totalContentStaged,
    totalContentImported: r.dryRun ? 0 : r.created + r.updated,
    contentRowsCreated: r.created,
    contentRowsUpdated: r.updated,
    dbContentRowsFromMergeReady: r.dbTotal,
    excludedFromPublic: analysis.visibility.hiddenOrSupporting,
    publicRows: analysis.visibility.public,
    hiddenOrReviewRows: analysis.visibility.hiddenOrSupporting,
    needsReviewRows: analysis.visibility.needsReview,
    doNotImportRows: analysis.visibility.doNotImport,
    weakOrFailedExtractionRows: analysis.visibility.weakOrFailedExtraction,
    opinionRowsImportedAsEvidence: analysis.perDataset.opinions?.total ?? 0,
    annualRowsImported: analysis.perDataset.annual_reports?.total ?? 0,
    canonicalAchievementRows: analysis.canonicalAchievements,
    achievementEnrichmentRows: analysis.enrichment.rows,
    enrichmentMatches: r.dryRun ? analysis.enrichment.matched : r.enrichmentMatched,
    enrichmentFailures: r.dryRun ? analysis.enrichment.failedTitles : r.enrichmentFailed,
    enrichmentContentRowsCreated: 0,
    evidenceLinksCreated: r.evidenceLinks,
    duplicateContentHashGroups: analysis.duplicateContentHashGroups.length,
    invalidEnumValues: analysis.invalidEnumValues,
    missingRequiredFields: analysis.missingRequiredFields,
    publicRowsWithReviewFlags: analysis.publicRowsWithReviewFlag,
    perDataset: analysis.perDataset,
    finalStatus: analysis.ok && analysis.enrichment.failed === 0 ? "PASS" : "FAIL",
    errors: analysis.errors,
  };

  writeFileSync(resolve(reportsDir, "import-report.json"), JSON.stringify(report, null, 2));

  const md = `# Merge-ready import report

- **Timestamp:** ${report.timestamp}
- **Mode:** ${r.dryRun ? "dry-run (no DB writes)" : "import"}
- **Final status:** ${report.finalStatus}

## Row counts per source
| Source | Staged | Expected |
| --- | --- | --- |
| web | ${analysis.rowCounts.web} | ${analysis.expected.web} |
| opinions | ${analysis.rowCounts.opinions} | ${analysis.expected.opinions} |
| annual_reports | ${analysis.rowCounts.annual_reports} | ${analysis.expected.annual_reports} |
| enrichment (no content rows) | ${analysis.rowCounts.enrichment} | ${analysis.expected.enrichment} |
| **Total content** | **${analysis.totalContentStaged}** | **${analysis.expected.totalContentBeforeExclusions}** |

## Import
- Content created: ${report.contentRowsCreated}
- Content updated: ${report.contentRowsUpdated}
- DB content rows from merge-ready: ${report.dbContentRowsFromMergeReady}
- Public rows: ${report.publicRows}
- Excluded from public (hidden/supporting): ${report.excludedFromPublic}
- Needs-review rows: ${report.needsReviewRows}
- do_not_import_yet rows: ${report.doNotImportRows}
- Weak/failed extraction rows: ${report.weakOrFailedExtractionRows}
- Opinion rows imported as supporting evidence: ${report.opinionRowsImportedAsEvidence}
- Annual rows imported: ${report.annualRowsImported}

## Achievement enrichment
- Canonical achievement rows: ${report.canonicalAchievementRows}
- Enrichment rows: ${report.achievementEnrichmentRows}
- Matches: ${report.enrichmentMatches}
- Failures: ${Array.isArray(report.enrichmentFailures) ? report.enrichmentFailures.length : report.enrichmentFailures}
- **Content rows created from enrichment file: ${report.enrichmentContentRowsCreated}**

## Data quality
- Duplicate content-hash groups: ${report.duplicateContentHashGroups}
- Invalid enum values: ${report.invalidEnumValues.length}
- Missing required fields: ${report.missingRequiredFields.length}
- Public rows still flagged for review: ${report.publicRowsWithReviewFlags.length}
- Evidence links created: ${report.evidenceLinksCreated}

${analysis.errors.length ? "## Errors\n" + analysis.errors.map((e) => "- " + e).join("\n") : "_No errors._"}
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
    // Disconnect best-effort; never let a disconnect error mask the run result
    // (e.g. dry-run never opened a connection).
    if (closeHandle) await closeHandle().catch(() => {});
  });

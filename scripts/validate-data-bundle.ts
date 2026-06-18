import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256File, writePrettyJson, type JsonValue } from "./lib/data-bundle";

type IssueLevel = "warning" | "error";
type Issue = { level: IssueLevel; message: string };
type RecordLike = Record<string, any>;

const EXPECTED_FILES = [
  "manifest.json",
  "qa_report.json",
  "content_items.jsonl",
  "achievement_enrichment.jsonl",
  "taxonomy.json",
  "taxonomy_rules.json",
  "review_candidates.jsonl",
  "tag_dictionary.json",
] as const;

const ALLOWED_IMPORT_STATUS = new Set([
  "import_public_candidate",
  "import_after_review",
  "import_hidden",
  "do_not_import_yet",
]);

const ALLOWED_PUBLIC_DISPLAY = new Set([
  "main_result_candidate",
  "topic_history",
  "supporting_source",
  "annual_context",
  "service_context",
  "hide_or_review",
  "admin_only",
]);

function parseArgs(argv: string[]): { bundle?: string } {
  const parsed: { bundle?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bundle") parsed.bundle = argv[++i];
    else if (arg.startsWith("--bundle=")) parsed.bundle = arg.slice("--bundle=".length);
  }
  return parsed;
}

function readJson(path: string): RecordLike {
  return JSON.parse(readFileSync(path, "utf8")) as RecordLike;
}

function readJsonLines(path: string): RecordLike[] {
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RecordLike);
}

function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value || "(null)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function duplicateSummary(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, count]) => count > 1);
  return {
    duplicateValueCount: dupes.length,
    duplicateRowCount: dupes.reduce((sum, [, count]) => sum + count, 0),
    examples: dupes.slice(0, 10).map(([value, count]) => `${value} (${count})`),
  };
}

function add(issues: Issue[], level: IssueLevel, message: string): void {
  issues.push({ level, message });
}

function isIsoLikeDate(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateBoundaryRules(taxonomyRules: RecordLike, issues: Issue[]) {
  const boundary = taxonomyRules.boundaryRules ?? {};
  const asText = JSON.stringify(boundary).toLowerCase();
  if (!asText.includes("e-commerce") || !asText.includes("e-pood") || !asText.includes("taganemisnupp")) {
    add(issues, "error", "IT/e-commerce leakage guard is missing e-commerce/e-pood/taganemisnupp boundary text.");
  }
  if (!asText.includes("digiteemad") || !asText.includes("tehisintellekt") || !asText.includes("cybersecurity")) {
    add(issues, "warning", "Digiteemad boundary text is missing one or more expected anchors.");
  }
  if (!asText.includes("keskkond") || !asText.includes("waste") || !asText.includes("packaging")) {
    add(issues, "warning", "Keskkond boundary text is missing one or more expected anchors.");
  }
  if (!asText.includes("agriculture") || !asText.includes("forestry") || !asText.includes("fishing")) {
    add(issues, "error", "Agriculture/environment leakage guard is missing.");
  }
  if (!asText.includes("word-boundary") || !asText.includes("tehisintellekt") || !asText.includes("tehisaru")) {
    add(issues, "error", "AI matching boundary guard is missing word-boundary/Estonian strong-term logic.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = resolve(process.cwd(), args.bundle || "data/import/bundles/koda_data_bundle_v1");
  const issues: Issue[] = [];
  const timestamp = new Date().toISOString();

  const paths = Object.fromEntries(EXPECTED_FILES.map((file) => [file, resolve(bundleDir, file)]));
  const fileStatus = EXPECTED_FILES.map((file) => ({
    file,
    exists: existsSync(paths[file]),
    sha256: existsSync(paths[file]) ? sha256File(paths[file]) : null,
  }));

  for (const status of fileStatus) {
    if (!status.exists) add(issues, "error", `Missing expected bundle file: ${status.file}`);
  }
  if (issues.some((issue) => issue.level === "error")) {
    console.error("[validate-bundle] Missing required files.");
    for (const issue of issues) console.error(`  - ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  const manifest = readJson(paths["manifest.json"]);
  const qaReport = readJson(paths["qa_report.json"]);
  const contentItems = readJsonLines(paths["content_items.jsonl"]);
  const enrichment = readJsonLines(paths["achievement_enrichment.jsonl"]);
  const taxonomy = readJson(paths["taxonomy.json"]);
  const taxonomyRules = readJson(paths["taxonomy_rules.json"]);
  const reviewCandidates = readJsonLines(paths["review_candidates.jsonl"]);
  const tagDictionary = readJson(paths["tag_dictionary.json"]);

  const sourceFiles = Array.isArray(manifest.source_files) ? manifest.source_files : [];
  if (sourceFiles.length === 0 || sourceFiles.some((source: RecordLike) => !source.sha256)) {
    add(issues, "error", "Manifest source file hashes are missing.");
  }

  const sourceDatasetCounts = countBy(contentItems.map((item) => item.sourceDataset));
  if (contentItems.length !== 4933) add(issues, "error", `content_items.jsonl row count is ${contentItems.length}, expected 4933.`);
  if (sourceDatasetCounts.web !== 3937) add(issues, "error", `web content count is ${sourceDatasetCounts.web ?? 0}, expected 3937.`);
  if (sourceDatasetCounts.opinions !== 759) add(issues, "error", `opinions content count is ${sourceDatasetCounts.opinions ?? 0}, expected 759.`);
  if (sourceDatasetCounts.annual_reports !== 237) {
    add(issues, "error", `annual_reports content count is ${sourceDatasetCounts.annual_reports ?? 0}, expected 237.`);
  }

  if (enrichment.length !== 76) add(issues, "error", `achievement_enrichment.jsonl row count is ${enrichment.length}, expected 76.`);
  if (reviewCandidates.length !== 1159) add(issues, "error", `review_candidates.jsonl row count is ${reviewCandidates.length}, expected 1159.`);
  if (!Array.isArray(taxonomy.categories) || taxonomy.categories.length === 0) add(issues, "error", "taxonomy.json has no categories.");
  if (!Array.isArray(taxonomyRules.topicTerms) || taxonomyRules.topicTerms.length === 0) {
    add(issues, "error", "taxonomy_rules.json has no topic terms.");
  }
  if (!Array.isArray(tagDictionary.valdkonnad) || tagDictionary.valdkonnad.length === 0) {
    add(issues, "error", "tag_dictionary.json has no valdkonnad.");
  }

  const enrichmentInContent = contentItems.filter((item) => item.sourceDataset !== "web" && item.sourceLayer === "koda.ee töövõidud");
  if (enrichmentInContent.length > 0) add(issues, "error", "Enrichment rows are included as content.");

  const duplicateExternalIds = duplicateSummary(contentItems.map((item) => item.externalId));
  if (duplicateExternalIds.duplicateValueCount > 0) add(issues, "error", "Duplicate external IDs found.");
  const duplicateCanonicalUrls = duplicateSummary(contentItems.map((item) => item.canonicalUrl));

  const publicWebMissingTitle = contentItems.filter((item) => item.sourceDataset === "web" && item.isPublic && !item.title);
  const publicWebMissingCanonicalUrl = contentItems.filter((item) => item.sourceDataset === "web" && item.isPublic && !item.canonicalUrl);
  if (publicWebMissingTitle.length > 0) add(issues, "error", `Public web rows missing title: ${publicWebMissingTitle.length}.`);
  if (publicWebMissingCanonicalUrl.length > 0) {
    add(issues, "error", `Public web rows missing canonicalUrl: ${publicWebMissingCanonicalUrl.length}.`);
  }

  const opinionPublicWithoutUrl = contentItems.filter(
    (item) => item.sourceDataset === "opinions" && item.isPublic && !item.sourceUrl && !item.canonicalUrl,
  );
  if (opinionPublicWithoutUrl.length > 0) add(issues, "warning", `Opinion rows public without URL: ${opinionPublicWithoutUrl.length}.`);

  const invalidImportStatus = [...new Set(contentItems.map((item) => item.importStatus).filter((status) => status && !ALLOWED_IMPORT_STATUS.has(status)))];
  const invalidPublicDisplayStatus = [
    ...new Set(contentItems.map((item) => item.publicDisplayStatus).filter((status) => status && !ALLOWED_PUBLIC_DISPLAY.has(status))),
  ];
  if (invalidImportStatus.length > 0) add(issues, "warning", `Unknown importStatus values: ${invalidImportStatus.join(", ")}.`);
  if (invalidPublicDisplayStatus.length > 0) {
    add(issues, "warning", `Unknown publicDisplayStatus values: ${invalidPublicDisplayStatus.join(", ")}.`);
  }

  const invalidDates = contentItems.filter((item) => !isIsoLikeDate(item.date));
  if (invalidDates.length > 0) add(issues, "warning", `Invalid or non-ISO dates: ${invalidDates.length}.`);
  const invalidYears = contentItems.filter((item) => item.year !== null && (typeof item.year !== "number" || item.year < 1900 || item.year > 2100));
  if (invalidYears.length > 0) add(issues, "warning", `Invalid years: ${invalidYears.length}.`);

  const emptyTagArraysBySource: Record<string, { valdkonnad: number; tegevusalad: number; tapsustused: number }> = {};
  const suspiciousLongTags: string[] = [];
  for (const item of contentItems) {
    const key = item.sourceDataset || "(unknown)";
    emptyTagArraysBySource[key] ??= { valdkonnad: 0, tegevusalad: 0, tapsustused: 0 };
    if (!Array.isArray(item.valdkonnad) || item.valdkonnad.length === 0) emptyTagArraysBySource[key].valdkonnad++;
    if (!Array.isArray(item.tegevusalad) || item.tegevusalad.length === 0) emptyTagArraysBySource[key].tegevusalad++;
    if (!Array.isArray(item.tapsustused) || item.tapsustused.length === 0) emptyTagArraysBySource[key].tapsustused++;
    for (const tag of [...(item.valdkonnad ?? []), ...(item.tegevusalad ?? []), ...(item.tapsustused ?? [])]) {
      if (typeof tag === "string" && tag.length > 120) suspiciousLongTags.push(`${item.externalId}: ${tag}`);
    }
  }
  if (Object.values(emptyTagArraysBySource).some((counts) => counts.valdkonnad || counts.tegevusalad || counts.tapsustused)) {
    add(issues, "warning", "Some rows have empty tag arrays.");
  }
  if (suspiciousLongTags.length > 0) add(issues, "warning", `Suspiciously long tag values: ${suspiciousLongTags.length}.`);

  const unmatchedEnrichment = enrichment.filter((item) => !item.targetAchievementId);
  if (unmatchedEnrichment.length > 0) add(issues, "warning", `Unmatched enrichment rows: ${unmatchedEnrichment.length}.`);

  const appliedCandidates = reviewCandidates.filter((candidate) => candidate.applied !== false);
  if (appliedCandidates.length > 0) add(issues, "error", "Review candidates appear to be applied automatically.");

  validateBoundaryRules(taxonomyRules, issues);

  const errors = issues.filter((issue) => issue.level === "error").map((issue) => issue.message);
  const warnings = issues.filter((issue) => issue.level === "warning").map((issue) => issue.message);
  const validationStatus = errors.length > 0 ? "failed" : warnings.length > 0 ? "passed_with_warnings" : "passed";

  const validation = {
    generated_timestamp: timestamp,
    validation_status: validationStatus,
    warning_count: warnings.length,
    error_count: errors.length,
    expected_files: fileStatus,
    row_counts: {
      content_items: contentItems.length,
      sourceDataset: sourceDatasetCounts,
      achievement_enrichment: enrichment.length,
      taxonomy_categories: Array.isArray(taxonomy.categories) ? taxonomy.categories.length : 0,
      taxonomy_topic_terms: Array.isArray(taxonomyRules.topicTerms) ? taxonomyRules.topicTerms.length : 0,
      taxonomy_sector_rules: Array.isArray(taxonomyRules.sectorRelevanceRules) ? taxonomyRules.sectorRelevanceRules.length : 0,
      taxonomy_crawler_rules: Array.isArray(taxonomyRules.crawlerClassificationRules) ? taxonomyRules.crawlerClassificationRules.length : 0,
      review_candidates: reviewCandidates.length,
      tag_dictionary: tagDictionary.counts ?? null,
    },
    duplicates: {
      externalIds: duplicateExternalIds,
      canonicalUrls: duplicateCanonicalUrls,
    },
    public_safety: {
      publicWebMissingTitle: publicWebMissingTitle.length,
      publicWebMissingCanonicalUrl: publicWebMissingCanonicalUrl.length,
      opinionRowsPublicWithoutUrl: opinionPublicWithoutUrl.length,
    },
    enrichment: {
      count: enrichment.length,
      unmatched: unmatchedEnrichment.length,
      includedAsContent: enrichmentInContent.length,
    },
    review_candidates: {
      count: reviewCandidates.length,
      appliedAutomatically: appliedCandidates.length,
    },
    tags: {
      emptyTagArraysBySource,
      suspiciousLongTagValues: suspiciousLongTags.slice(0, 20),
    },
    warnings,
    errors,
  };

  qaReport.full_bundle_validation = validation;
  qaReport.validation_status = validationStatus;
  qaReport.validation_warning_count = warnings.length;
  qaReport.validation_error_count = errors.length;
  writePrettyJson(paths["qa_report.json"], qaReport as JsonValue);

  console.log(`[validate-bundle] Validation status: ${validationStatus}`);
  console.log(`[validate-bundle] content_items: ${contentItems.length}/4933`);
  console.log(`[validate-bundle] achievement_enrichment: ${enrichment.length}/76`);
  console.log(`[validate-bundle] review_candidates: ${reviewCandidates.length}/1159`);
  console.log(`[validate-bundle] warnings: ${warnings.length}, errors: ${errors.length}`);
  for (const warning of warnings.slice(0, 10)) console.log(`  warning: ${warning}`);
  for (const error of errors.slice(0, 10)) console.error(`  error: ${error}`);

  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

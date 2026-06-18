import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { contentHash, normalizeTitle } from "../src/lib/hash";
import {
  BundleIssues,
  ensureOutputDir,
  getSourceFileStatus,
  readWorksheetRows,
  resolveInputDir,
  resolveOutputDir,
  sha256File,
  writeJsonLines,
  writePrettyJson,
  type JsonValue,
  type SourceFileStatus,
} from "./lib/data-bundle";

type SourceDefinition = {
  logicalName: string;
  fileName: string;
  sourceSheet: string;
  expectedRows: number | null;
};

type ValidationStatus = "passed" | "passed_with_warnings" | "failed";
type SourceDataset = "web" | "opinions" | "annual_reports";
type Row = Record<string, string>;

type SourceRow = {
  file: string;
  sheet: string;
  rowNumber: number;
};

type ContentItem = {
  externalId: string;
  sourceDataset: SourceDataset;
  sourceLayer: string | null;
  sourceTypeDetail: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  title: string | null;
  displayTitle: string | null;
  date: string | null;
  year: number | null;
  reportYear: number | null;
  sourceFileName: string | null;
  sourceSection: string | null;
  sourcePageLocation: string | null;
  bodyText: string | null;
  excerpt: string | null;
  summary: string | null;
  kodaPosition: string | null;
  companyRelevance: string | null;
  sourceEvidence: string | null;
  outcomeStatus: string | null;
  importStatus: string | null;
  publicDisplayStatus: string | null;
  mergeReadiness: string | null;
  mergeNotes: string | null;
  extractionQuality: string | null;
  needsHumanReview: boolean;
  reviewReason: string | null;
  publicPriority: number | null;
  primaryCategory: string | null;
  secondaryCategories: string[];
  topicGroupCandidate: string | null;
  valdkonnad: string[];
  tegevusalad: string[];
  tapsustused: string[];
  canonicalContentId: string | null;
  duplicateStatus: string | null;
  isEvergreen: boolean;
  isPublic: boolean;
  language: "et";
  contentHash: string;
  sourceRow: SourceRow;
};

type AchievementTarget = {
  externalId: string;
  titleKey: string;
  sourceUrlKey: string | null;
  year: number | null;
};

type AchievementEnrichment = {
  standaloneAchievementId: string | null;
  targetAchievementId: string | null;
  achievementTitle: string | null;
  achievementTitleKey: string | null;
  sourceUrl: string | null;
  sourceUrlKey: string | null;
  achievementYear: number | null;
  dateOrYearDetected: string | null;
  primaryTopic: string | null;
  secondaryTopics: string[];
  affectedCompanyTypes: string[];
  affectedBusinessFunctions: string[];
  regulatoryArea: string | null;
  valueType: string | null;
  numericImpactStatement: string | null;
  kodaRole: string | null;
  achievementSummary: string | null;
  companyRelevance: string | null;
  publicValueText: string | null;
  matchPriority: string | null;
  targetMatchMethod: string | null;
  targetMatchConfidence: string | null;
  confidence: string | null;
  reviewNeeded: boolean;
  mergeNotes: string | null;
  sourceRow: SourceRow;
};

type TaxonomyCategory = {
  sourceOneNoteCategory: string | null;
  canonicalValdkond: string | null;
  slug: string | null;
  scopeDescription: string | null;
  includeExamples: string[];
  excludeExamples: string[];
  aliases: string[];
  status: string | null;
  confidence: string | null;
  notes: string | null;
  sourceRow: SourceRow;
};

type ReviewCandidate = {
  contentId: string | null;
  title: string | null;
  url: string | null;
  currentValdkond: string[];
  suggestedValdkond: string[];
  currentTegevusala: string[];
  suggestedTegevusala: string[];
  currentTapsustus: string[];
  suggestedTapsustus: string[];
  ruleSource: string | null;
  evidence: string | null;
  confidence: string | null;
  recommendedAction: string | null;
  reviewNote: string | null;
  applied: false;
  sourceRow: SourceRow;
};

const BUNDLE_VERSION = "koda_data_bundle_v1";
const SCHEMA_VERSION = "bundle-manifest-qa-v1";
const EXPECTED_CONTENT_COUNT = 4933;

const SOURCES = {
  web: {
    logicalName: "web_index",
    fileName: "koda_web_index_v1_1_merge_ready.xlsx",
    sourceSheet: "web_merge_ready",
    expectedRows: 3937,
  },
  opinions: {
    logicalName: "opinions",
    fileName: "koda_opinions_v1_merge_ready.xlsx",
    sourceSheet: "opinions_merge_ready",
    expectedRows: 759,
  },
  annual: {
    logicalName: "annual_reports",
    fileName: "koda_annual_reports_v1_merge_ready.xlsx",
    sourceSheet: "annual_reports_merge_ready",
    expectedRows: 237,
  },
  enrichment: {
    logicalName: "achievement_enrichment",
    fileName: "koda_toovoidud_enrichment_v1_merge_ready.xlsx",
    sourceSheet: "toovoidud_enrichment_ready",
    expectedRows: 76,
  },
  taxonomy: {
    logicalName: "taxonomy_unification",
    fileName: "koda_taxonomy_unification_v1.xlsx",
    sourceSheet: "category_authority",
    expectedRows: null,
  },
} as const satisfies Record<string, SourceDefinition>;

const TAXONOMY_SHEETS = [
  "category_authority",
  "topic_terms",
  "sector_relevance_rules",
  "crawler_classification_rules",
  "reclassification_candidates",
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

const PUBLIC_BLOCKING_DISPLAY = new Set(["admin_only", "hide_or_review"]);
const PUBLIC_BLOCKING_READINESS = new Set([
  "do_not_merge_yet",
  "merge_ready_after_review",
  "merge_ready_review_status_retained",
  "ready_for_merge_after_light_review",
  "needs_manual_topic_review",
  "needs_manual_schema_review",
]);
const WEAK_EXTRACTION = new Set(["weak", "failed", "partial"]);

function parseArgs(argv: string[]): { inputDir?: string; outDir?: string } {
  const parsed: { inputDir?: string; outDir?: string } = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input-dir") parsed.inputDir = argv[++i];
    else if (arg.startsWith("--input-dir=")) parsed.inputDir = arg.slice("--input-dir=".length);
    else if (arg === "--out") parsed.outDir = argv[++i];
    else if (arg.startsWith("--out=")) parsed.outDir = arg.slice("--out=".length);
  }

  return parsed;
}

function gitCommit(issues: BundleIssues): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    issues.warn("Could not detect current git commit.");
    return null;
  }
}

function validationStatus(issues: BundleIssues): ValidationStatus {
  if (issues.errors.length > 0) return "failed";
  if (issues.warnings.length > 0) return "passed_with_warnings";
  return "passed";
}

function nullIfEmpty(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

function firstText(row: Row, keys: string[]): string | null {
  for (const key of keys) {
    const value = nullIfEmpty(row[key]);
    if (value) return value;
  }
  return null;
}

function splitMulti(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const rawPart of (value ?? "").split(/[;|,\n\r]+/)) {
    const part = rawPart.trim();
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }

  return out;
}

function parseBool(value: string | null | undefined): boolean {
  return ["true", "1", "yes", "jah"].includes((value ?? "").trim().toLowerCase());
}

function parseNumber(value: string | null | undefined): number | null {
  const text = (value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseYear(value: string | null | undefined): number | null {
  const match = (value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function normalizeDate(value: string | null | undefined, issues: string[], sourceRow: SourceRow): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dotted = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) {
    return `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
  }

  const yearOnly = text.match(/^(\d{4})$/);
  if (yearOnly) return `${yearOnly[1]}-01-01`;

  issues.push(`${sourceRow.file} / ${sourceRow.sheet} row ${sourceRow.rowNumber}: could not normalize date "${text}".`);
  return text;
}

function sourceUrlKey(value: string | null | undefined): string | null {
  const text = nullIfEmpty(value);
  if (!text) return null;
  return text.replace(/#.*$/, "").replace(/\/$/, "");
}

function slugify(value: string | null | undefined): string | null {
  const text = nullIfEmpty(value);
  if (!text) return null;
  return normalizeTitle(text).replace(/\s+/g, "-");
}

function computeIsPublic(item: Omit<ContentItem, "isPublic" | "contentHash">): boolean {
  if (item.needsHumanReview) return false;
  if (item.importStatus !== "import_public_candidate") return false;
  if (item.publicDisplayStatus && PUBLIC_BLOCKING_DISPLAY.has(item.publicDisplayStatus)) return false;
  if (item.mergeReadiness && PUBLIC_BLOCKING_READINESS.has(item.mergeReadiness)) return false;
  if (item.extractionQuality && WEAK_EXTRACTION.has(item.extractionQuality)) return false;
  if (item.sourceDataset === "opinions" && !item.sourceUrl && !item.canonicalUrl) return false;
  return true;
}

function finishItem(input: Omit<ContentItem, "isPublic" | "contentHash" | "language">): ContentItem {
  const visibilityInput = { ...input, language: "et" as const };
  const isPublic = computeIsPublic(visibilityInput);
  return {
    ...visibilityInput,
    isPublic,
    contentHash: contentHash(input.title ?? input.externalId, input.bodyText ?? input.excerpt ?? input.summary ?? ""),
  };
}

function mapWebRow(row: Row, index: number, dateIssues: string[]): ContentItem {
  const sourceRow = { file: SOURCES.web.fileName, sheet: SOURCES.web.sourceSheet, rowNumber: index + 2 };
  const title =
    firstText(row, ["source_title", "cleaned_display_title", "canonical_url", "source_url", "content_id"]) ??
    "(missing title)";
  const displayTitle = firstText(row, ["cleaned_display_title"]) ?? title;
  const bodyText = firstText(row, ["body_text_full", "body_text", "source_text_excerpt"]);

  return finishItem({
    externalId: firstText(row, ["content_id"]) ?? `web-row-${index + 1}`,
    sourceDataset: "web",
    sourceLayer: firstText(row, ["source_layer_merge", "source_layer"]),
    sourceTypeDetail: firstText(row, ["source_type_merge", "source_type"]),
    sourceUrl: firstText(row, ["source_url"]),
    canonicalUrl: firstText(row, ["canonical_url", "source_url"]),
    title,
    displayTitle,
    date: normalizeDate(firstText(row, ["date"]), dateIssues, sourceRow),
    year: parseYear(firstText(row, ["year", "date"])),
    reportYear: null,
    sourceFileName: firstText(row, ["source_input_file"]),
    sourceSection: firstText(row, ["source_section"]),
    sourcePageLocation: firstText(row, ["source_page_or_location", "source_page_location"]),
    bodyText,
    excerpt: firstText(row, ["source_text_excerpt"]),
    summary: firstText(row, ["short_summary_et"]),
    kodaPosition: firstText(row, ["koda_position_or_impact_et"]),
    companyRelevance: firstText(row, ["company_relevance_et"]),
    sourceEvidence: firstText(row, ["source_evidence_short", "source_evidence"]),
    outcomeStatus: firstText(row, ["outcome_status"]),
    importStatus: firstText(row, ["import_status_merge"]),
    publicDisplayStatus: firstText(row, ["public_display_merge"]),
    mergeReadiness: firstText(row, ["merge_readiness"]),
    mergeNotes: firstText(row, ["merge_notes"]),
    extractionQuality: firstText(row, ["extraction_quality"]),
    needsHumanReview: parseBool(firstText(row, ["needs_human_review_merge"])),
    reviewReason: firstText(row, ["review_reason"]),
    publicPriority: parseNumber(firstText(row, ["public_priority"])),
    primaryCategory: firstText(row, ["primary_category_merge", "primary_category"]),
    secondaryCategories: splitMulti(firstText(row, ["secondary_categories"])),
    topicGroupCandidate: firstText(row, ["topic_group_candidate"]),
    valdkonnad: splitMulti(firstText(row, ["filter_valdkonnad_merge"])),
    tegevusalad: splitMulti(firstText(row, ["filter_tegevusala_merge"])),
    tapsustused: splitMulti(firstText(row, ["filter_tapsustus_merge_provisional", "filter_tapsustus"])),
    canonicalContentId: firstText(row, ["canonical_content_id"]),
    duplicateStatus: firstText(row, ["duplicate_status"]),
    isEvergreen: ["yes", "true", "1"].includes((firstText(row, ["evergreen_candidate"]) ?? "").toLowerCase()),
    sourceRow,
  });
}

function mapOpinionRow(row: Row, index: number, dateIssues: string[]): ContentItem {
  const sourceRow = { file: SOURCES.opinions.fileName, sheet: SOURCES.opinions.sourceSheet, rowNumber: index + 2 };
  const title =
    firstText(row, ["cleaned_display_title", "title_from_filename", "file_name", "content_id"]) ??
    "(missing title)";

  return finishItem({
    externalId: firstText(row, ["content_id"]) ?? `opinion-row-${index + 1}`,
    sourceDataset: "opinions",
    sourceLayer: firstText(row, ["source_layer"]),
    sourceTypeDetail: firstText(row, ["source_type"]),
    sourceUrl: null,
    canonicalUrl: null,
    title,
    displayTitle: title,
    date: normalizeDate(firstText(row, ["date"]), dateIssues, sourceRow),
    year: parseYear(firstText(row, ["year", "date"])),
    reportYear: null,
    sourceFileName: firstText(row, ["file_name"]),
    sourceSection: firstText(row, ["recipient"]),
    sourcePageLocation: null,
    bodyText: firstText(row, ["short_summary_et"]),
    excerpt: firstText(row, ["short_summary_et"]),
    summary: firstText(row, ["short_summary_et"]),
    kodaPosition: firstText(row, ["koda_position_or_impact_et"]),
    companyRelevance: firstText(row, ["company_relevance_et"]),
    sourceEvidence: firstText(row, ["source_evidence_short", "source_evidence"]),
    outcomeStatus: firstText(row, ["outcome_status"]),
    importStatus: firstText(row, ["import_status_merge"]),
    publicDisplayStatus: firstText(row, ["public_display_merge"]),
    mergeReadiness: firstText(row, ["merge_readiness"]),
    mergeNotes: firstText(row, ["merge_notes"]),
    extractionQuality: firstText(row, ["text_extraction_quality", "extraction_quality"]),
    needsHumanReview: parseBool(firstText(row, ["needs_human_review_merge", "corrected_needs_human_review", "needs_human_review"])),
    reviewReason: firstText(row, ["corrected_review_reason", "review_reason"]),
    publicPriority: parseNumber(firstText(row, ["public_priority"])),
    primaryCategory: firstText(row, ["primary_category_merge", "primary_category"]),
    secondaryCategories: splitMulti(firstText(row, ["corrected_secondary_categories", "secondary_categories", "subtopics"])),
    topicGroupCandidate: firstText(row, ["topic_group_candidate"]),
    valdkonnad: splitMulti(firstText(row, ["filter_valdkonnad_merge", "filter_valdkonnad"])),
    tegevusalad: splitMulti(firstText(row, ["filter_tegevusala_merge", "filter_tegevusala"])),
    tapsustused: splitMulti(firstText(row, ["filter_tapsustus"])),
    canonicalContentId: firstText(row, ["duplicate_or_related_to"]),
    duplicateStatus: null,
    isEvergreen: ["yes", "true", "1"].includes((firstText(row, ["evergreen_candidate"]) ?? "").toLowerCase()),
    sourceRow,
  });
}

function mapAnnualRow(row: Row, index: number, dateIssues: string[]): ContentItem {
  const sourceRow = { file: SOURCES.annual.fileName, sheet: SOURCES.annual.sourceSheet, rowNumber: index + 2 };
  const title =
    firstText(row, ["source_title", "cleaned_display_title", "source_file", "content_id"]) ??
    "(missing title)";
  const displayTitle = firstText(row, ["cleaned_display_title"]) ?? title;
  const reportYear = parseYear(firstText(row, ["report_year"]));
  const publicationYear = parseYear(firstText(row, ["publication_year", "report_year"]));

  return finishItem({
    externalId: firstText(row, ["content_id"]) ?? `annual-row-${index + 1}`,
    sourceDataset: "annual_reports",
    sourceLayer: firstText(row, ["source_layer"]),
    sourceTypeDetail: firstText(row, ["source_type"]),
    sourceUrl: null,
    canonicalUrl: null,
    title,
    displayTitle,
    date: reportYear ? `${reportYear}-01-01` : normalizeDate(firstText(row, ["publication_year"]), dateIssues, sourceRow),
    year: publicationYear,
    reportYear,
    sourceFileName: firstText(row, ["source_file"]),
    sourceSection: firstText(row, ["source_section"]),
    sourcePageLocation: firstText(row, ["source_page_or_location"]),
    bodyText: firstText(row, ["source_text_excerpt"]),
    excerpt: firstText(row, ["source_text_excerpt"]),
    summary: firstText(row, ["short_summary_et"]),
    kodaPosition: firstText(row, ["koda_position_or_impact_et"]),
    companyRelevance: firstText(row, ["company_relevance_et"]),
    sourceEvidence: firstText(row, ["source_evidence_short", "source_evidence"]),
    outcomeStatus: firstText(row, ["outcome_status_merge", "outcome_status"]),
    importStatus: firstText(row, ["import_status_merge"]),
    publicDisplayStatus: firstText(row, ["public_display_merge"]),
    mergeReadiness: firstText(row, ["merge_readiness"]),
    mergeNotes: firstText(row, ["merge_notes"]),
    extractionQuality: firstText(row, ["extraction_quality"]),
    needsHumanReview: parseBool(firstText(row, ["needs_human_review_merge"])),
    reviewReason: firstText(row, ["review_reason"]),
    publicPriority: parseNumber(firstText(row, ["public_priority"])),
    primaryCategory: firstText(row, ["primary_category_merge", "primary_category"]),
    secondaryCategories: splitMulti(firstText(row, ["secondary_categories"])),
    topicGroupCandidate: firstText(row, ["topic_group_candidate"]),
    valdkonnad: splitMulti(firstText(row, ["filter_valdkonnad_merge", "filter_valdkonnad"])),
    tegevusalad: splitMulti(firstText(row, ["filter_tegevusala_merge", "filter_tegevusala"])),
    tapsustused: splitMulti(firstText(row, ["filter_tapsustus"])),
    canonicalContentId: firstText(row, ["related_content_ids"]),
    duplicateStatus: null,
    isEvergreen: ["yes", "true", "1"].includes((firstText(row, ["evergreen_candidate"]) ?? "").toLowerCase()),
    sourceRow,
  });
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value || "(empty)"] = (counts[value || "(empty)"] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function duplicateSummary(values: Array<string | null>): { duplicate_value_count: number; duplicate_row_count: number; examples: string[] } {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
  return {
    duplicate_value_count: duplicates.length,
    duplicate_row_count: duplicates.reduce((sum, [, count]) => sum + count, 0),
    examples: duplicates.slice(0, 10).map(([value, count]) => `${value} (${count})`),
  };
}

function uniqueTagSummary(items: ContentItem[]) {
  const valdkonnad = new Set<string>();
  const tegevusalad = new Set<string>();
  const tapsustused = new Set<string>();
  const emptyTagCountsBySource: Record<SourceDataset, { valdkonnad: number; tegevusalad: number; tapsustused: number }> = {
    web: { valdkonnad: 0, tegevusalad: 0, tapsustused: 0 },
    opinions: { valdkonnad: 0, tegevusalad: 0, tapsustused: 0 },
    annual_reports: { valdkonnad: 0, tegevusalad: 0, tapsustused: 0 },
  };
  const suspiciousVeryLongTagValues: string[] = [];

  for (const item of items) {
    if (item.valdkonnad.length === 0) emptyTagCountsBySource[item.sourceDataset].valdkonnad++;
    if (item.tegevusalad.length === 0) emptyTagCountsBySource[item.sourceDataset].tegevusalad++;
    if (item.tapsustused.length === 0) emptyTagCountsBySource[item.sourceDataset].tapsustused++;

    for (const value of item.valdkonnad) valdkonnad.add(value);
    for (const value of item.tegevusalad) tegevusalad.add(value);
    for (const value of item.tapsustused) tapsustused.add(value);
    for (const value of [...item.valdkonnad, ...item.tegevusalad, ...item.tapsustused]) {
      if (value.length > 120) suspiciousVeryLongTagValues.push(`${item.externalId}: ${value}`);
    }
  }

  return {
    total_unique_valdkond_values: valdkonnad.size,
    total_unique_tegevusala_values: tegevusalad.size,
    total_unique_tapsustus_values: tapsustused.size,
    empty_tag_counts_by_source: emptyTagCountsBySource,
    suspicious_very_long_tag_values: suspiciousVeryLongTagValues.slice(0, 20),
  };
}

function buildContentItems(inputDir: string) {
  const dateIssues: string[] = [];
  const webPath = resolve(inputDir, SOURCES.web.fileName);
  const opinionsPath = resolve(inputDir, SOURCES.opinions.fileName);
  const annualPath = resolve(inputDir, SOURCES.annual.fileName);

  const webRows = readWorksheetRows(webPath, SOURCES.web.sourceSheet).rows;
  const opinionRows = readWorksheetRows(opinionsPath, SOURCES.opinions.sourceSheet).rows;
  const annualRows = readWorksheetRows(annualPath, SOURCES.annual.sourceSheet).rows;

  const items = [
    ...webRows.map((row, index) => mapWebRow(row, index, dateIssues)),
    ...opinionRows.map((row, index) => mapOpinionRow(row, index, dateIssues)),
    ...annualRows.map((row, index) => mapAnnualRow(row, index, dateIssues)),
  ];

  return { items, dateIssues };
}

function validateContentItems(items: ContentItem[], dateIssues: string[], issues: BundleIssues) {
  const byDataset = countBy(items.map((item) => item.sourceDataset));
  const publicRows = items.filter((item) => item.isPublic);
  const duplicateExternalIds = duplicateSummary(items.map((item) => item.externalId));
  const duplicateCanonicalUrls = duplicateSummary(items.map((item) => item.canonicalUrl));
  const duplicateSourceUrls = duplicateSummary(items.map((item) => item.sourceUrl));
  const publicWebMissingTitle = items.filter((item) => item.sourceDataset === "web" && item.isPublic && !item.title);
  const publicWebMissingCanonicalUrl = items.filter((item) => item.sourceDataset === "web" && item.isPublic && !item.canonicalUrl);
  const enrichmentRowsWronglyIncluded = items.filter(
    (item) => item.sourceDataset !== "web" && item.sourceLayer === "koda.ee töövõidud",
  );
  const unknownImportStatuses = [...new Set(items.map((item) => item.importStatus).filter((value): value is string => !!value && !ALLOWED_IMPORT_STATUS.has(value)))];
  const unknownPublicDisplayStatuses = [
    ...new Set(items.map((item) => item.publicDisplayStatus).filter((value): value is string => !!value && !ALLOWED_PUBLIC_DISPLAY.has(value))),
  ];
  const opinionRowsMarkedPublicWithoutUrl = items.filter(
    (item) => item.sourceDataset === "opinions" && item.isPublic && !item.sourceUrl && !item.canonicalUrl,
  );

  if (items.length !== EXPECTED_CONTENT_COUNT) {
    issues.error(`content_items.jsonl row count is ${items.length}, expected ${EXPECTED_CONTENT_COUNT}.`);
  }
  if (duplicateExternalIds.duplicate_value_count > 0) {
    issues.error(`Duplicate externalId values found: ${duplicateExternalIds.duplicate_value_count}.`);
  }
  if (publicWebMissingTitle.length > 0) {
    issues.error(`Public web rows missing title: ${publicWebMissingTitle.length}.`);
  }
  if (publicWebMissingCanonicalUrl.length > 0) {
    issues.error(`Public web rows missing canonicalUrl: ${publicWebMissingCanonicalUrl.length}.`);
  }
  if (enrichmentRowsWronglyIncluded.length > 0) {
    issues.error(`Enrichment rows appear in content_items.jsonl: ${enrichmentRowsWronglyIncluded.length}.`);
  }
  if (unknownImportStatuses.length > 0) {
    issues.warn(`Unknown importStatus values: ${unknownImportStatuses.join(", ")}.`);
  }
  if (unknownPublicDisplayStatuses.length > 0) {
    issues.warn(`Unknown publicDisplayStatus values: ${unknownPublicDisplayStatuses.join(", ")}.`);
  }
  if (dateIssues.length > 0) {
    issues.warn(`Date normalization issues found: ${dateIssues.length}.`);
  }
  if (items.some((item) => item.sourceDataset !== "web" && !item.canonicalUrl)) {
    issues.warn("Some annual/opinion rows have null canonicalUrl; this is expected for file-based sources.");
  }
  if (opinionRowsMarkedPublicWithoutUrl.length > 0) {
    issues.warn(`Opinion rows marked public without URL: ${opinionRowsMarkedPublicWithoutUrl.length}.`);
  }

  return {
    content_items_row_count: items.length,
    expected_content_items_row_count: EXPECTED_CONTENT_COUNT,
    row_count_by_sourceDataset: byDataset,
    row_count_by_sourceLayer: countBy(items.map((item) => item.sourceLayer ?? "(null)")),
    row_count_by_sourceTypeDetail: countBy(items.map((item) => item.sourceTypeDetail ?? "(null)")),
    row_count_by_importStatus: countBy(items.map((item) => item.importStatus ?? "(null)")),
    row_count_by_publicDisplayStatus: countBy(items.map((item) => item.publicDisplayStatus ?? "(null)")),
    public_row_count: publicRows.length,
    hidden_supporting_row_count: items.length - publicRows.length,
    needsHumanReview_count: items.filter((item) => item.needsHumanReview).length,
    missing_title_count: items.filter((item) => !item.title).length,
    missing_displayTitle_count: items.filter((item) => !item.displayTitle).length,
    missing_canonicalUrl_count_by_sourceDataset: {
      web: items.filter((item) => item.sourceDataset === "web" && !item.canonicalUrl).length,
      opinions: items.filter((item) => item.sourceDataset === "opinions" && !item.canonicalUrl).length,
      annual_reports: items.filter((item) => item.sourceDataset === "annual_reports" && !item.canonicalUrl).length,
    },
    public_web_rows_missing_canonicalUrl: publicWebMissingCanonicalUrl.length,
    duplicate_externalId: duplicateExternalIds,
    duplicate_canonicalUrl: duplicateCanonicalUrls,
    duplicate_sourceUrl: duplicateSourceUrls,
    invalid_unknown_importStatus_values: unknownImportStatuses,
    invalid_unknown_publicDisplayStatus_values: unknownPublicDisplayStatuses,
    opinion_rows_marked_public_without_url: opinionRowsMarkedPublicWithoutUrl.length,
    enrichment_rows_wrongly_included_as_content: enrichmentRowsWronglyIncluded.length,
    expected_4933_content_count_check: items.length === EXPECTED_CONTENT_COUNT,
    date_year_issues: dateIssues.slice(0, 50),
    tag_summary: uniqueTagSummary(items),
  };
}

function buildAchievementTargets(items: ContentItem[]): AchievementTarget[] {
  return items
    .filter((item) => item.sourceDataset === "web" && (item.sourceLayer === "koda_achievement" || item.sourceTypeDetail === "toovoit"))
    .map((item) => ({
      externalId: item.externalId,
      titleKey: normalizeTitle(item.title ?? ""),
      sourceUrlKey: sourceUrlKey(item.sourceUrl ?? item.canonicalUrl),
      year: item.year,
    }));
}

function uniqueTargetByKey(targets: AchievementTarget[], keyFn: (target: AchievementTarget) => string | null): Map<string, AchievementTarget> {
  const grouped = new Map<string, AchievementTarget[]>();
  for (const target of targets) {
    const key = keyFn(target);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), target]);
  }

  const unique = new Map<string, AchievementTarget>();
  for (const [key, values] of grouped.entries()) {
    if (values.length === 1) unique.set(key, values[0]);
  }
  return unique;
}

function matchAchievementTarget(row: Row, targets: AchievementTarget[]) {
  const title = firstText(row, ["achievement_title"]);
  const normalizedTitle = normalizeTitle(title ?? "");
  const urlKey = sourceUrlKey(firstText(row, ["source_url_key", "source_url"]));
  const year = parseYear(firstText(row, ["achievement_year", "year_key", "date_or_year_detected"]));

  const byExactId = uniqueTargetByKey(targets, (target) => target.externalId);
  const standaloneId = firstText(row, ["standalone_achievement_id", "achievement_id"]);
  if (standaloneId && byExactId.has(standaloneId)) {
    return { target: byExactId.get(standaloneId) ?? null, method: "exact_stable_id", confidence: "high" };
  }

  const titleUrlYearKey = normalizedTitle && urlKey && year ? `${normalizedTitle}|${urlKey}|${year}` : null;
  const byTitleUrlYear = uniqueTargetByKey(targets, (target) =>
    target.titleKey && target.sourceUrlKey && target.year ? `${target.titleKey}|${target.sourceUrlKey}|${target.year}` : null,
  );
  if (titleUrlYearKey && byTitleUrlYear.has(titleUrlYearKey)) {
    return { target: byTitleUrlYear.get(titleUrlYearKey) ?? null, method: "normalized_title_source_url_year", confidence: "high" };
  }

  const titleUrlKey = normalizedTitle && urlKey ? `${normalizedTitle}|${urlKey}` : null;
  const byTitleUrl = uniqueTargetByKey(targets, (target) => (target.titleKey && target.sourceUrlKey ? `${target.titleKey}|${target.sourceUrlKey}` : null));
  if (titleUrlKey && byTitleUrl.has(titleUrlKey)) {
    return { target: byTitleUrl.get(titleUrlKey) ?? null, method: "normalized_title_source_url", confidence: "medium" };
  }

  const byTitle = uniqueTargetByKey(targets, (target) => target.titleKey);
  if (normalizedTitle && byTitle.has(normalizedTitle)) {
    return { target: byTitle.get(normalizedTitle) ?? null, method: "unique_normalized_title", confidence: "medium" };
  }

  return { target: null, method: "unmatched", confidence: "review" };
}

function mapEnrichmentRow(row: Row, index: number, targets: AchievementTarget[]): AchievementEnrichment {
  const sourceRow = { file: SOURCES.enrichment.fileName, sheet: SOURCES.enrichment.sourceSheet, rowNumber: index + 2 };
  const match = matchAchievementTarget(row, targets);
  const workbookReviewNeeded = parseBool(firstText(row, ["review_needed"]));
  const isUnmatched = !match.target;

  return {
    standaloneAchievementId: firstText(row, ["standalone_achievement_id", "achievement_id"]),
    targetAchievementId: match.target?.externalId ?? null,
    achievementTitle: firstText(row, ["achievement_title"]),
    achievementTitleKey: firstText(row, ["achievement_title_key", "achievement_title_normalized"]) ?? normalizeTitle(firstText(row, ["achievement_title"]) ?? ""),
    sourceUrl: firstText(row, ["source_url"]),
    sourceUrlKey: sourceUrlKey(firstText(row, ["source_url_key", "source_url"])),
    achievementYear: parseYear(firstText(row, ["achievement_year", "year_key", "date_or_year_detected"])),
    dateOrYearDetected: firstText(row, ["date_or_year_detected"]),
    primaryTopic: firstText(row, ["primary_topic"]),
    secondaryTopics: splitMulti(firstText(row, ["secondary_topics"])),
    affectedCompanyTypes: splitMulti(firstText(row, ["affected_company_types"])),
    affectedBusinessFunctions: splitMulti(firstText(row, ["affected_business_functions"])),
    regulatoryArea: firstText(row, ["regulatory_area"]),
    valueType: firstText(row, ["value_type"]),
    numericImpactStatement: firstText(row, ["numeric_impact_statement"]),
    kodaRole: firstText(row, ["koda_role"]),
    achievementSummary: firstText(row, ["achievement_description"]),
    companyRelevance: firstText(row, ["company_relevance"]),
    publicValueText: firstText(row, ["source_evidence", "achievement_description"]),
    matchPriority: firstText(row, ["match_priority"]),
    targetMatchMethod: match.method,
    targetMatchConfidence: match.confidence,
    confidence: firstText(row, ["confidence"]),
    reviewNeeded: workbookReviewNeeded || isUnmatched,
    mergeNotes: firstText(row, ["merge_notes", "index_note"]),
    sourceRow,
  };
}

function buildAchievementEnrichment(inputDir: string, contentItems: ContentItem[]) {
  const enrichmentPath = resolve(inputDir, SOURCES.enrichment.fileName);
  const rows = readWorksheetRows(enrichmentPath, SOURCES.enrichment.sourceSheet).rows;
  const targets = buildAchievementTargets(contentItems);
  const items = rows.map((row, index) => mapEnrichmentRow(row, index, targets));
  return { items, targets };
}

function validateAchievementEnrichment(
  enrichmentItems: AchievementEnrichment[],
  targets: AchievementTarget[],
  contentItems: ContentItem[],
  issues: BundleIssues,
) {
  const duplicateIds = duplicateSummary(enrichmentItems.map((item) => item.standaloneAchievementId));
  const duplicateTitleKeys = duplicateSummary(enrichmentItems.map((item) => item.achievementTitleKey));
  const duplicateTargetMatches = duplicateSummary(enrichmentItems.map((item) => item.targetAchievementId));
  const unmatched = enrichmentItems.filter((item) => !item.targetAchievementId);
  const contentEnrichmentRows = contentItems.filter(
    (item) => item.sourceDataset !== "web" && item.sourceLayer === "koda.ee töövõidud",
  );
  const optionalFieldMissingCounts = {
    affectedCompanyTypes: enrichmentItems.filter((item) => item.affectedCompanyTypes.length === 0).length,
    affectedBusinessFunctions: enrichmentItems.filter((item) => item.affectedBusinessFunctions.length === 0).length,
    companyRelevance: enrichmentItems.filter((item) => !item.companyRelevance).length,
  };

  if (enrichmentItems.length !== SOURCES.enrichment.expectedRows) {
    issues.error(`achievement_enrichment.jsonl row count is ${enrichmentItems.length}, expected ${SOURCES.enrichment.expectedRows}.`);
  }
  if (contentItems.length !== EXPECTED_CONTENT_COUNT) {
    issues.error(`content_items.jsonl row count changed to ${contentItems.length}, expected ${EXPECTED_CONTENT_COUNT}.`);
  }
  if (contentEnrichmentRows.length > 0) {
    issues.error(`Enrichment rows appear in content_items.jsonl: ${contentEnrichmentRows.length}.`);
  }
  if (duplicateIds.duplicate_value_count > 0) {
    issues.error(`Duplicate enrichment IDs found: ${duplicateIds.duplicate_value_count}.`);
  }
  if (unmatched.length > 0) {
    issues.warn(`Some achievement enrichment rows could not be matched safely: ${unmatched.length}.`);
  }
  if (enrichmentItems.some((item) => item.targetMatchMethod !== "exact_stable_id")) {
    issues.warn("Achievement enrichment matching used title/URL/year keys because exact target IDs are not present in the workbook.");
  }
  if (Object.values(optionalFieldMissingCounts).some((count) => count > 0)) {
    issues.warn("Some optional enrichment fields are empty in the workbook.");
  }

  return {
    enrichment_row_count: enrichmentItems.length,
    expected_enrichment_row_count: SOURCES.enrichment.expectedRows,
    web_achievement_target_row_count: targets.length,
    matched_enrichment_count: enrichmentItems.length - unmatched.length,
    unmatched_enrichment_count: unmatched.length,
    duplicate_target_matches: duplicateTargetMatches,
    duplicate_enrichment_ids: duplicateIds,
    duplicate_title_keys: duplicateTitleKeys,
    match_method_counts: countBy(enrichmentItems.map((item) => item.targetMatchMethod ?? "(null)")),
    match_confidence_counts: countBy(enrichmentItems.map((item) => item.targetMatchConfidence ?? "(null)")),
    review_needed_count: enrichmentItems.filter((item) => item.reviewNeeded).length,
    enrichment_rows_accidentally_included_in_content_items: contentEnrichmentRows.length,
    content_items_row_count_still_4933: contentItems.length === EXPECTED_CONTENT_COUNT,
    optional_field_missing_counts: optionalFieldMissingCounts,
    unmatched_examples: unmatched.slice(0, 10).map((item) => item.achievementTitle ?? item.standaloneAchievementId ?? "(missing title)"),
  };
}

function buildTaxonomy(inputDir: string) {
  const taxonomyPath = resolve(inputDir, SOURCES.taxonomy.fileName);
  const rows = readWorksheetRows(taxonomyPath, "category_authority").rows;
  const categories: TaxonomyCategory[] = rows.map((row, index) => {
    const sourceOneNoteCategory = firstText(row, ["onenote_category"]);
    const canonicalValdkond = firstText(row, ["proposed_canonical_valdkond"]);
    const aliases = [sourceOneNoteCategory].filter(
      (value): value is string => !!value && value !== canonicalValdkond,
    );
    return {
      sourceOneNoteCategory,
      canonicalValdkond,
      slug: firstText(row, ["proposed_slug"]) ?? slugify(canonicalValdkond),
      scopeDescription: firstText(row, ["scope_description"]),
      includeExamples: splitMulti(firstText(row, ["include_examples"])),
      excludeExamples: splitMulti(firstText(row, ["exclude_examples"])),
      aliases,
      status: firstText(row, ["status"]),
      confidence: firstText(row, ["confidence"]),
      notes: firstText(row, ["notes"]),
      sourceRow: { file: SOURCES.taxonomy.fileName, sheet: "category_authority", rowNumber: index + 2 },
    };
  });

  return {
    schemaVersion: "taxonomy-v1",
    sourceFile: SOURCES.taxonomy.fileName,
    sourceSheet: "category_authority",
    categoryCount: categories.length,
    categories,
    notes: [
      "OneNote categories are taxonomy authority input only.",
      "This file does not create or modify content rows.",
    ],
  };
}

function buildTaxonomyRules(inputDir: string) {
  const taxonomyPath = resolve(inputDir, SOURCES.taxonomy.fileName);
  const topicRows = readWorksheetRows(taxonomyPath, "topic_terms").rows;
  const sectorRows = readWorksheetRows(taxonomyPath, "sector_relevance_rules").rows;
  const crawlerRows = readWorksheetRows(taxonomyPath, "crawler_classification_rules").rows;

  const topicTerms = topicRows.map((row, index) => ({
    canonicalValdkond: firstText(row, ["canonical_valdkond"]),
    strongIncludeTerms: splitMulti(firstText(row, ["strong_include_terms"])),
    weakIncludeTerms: splitMulti(firstText(row, ["weak_include_terms"])),
    anchorTerms: splitMulti(firstText(row, ["anchor_terms"])),
    excludeTerms: splitMulti(firstText(row, ["exclude_terms"])),
    exampleOneNotePages: splitMulti(firstText(row, ["example_onenote_pages"])),
    exampleShouldInclude: firstText(row, ["example_should_include"]),
    exampleShouldExclude: firstText(row, ["example_should_exclude"]),
    notes: firstText(row, ["notes"]),
    sourceRow: { file: SOURCES.taxonomy.fileName, sheet: "topic_terms", rowNumber: index + 2 },
  }));

  const sectorRelevanceRules = sectorRows.map((row, index) => ({
    tegevusala: firstText(row, ["tegevusala"]),
    slug: firstText(row, ["tegevusala_slug_if_known"]) ?? slugify(firstText(row, ["tegevusala"])),
    allowedValdkonnad: splitMulti(firstText(row, ["allowed_valdkonnad"])),
    allowedTerms: splitMulti(firstText(row, ["allowed_terms"])),
    requiredAnchorTerms: splitMulti(firstText(row, ["required_anchor_terms"])),
    excludeTerms: splitMulti(firstText(row, ["exclude_terms"])),
    fallbackAllowed: parseBool(firstText(row, ["fallback_allowed"])),
    notes: firstText(row, ["notes"]),
    sourceRow: { file: SOURCES.taxonomy.fileName, sheet: "sector_relevance_rules", rowNumber: index + 2 },
  }));

  const crawlerClassificationRules = crawlerRows.map((row, index) => ({
    sourceSection: firstText(row, ["source_section"]),
    urlPattern: splitMulti(firstText(row, ["url_pattern"])),
    titleTerms: splitMulti(firstText(row, ["title_terms"])),
    bodyTerms: splitMulti(firstText(row, ["body_terms"])),
    canonicalValdkond: firstText(row, ["canonical_valdkond"]),
    defaultTegevusala: firstText(row, ["default_tegevusala"]),
    defaultPublicStatus: firstText(row, ["default_public_status"]),
    needsReviewRule: firstText(row, ["needs_review_rule"]),
    excludeRule: splitMulti(firstText(row, ["exclude_rule"])),
    notes: firstText(row, ["notes"]),
    sourceRow: { file: SOURCES.taxonomy.fileName, sheet: "crawler_classification_rules", rowNumber: index + 2 },
  }));

  return {
    schemaVersion: "taxonomy-rules-v1",
    sourceFile: SOURCES.taxonomy.fileName,
    topicTerms,
    sectorRelevanceRules,
    crawlerClassificationRules,
    boundaryRules: {
      ecommerceNotItByDefault:
        "e-commerce, e-pood and taganemisnupp must not map to IT/Digiteemad by default unless technology infrastructure is central.",
      digiteemadIncludes:
        "Digiteemad includes AI, data, data protection, cybersecurity, e-residency, digital services, electronic communications, digital identity and information society.",
      keskkondIncludes:
        "Keskkond includes waste, packaging, environmental claims, environmental impact, climate, industrial emissions, circular economy and environmental fees.",
      agricultureRequiresAnchors:
        "Agriculture, forestry and fishing must not receive broad environment, planning, permit, land or food rows without agriculture, forestry or fishing anchors.",
      aiBoundary:
        "AI matching must use word-boundary/acronym logic or strong Estonian terms such as tehisintellekt and tehisaru, not naive substring matching.",
    },
    leakagePreventionRules: [
      "Keep e-commerce, e-pood, taganemisnupp and consumer-protection terms out of Digiteemad unless a digital-infrastructure anchor is present.",
      "Keep packaging, waste, labelling, environmental claims and green-claims rows out of Digiteemad unless a digital-infrastructure anchor is present.",
      "Keep broad environment, permit, planning, land and food rows out of agriculture/forestry/fishing unless agriculture, forestry or fishing anchors are present.",
      "Treat AI as an acronym/word or match strong Estonian terms; never match arbitrary substrings inside unrelated words.",
    ],
    rowCounts: {
      topicTerms: topicTerms.length,
      sectorRelevanceRules: sectorRelevanceRules.length,
      crawlerClassificationRules: crawlerClassificationRules.length,
    },
  };
}

function buildReviewCandidates(inputDir: string): ReviewCandidate[] {
  const taxonomyPath = resolve(inputDir, SOURCES.taxonomy.fileName);
  const rows = readWorksheetRows(taxonomyPath, "reclassification_candidates").rows;
  return rows.map((row, index) => ({
    contentId: firstText(row, ["content_id"]),
    title: firstText(row, ["title"]),
    url: firstText(row, ["url"]),
    currentValdkond: splitMulti(firstText(row, ["current_valdkond"])),
    suggestedValdkond: splitMulti(firstText(row, ["suggested_valdkond"])),
    currentTegevusala: splitMulti(firstText(row, ["current_tegevusala"])),
    suggestedTegevusala: splitMulti(firstText(row, ["suggested_tegevusala"])),
    currentTapsustus: splitMulti(firstText(row, ["current_tapsustus"])),
    suggestedTapsustus: splitMulti(firstText(row, ["suggested_tapsustus"])),
    ruleSource: firstText(row, ["rule_source"]),
    evidence: firstText(row, ["evidence"]),
    confidence: firstText(row, ["confidence"]),
    recommendedAction: firstText(row, ["recommended_action"]),
    reviewNote: firstText(row, ["review_note"]),
    applied: false,
    sourceRow: { file: SOURCES.taxonomy.fileName, sheet: "reclassification_candidates", rowNumber: index + 2 },
  }));
}

function buildTagDictionary(contentItems: ContentItem[], taxonomy: ReturnType<typeof buildTaxonomy>) {
  const knownValdkonnad = new Map<string, TaxonomyCategory>();
  for (const category of taxonomy.categories) {
    if (category.canonicalValdkond) knownValdkonnad.set(category.canonicalValdkond, category);
    for (const alias of category.aliases) knownValdkonnad.set(alias, category);
  }

  function collect(kind: "valdkonnad" | "tegevusalad" | "tapsustused") {
    const byValue = new Map<string, { value: string; sourceCount: number; sourceDatasets: Set<string> }>();
    for (const item of contentItems) {
      for (const value of item[kind]) {
        const existing = byValue.get(value) ?? { value, sourceCount: 0, sourceDatasets: new Set<string>() };
        existing.sourceCount++;
        existing.sourceDatasets.add(item.sourceDataset);
        byValue.set(value, existing);
      }
    }

    return [...byValue.values()]
      .sort((a, b) => a.value.localeCompare(b.value))
      .map((entry) => {
        const taxonomyCategory = kind === "valdkonnad" ? knownValdkonnad.get(entry.value) : undefined;
        return {
          value: entry.value,
          slug: slugify(entry.value),
          displayLabel: entry.value,
          sourceCount: entry.sourceCount,
          sourceDatasets: [...entry.sourceDatasets].sort(),
          aliases: taxonomyCategory?.aliases ?? [],
          canonical: kind === "valdkonnad" && taxonomyCategory?.canonicalValdkond === entry.value,
          known: kind !== "valdkonnad" || !!taxonomyCategory,
          unknown: kind === "valdkonnad" && !taxonomyCategory,
          notes: taxonomyCategory?.notes ?? null,
        };
      });
  }

  return {
    schemaVersion: "tag-dictionary-v1",
    generatedFrom: ["content_items.jsonl", "taxonomy.json"],
    valdkonnad: collect("valdkonnad"),
    tegevusalad: collect("tegevusalad"),
    tapsustused: collect("tapsustused"),
    aliases: taxonomy.categories.flatMap((category) =>
      category.aliases.map((alias) => ({
        alias,
        canonicalValue: category.canonicalValdkond,
        kind: "valdkonnad",
      })),
    ),
    deprecatedValues: [],
    unknowns: {
      valdkonnad: collect("valdkonnad").filter((entry) => entry.unknown).map((entry) => entry.value),
      tegevusalad: [],
      tapsustused: [],
    },
    counts: {
      valdkonnad: collect("valdkonnad").length,
      tegevusalad: collect("tegevusalad").length,
      tapsustused: collect("tapsustused").length,
    },
    notes: [
      "Content tag labels are preserved exactly.",
      "This dictionary does not rename, translate or reclassify content rows.",
    ],
  };
}

function countTaxonomySheets(inputDir: string, taxonomyStatus: SourceFileStatus, issues: BundleIssues) {
  const counts: Record<string, number | null> = {};
  const sheetStatus: Record<string, { exists: boolean; row_count: number | null }> = {};

  if (!taxonomyStatus.exists) {
    for (const sheet of TAXONOMY_SHEETS) {
      counts[sheet] = null;
      sheetStatus[sheet] = { exists: false, row_count: null };
    }
    return { counts, sheetStatus };
  }

  const taxonomyPath = resolve(inputDir, SOURCES.taxonomy.fileName);
  for (const sheet of TAXONOMY_SHEETS) {
    const exists = taxonomyStatus.sheet_names.includes(sheet);
    if (!exists) {
      counts[sheet] = null;
      sheetStatus[sheet] = { exists: false, row_count: null };
      issues.warn(`Optional taxonomy sheet is missing: ${sheet}`);
      continue;
    }

    const rowCount = readWorksheetRows(taxonomyPath, sheet).rows.length;
    counts[sheet] = rowCount;
    sheetStatus[sheet] = { exists: true, row_count: rowCount };
  }

  return { counts, sheetStatus };
}

function findWebAchievements(inputDir: string, issues: BundleIssues) {
  const webPath = resolve(inputDir, SOURCES.web.fileName);
  const { rows } = readWorksheetRows(webPath, SOURCES.web.sourceSheet);
  const achievementRows = rows.filter((row) => {
    const layer = (row["source_layer_merge"] || row["source_layer"] || "").trim();
    const type = (row["source_type_merge"] || row["source_type"] || "").trim();
    return layer === "koda_achievement" || type === "toovoit";
  });

  const titleKeys = new Set<string>();
  for (const row of achievementRows) {
    const title = row["source_title"] || row["cleaned_display_title"] || "";
    const key = normalizeTitle(title);
    if (key) titleKeys.add(key);
  }

  if (achievementRows.length === 0) {
    issues.error("Web source contains zero detectable achievement rows.");
  }

  return { achievementRows, titleKeys };
}

function checkEnrichment(inputDir: string, issues: BundleIssues) {
  const enrichmentPath = resolve(inputDir, SOURCES.enrichment.fileName);
  const { rows: enrichmentRows } = readWorksheetRows(enrichmentPath, SOURCES.enrichment.sourceSheet);
  const { achievementRows, titleKeys } = findWebAchievements(inputDir, issues);

  let matchedByTitle = 0;
  const unmatchedTitles: string[] = [];

  for (const row of enrichmentRows) {
    const title = row["achievement_title"] || "";
    const key = normalizeTitle(title);
    if (key && titleKeys.has(key)) matchedByTitle++;
    else unmatchedTitles.push(title || row["achievement_id"] || "(missing title)");
  }

  if (enrichmentRows.length !== SOURCES.enrichment.expectedRows) {
    issues.warn(`Achievement enrichment row count is ${enrichmentRows.length}, expected ${SOURCES.enrichment.expectedRows}.`);
  }
  if (achievementRows.length !== 76) {
    issues.warn(`Web achievement row count is ${achievementRows.length}, expected 76.`);
  }
  if (matchedByTitle !== enrichmentRows.length) {
    issues.warn(`Achievement enrichment title matching is incomplete: ${matchedByTitle}/${enrichmentRows.length}.`);
  }

  return {
    expected_enrichment_rows: SOURCES.enrichment.expectedRows,
    actual_enrichment_rows: enrichmentRows.length,
    expected_web_achievement_rows: 76,
    actual_web_achievement_rows: achievementRows.length,
    title_match_attempted: true,
    title_match_count: matchedByTitle,
    unmatched_count: unmatchedTitles.length,
    unmatched_examples: unmatchedTitles.slice(0, 10),
    enrichment_counted_as_content: false,
  };
}

function buildRequiredSheetStatus(sourceStatuses: SourceFileStatus[], issues: BundleIssues) {
  const status: Record<string, { file_name: string; sheet_name: string | null; exists: boolean }> = {};

  for (const source of sourceStatuses) {
    const exists = !!source.source_sheet && source.sheet_names.includes(source.source_sheet);
    status[source.logical_name] = {
      file_name: source.file_name,
      sheet_name: source.source_sheet,
      exists,
    };
    if (source.exists && source.source_sheet && !exists) {
      issues.error(`Missing required sheet "${source.source_sheet}" in ${source.file_name}.`);
    }
  }

  return status;
}

function checkSourceStatuses(sourceStatuses: SourceFileStatus[], issues: BundleIssues) {
  for (const source of sourceStatuses) {
    if (!source.exists) {
      issues.error(`Missing required source file: ${source.file_name}`);
      continue;
    }

    if (source.row_count === 0) {
      issues.error(`Required source sheet has zero rows: ${source.file_name} / ${source.source_sheet}`);
    }

    const expected = Object.values(SOURCES).find((definition) => definition.logicalName === source.logical_name)?.expectedRows;
    if (expected !== null && expected !== undefined && source.row_count !== null && source.row_count !== expected) {
      issues.warn(`${source.logical_name} row count is ${source.row_count}, expected ${expected}.`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = resolveInputDir(args.inputDir);
  const outputDir = resolveOutputDir(args.outDir);
  const issues = new BundleIssues();
  const timestamp = new Date().toISOString();
  const commit = gitCommit(issues);

  const sourceStatuses = Object.values(SOURCES).map((source) =>
    getSourceFileStatus(inputDir, source.logicalName, source.fileName, source.sourceSheet),
  );

  checkSourceStatuses(sourceStatuses, issues);
  const requiredSheetStatus = buildRequiredSheetStatus(sourceStatuses, issues);

  const rowCounts = {
    web_index_content_rows: sourceStatuses.find((s) => s.logical_name === "web_index")?.row_count ?? null,
    opinion_support_rows: sourceStatuses.find((s) => s.logical_name === "opinions")?.row_count ?? null,
    annual_context_rows: sourceStatuses.find((s) => s.logical_name === "annual_reports")?.row_count ?? null,
    achievement_enrichment_rows: sourceStatuses.find((s) => s.logical_name === "achievement_enrichment")?.row_count ?? null,
    expected_base_content_rows_before_live_crawl: EXPECTED_CONTENT_COUNT,
    taxonomy_category_rows: null as number | null,
    taxonomy_topic_rule_rows: null as number | null,
    sector_relevance_rule_rows: null as number | null,
    crawler_classification_rule_rows: null as number | null,
    reclassification_candidates: null as number | null,
  };

  const actualContentCount =
    (rowCounts.web_index_content_rows ?? 0) +
    (rowCounts.opinion_support_rows ?? 0) +
    (rowCounts.annual_context_rows ?? 0);

  if (actualContentCount !== EXPECTED_CONTENT_COUNT) {
    issues.error(`Expected base content count ${EXPECTED_CONTENT_COUNT}, got ${actualContentCount}.`);
  }

  if (actualContentCount + (rowCounts.achievement_enrichment_rows ?? 0) === EXPECTED_CONTENT_COUNT) {
    issues.error("Achievement enrichment rows appear to be counted as base content.");
  }

  let enrichmentChecks: JsonValue = {
    title_match_attempted: false,
    reason: "Required source files or sheets are missing.",
  };
  let contentItems: ContentItem[] = [];
  let contentItemChecks: JsonValue = {
    content_items_row_count: 0,
    reason: "Required source files or sheets are missing.",
  };
  let achievementEnrichmentItems: AchievementEnrichment[] = [];
  let achievementEnrichmentChecks: JsonValue = {
    enrichment_row_count: 0,
    reason: "Required source files or sheets are missing.",
  };
  let taxonomyOutput: ReturnType<typeof buildTaxonomy> | null = null;
  let taxonomyRulesOutput: ReturnType<typeof buildTaxonomyRules> | null = null;
  let reviewCandidates: ReviewCandidate[] = [];
  let tagDictionary: ReturnType<typeof buildTagDictionary> | null = null;

  if (issues.errors.length === 0) {
    enrichmentChecks = checkEnrichment(inputDir, issues) as unknown as JsonValue;
    const built = buildContentItems(inputDir);
    contentItems = built.items;
    contentItemChecks = validateContentItems(contentItems, built.dateIssues, issues) as unknown as JsonValue;
    const enrichmentBuilt = buildAchievementEnrichment(inputDir, contentItems);
    achievementEnrichmentItems = enrichmentBuilt.items;
    achievementEnrichmentChecks = validateAchievementEnrichment(
      achievementEnrichmentItems,
      enrichmentBuilt.targets,
      contentItems,
      issues,
    ) as unknown as JsonValue;
    taxonomyOutput = buildTaxonomy(inputDir);
    taxonomyRulesOutput = buildTaxonomyRules(inputDir);
    reviewCandidates = buildReviewCandidates(inputDir);
    tagDictionary = buildTagDictionary(contentItems, taxonomyOutput);

    if (taxonomyOutput.categories.length !== 20) {
      issues.warn(`taxonomy.json category count is ${taxonomyOutput.categories.length}, expected 20.`);
    }
    if (reviewCandidates.length !== 1159) {
      issues.warn(`review_candidates.jsonl row count is ${reviewCandidates.length}, expected 1159.`);
    }
  }

  const taxonomyStatus = sourceStatuses.find((s) => s.logical_name === "taxonomy_unification");
  const taxonomy = taxonomyStatus
    ? countTaxonomySheets(inputDir, taxonomyStatus, issues)
    : { counts: {}, sheetStatus: {} };

  rowCounts.taxonomy_category_rows = taxonomy.counts.category_authority ?? null;
  rowCounts.taxonomy_topic_rule_rows = taxonomy.counts.topic_terms ?? null;
  rowCounts.sector_relevance_rule_rows = taxonomy.counts.sector_relevance_rules ?? null;
  rowCounts.crawler_classification_rule_rows = taxonomy.counts.crawler_classification_rules ?? null;
  rowCounts.reclassification_candidates = taxonomy.counts.reclassification_candidates ?? null;

  const rowCountChecks = {
    web_index_content_rows: {
      expected: SOURCES.web.expectedRows,
      actual: rowCounts.web_index_content_rows,
      passed: rowCounts.web_index_content_rows === SOURCES.web.expectedRows,
    },
    opinion_support_rows: {
      expected: SOURCES.opinions.expectedRows,
      actual: rowCounts.opinion_support_rows,
      passed: rowCounts.opinion_support_rows === SOURCES.opinions.expectedRows,
    },
    annual_context_rows: {
      expected: SOURCES.annual.expectedRows,
      actual: rowCounts.annual_context_rows,
      passed: rowCounts.annual_context_rows === SOURCES.annual.expectedRows,
    },
    achievement_enrichment_rows: {
      expected: SOURCES.enrichment.expectedRows,
      actual: rowCounts.achievement_enrichment_rows,
      passed: rowCounts.achievement_enrichment_rows === SOURCES.enrichment.expectedRows,
      counted_as_content: false,
    },
  };

  const missingRequiredFiles = sourceStatuses.filter((source) => !source.exists).map((source) => source.file_name);
  const missingRequiredSheets = Object.values(requiredSheetStatus)
    .filter((sheet) => !sheet.exists)
    .map((sheet) => `${sheet.file_name} / ${sheet.sheet_name}`);

  let generatedFiles: Array<{ file_name: string; path: string; row_count: number | null; sha256: string | null }> = [];

  try {
    ensureOutputDir(outputDir);
    const contentItemsPath = resolve(outputDir, "content_items.jsonl");
    const achievementEnrichmentPath = resolve(outputDir, "achievement_enrichment.jsonl");
    const taxonomyPath = resolve(outputDir, "taxonomy.json");
    const taxonomyRulesPath = resolve(outputDir, "taxonomy_rules.json");
    const reviewCandidatesPath = resolve(outputDir, "review_candidates.jsonl");
    const tagDictionaryPath = resolve(outputDir, "tag_dictionary.json");
    writeJsonLines(contentItemsPath, contentItems as unknown as JsonValue[]);
    writeJsonLines(achievementEnrichmentPath, achievementEnrichmentItems as unknown as JsonValue[]);
    writePrettyJson(taxonomyPath, (taxonomyOutput ?? {}) as unknown as JsonValue);
    writePrettyJson(taxonomyRulesPath, (taxonomyRulesOutput ?? {}) as unknown as JsonValue);
    writeJsonLines(reviewCandidatesPath, reviewCandidates as unknown as JsonValue[]);
    writePrettyJson(tagDictionaryPath, (tagDictionary ?? {}) as unknown as JsonValue);
    generatedFiles = [
      {
        file_name: "content_items.jsonl",
        path: contentItemsPath,
        row_count: contentItems.length,
        sha256: existsSync(contentItemsPath) ? sha256File(contentItemsPath) : null,
      },
      {
        file_name: "achievement_enrichment.jsonl",
        path: achievementEnrichmentPath,
        row_count: achievementEnrichmentItems.length,
        sha256: existsSync(achievementEnrichmentPath) ? sha256File(achievementEnrichmentPath) : null,
      },
      {
        file_name: "taxonomy.json",
        path: taxonomyPath,
        row_count: taxonomyOutput?.categories.length ?? null,
        sha256: existsSync(taxonomyPath) ? sha256File(taxonomyPath) : null,
      },
      {
        file_name: "taxonomy_rules.json",
        path: taxonomyRulesPath,
        row_count: taxonomyRulesOutput
          ? taxonomyRulesOutput.topicTerms.length +
            taxonomyRulesOutput.sectorRelevanceRules.length +
            taxonomyRulesOutput.crawlerClassificationRules.length
          : null,
        sha256: existsSync(taxonomyRulesPath) ? sha256File(taxonomyRulesPath) : null,
      },
      {
        file_name: "review_candidates.jsonl",
        path: reviewCandidatesPath,
        row_count: reviewCandidates.length,
        sha256: existsSync(reviewCandidatesPath) ? sha256File(reviewCandidatesPath) : null,
      },
      {
        file_name: "tag_dictionary.json",
        path: tagDictionaryPath,
        row_count: tagDictionary
          ? tagDictionary.counts.valdkonnad + tagDictionary.counts.tegevusalad + tagDictionary.counts.tapsustused
          : null,
        sha256: existsSync(tagDictionaryPath) ? sha256File(tagDictionaryPath) : null,
      },
    ];
  } catch (error) {
    issues.error(`Bundle JSONL output could not be written: ${(error as Error).message}`);
  }

  const status = validationStatus(issues);

  const manifest = {
    bundle_version: BUNDLE_VERSION,
    schema_version: SCHEMA_VERSION,
    generated_timestamp: timestamp,
    generated_by_commit: commit,
    input_dir: inputDir,
    output_dir: outputDir,
    source_files: sourceStatuses.map(({ path: _path, ...source }) => source),
    generated_files: generatedFiles.map(({ path: _path, ...file }) => file),
    row_counts: {
      ...rowCounts,
      content_items_rows: contentItems.length,
      achievement_enrichment_jsonl_rows: achievementEnrichmentItems.length,
      taxonomy_json_categories: taxonomyOutput?.categories.length ?? null,
      taxonomy_rules_total_rows: taxonomyRulesOutput
        ? taxonomyRulesOutput.topicTerms.length +
          taxonomyRulesOutput.sectorRelevanceRules.length +
          taxonomyRulesOutput.crawlerClassificationRules.length
        : null,
      review_candidates_jsonl_rows: reviewCandidates.length,
      tag_dictionary_valdkonnad: tagDictionary?.counts.valdkonnad ?? null,
      tag_dictionary_tegevusalad: tagDictionary?.counts.tegevusalad ?? null,
      tag_dictionary_tapsustused: tagDictionary?.counts.tapsustused ?? null,
    },
    enrichment_validation_summary: achievementEnrichmentChecks,
    expected_content_count: EXPECTED_CONTENT_COUNT,
    actual_base_content_count_before_live_crawl: actualContentCount,
    validation_status: status,
    warning_count: issues.warnings.length,
    error_count: issues.errors.length,
    warnings: issues.warnings,
    errors: issues.errors,
    notes: [
      "This bundle milestone generates manifest.json, qa_report.json, and content_items.jsonl.",
      "This bundle milestone also generates achievement_enrichment.jsonl as a separate enrichment-only output.",
      "This bundle also generates taxonomy.json, taxonomy_rules.json, review_candidates.jsonl and tag_dictionary.json.",
      "content_items.jsonl contains only web, opinion, and annual rows.",
      "achievement_enrichment rows are enrichment-only and are not counted as content.",
      "review_candidates.jsonl is review-only; suggested reclassifications are not applied.",
      "This is a local bundle artifact, not a DB import.",
      "The legacy Excel import path is unchanged.",
    ],
  };

  const qaReport = {
    generated_timestamp: timestamp,
    source_file_status: sourceStatuses.map(({ path: _path, ...source }) => source),
    generated_files: generatedFiles.map(({ path: _path, ...file }) => file),
    required_sheet_status: requiredSheetStatus,
    row_count_checks: rowCountChecks,
    expected_vs_actual_content_count: {
      expected: EXPECTED_CONTENT_COUNT,
      actual: actualContentCount,
      passed: actualContentCount === EXPECTED_CONTENT_COUNT,
      achievement_enrichment_rows_counted_as_content: false,
    },
    enrichment_checks: enrichmentChecks,
    achievement_enrichment_checks: achievementEnrichmentChecks,
    content_item_checks: contentItemChecks,
    taxonomy_output_checks: {
      taxonomy_json_categories: taxonomyOutput?.categories.length ?? 0,
      taxonomy_rules_topic_terms: taxonomyRulesOutput?.topicTerms.length ?? 0,
      taxonomy_rules_sector_rules: taxonomyRulesOutput?.sectorRelevanceRules.length ?? 0,
      taxonomy_rules_crawler_rules: taxonomyRulesOutput?.crawlerClassificationRules.length ?? 0,
      review_candidates_rows: reviewCandidates.length,
      tag_dictionary_counts: tagDictionary?.counts ?? null,
      reclassification_candidates_applied: false,
    },
    taxonomy_sheet_counts: taxonomy.counts,
    taxonomy_sheet_status: taxonomy.sheetStatus,
    missing_required_files: missingRequiredFiles,
    missing_required_sheets: missingRequiredSheets,
    warnings: issues.warnings,
    errors: issues.errors,
    next_recommended_step:
      "Run the read-only bundle validator, then build a later PostgreSQL/Prisma staging import plan without touching production.",
  };

  try {
    writePrettyJson(resolve(outputDir, "manifest.json"), manifest as unknown as JsonValue);
    writePrettyJson(resolve(outputDir, "qa_report.json"), qaReport as unknown as JsonValue);
  } catch (error) {
    issues.error(`Manifest or QA report could not be written: ${(error as Error).message}`);
    throw error;
  }

  console.log(`[data:bundle] Wrote ${resolve(outputDir, "manifest.json")}`);
  console.log(`[data:bundle] Wrote ${resolve(outputDir, "qa_report.json")}`);
  console.log(`[data:bundle] Wrote ${resolve(outputDir, "content_items.jsonl")}`);
  console.log(`[data:bundle] Wrote ${resolve(outputDir, "achievement_enrichment.jsonl")}`);
  console.log(`[data:bundle] Wrote ${resolve(outputDir, "taxonomy.json")}`);
  console.log(`[data:bundle] Wrote ${resolve(outputDir, "taxonomy_rules.json")}`);
  console.log(`[data:bundle] Wrote ${resolve(outputDir, "review_candidates.jsonl")}`);
  console.log(`[data:bundle] Wrote ${resolve(outputDir, "tag_dictionary.json")}`);
  console.log(`[data:bundle] Validation status: ${status}`);
  console.log(`[data:bundle] Base content rows: ${actualContentCount}/${EXPECTED_CONTENT_COUNT}`);
  console.log(`[data:bundle] content_items rows: ${contentItems.length}/${EXPECTED_CONTENT_COUNT}`);
  console.log(`[data:bundle] achievement_enrichment rows: ${achievementEnrichmentItems.length}/${SOURCES.enrichment.expectedRows}`);
  console.log(`[data:bundle] review_candidates rows: ${reviewCandidates.length}/1159`);

  if (issues.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of issues.warnings) console.log(`  - ${warning}`);
  }
  if (issues.errors.length > 0) {
    console.error("\nErrors:");
    for (const error of issues.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

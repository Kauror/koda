/**
 * Shared logic for the deterministic merge-ready Excel import pipeline.
 *
 * This module is database-free on purpose: validate-merge-ready.ts and
 * test-merge-ready.ts can read, stage and validate the workbooks without a
 * Postgres connection. import-merge-ready.ts adds the Prisma upsert layer.
 *
 * The four merge-ready workbooks are the v1 source of truth:
 *   - koda_web_index_v1_merge_ready.xlsx        (web_merge_ready)        3937 rows
 *   - koda_opinions_v1_merge_ready.xlsx         (opinions_merge_ready)    759 rows
 *   - koda_annual_reports_v1_merge_ready.xlsx   (annual_reports_merge_ready) 237 rows
 *   - koda_toovoidud_enrichment_v1_merge_ready.xlsx (enrichment only)      76 rows
 *
 * Web + opinions + annual = 4933 content rows BEFORE public exclusions.
 * The töövõidud file is enrichment only and creates 0 content rows.
 */
import { resolve } from "path";
import { existsSync } from "fs";
import * as XLSX from "xlsx";
import { contentHash, normalizeTitle } from "../../src/lib/hash";

// ---------------------------------------------------------------------------
// File + sheet definitions
// ---------------------------------------------------------------------------

export const IMPORT_DIR = resolve(process.cwd(), "data", "import");

export type DatasetKey = "web" | "opinions" | "annual_reports";

export const FILES = {
  web: "koda_web_index_v1_merge_ready.xlsx",
  opinions: "koda_opinions_v1_merge_ready.xlsx",
  annual_reports: "koda_annual_reports_v1_merge_ready.xlsx",
  enrichment: "koda_toovoidud_enrichment_v1_merge_ready.xlsx",
} as const;

export const SHEETS = {
  web: "web_merge_ready",
  opinions: "opinions_merge_ready",
  annual_reports: "annual_reports_merge_ready",
  enrichment: "toovoidud_enrichment_ready",
  enrichmentJoin: "toovoidud_join_keys",
} as const;

export const EXPECTED_ROWS = {
  web: 3937,
  opinions: 759,
  annual_reports: 237,
  enrichment: 76,
  totalContentBeforeExclusions: 4933,
  canonicalAchievements: 76,
} as const;

export function filePath(name: string): string {
  return resolve(IMPORT_DIR, name);
}

// ---------------------------------------------------------------------------
// Allowed enum values (from the *_rules_notes / *_field_mapping sheets).
// Unknown values are reported as errors rather than silently accepted.
// ---------------------------------------------------------------------------

export const ALLOWED = {
  importStatus: new Set([
    "import_public_candidate",
    "import_after_review",
    "import_hidden",
    "do_not_import_yet",
  ]),
  publicDisplay: new Set([
    "main_result_candidate",
    "topic_history",
    "supporting_source",
    "annual_context",
    "service_context",
    "hide_or_review",
    "admin_only",
  ]),
  mergeReadiness: new Set([
    // web
    "ready_for_merge_public",
    "merge_ready_hidden_or_supporting",
    "merge_ready_review_status_retained",
    "ready_for_merge_after_light_review",
    "do_not_merge_yet",
    // opinions
    "merge_ready_hidden",
    "merge_ready_after_review",
    // annual
    "merge_ready_public_candidate",
    "merge_ready_context",
    "merge_ready_supporting",
    // shared review/escape values
    "needs_manual_topic_review",
    "needs_manual_schema_review",
  ]),
  extractionQuality: new Set(["good", "weak", "failed", "partial"]),
} as const;

// Visibility-related value groups used by the gating logic.
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

// ---------------------------------------------------------------------------
// SourceType mapping (compatibility with the existing SourceType enum so the
// current ranking, which special-cases `achievement` and `service`, keeps
// working). The authoritative routing fields are sourceLayer/sourceTypeDetail.
// ---------------------------------------------------------------------------

export type CompatSourceType =
  | "opinion"
  | "archive_opinion"
  | "news"
  | "currently_handled"
  | "service"
  | "event"
  | "achievement"
  | "unknown";

function mapSourceType(dataset: DatasetKey, layer: string, type: string): CompatSourceType {
  if (type === "toovoit" || layer === "koda_achievement") return "achievement";
  if (type === "meie_uudis") return "news";
  if (type === "meie_arvamus_article") return "opinion";
  if (type === "tooruhmad" || layer === "koda_workgroup_context") return "currently_handled";
  if (layer === "opinion_file" || dataset === "opinions") return "opinion";
  if (type.includes("service")) return "service";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Cell + value helpers
// ---------------------------------------------------------------------------

/** Normalise any cell value (SheetJS returns strings/numbers/booleans/dates). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

export function orNull(s: string): string | null {
  return s === "" ? null : s;
}

export function parseBool(s: string): boolean {
  return ["true", "1", "yes", "jah"].includes(s.trim().toLowerCase());
}

export function parseYear(s: string): number | null {
  const m = s.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

export function parseDate(s: string): Date | null {
  if (!s) return null;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const dotted = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) return new Date(Date.UTC(+dotted[3], +dotted[2] - 1, +dotted[1]));
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) return new Date(Date.UTC(+yearOnly[1], 0, 1));
  return null;
}

/** Split a semicolon/pipe separated multi-value taxonomy cell into trimmed parts. */
export function splitMulti(s: string): string[] {
  return s
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Deterministic title key for the achievement enrichment join. Reuses the
 * existing normalizeTitle (lowercase, punctuation-stripped, whitespace
 * collapsed) – verified to match all 76 enrichment rows to web rows.
 */
export function titleKey(title: string): string {
  return normalizeTitle(title);
}

// ---------------------------------------------------------------------------
// Workbook reading
// ---------------------------------------------------------------------------

export type Row = Record<string, string>;

/** Read a worksheet into header-keyed string rows. Throws on missing file/sheet. */
export async function readSheet(fileName: string, sheetName: string): Promise<{ headers: string[]; rows: Row[] }> {
  const path = filePath(fileName);
  if (!existsSync(path)) {
    throw new Error(`Missing input file: ${path}`);
  }
  // raw:false formats values as the workbook displays them (dates as ISO-ish
  // strings); SheetJS tolerates the openpyxl/pandas markup that ExcelJS rejects.
  const wb = XLSX.readFile(path, { cellDates: true, raw: false });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Missing sheet "${sheetName}" in ${fileName}. Available: ${wb.SheetNames.join(", ")}`);
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false });
  if (matrix.length === 0) return { headers: [], rows: [] };
  const headers = (matrix[0] as unknown[]).map((h) => cellText(h));
  const rows: Row[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const arr = matrix[r] as unknown[];
    const obj: Row = {};
    let hasAny = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const val = cellText(arr[c]);
      obj[key] = val;
      if (val) hasAny = true;
    }
    if (hasAny) rows.push(obj);
  }
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Staged content shape (dataset-agnostic, ready for upsert)
// ---------------------------------------------------------------------------

export type StagedContent = {
  externalId: string;
  sourceDataset: DatasetKey;
  sourceLayer: string | null;
  sourceTypeDetail: string | null;
  sourceType: CompatSourceType;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  title: string;
  displayTitle: string | null;
  date: Date | null;
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
  publicPriority: string | null;
  primaryCategory: string | null;
  secondaryCategories: string | null;
  topicGroupCandidate: string | null;
  canonicalContentId: string | null;
  duplicateStatus: string | null;
  isEvergreen: boolean;
  contentHash: string;
  valdkonnad: string[];
  tegevusalad: string[];
  tapsustused: string[];
  language: string;
  // Derived
  isAchievement: boolean;
  titleKey: string;
  isPublic: boolean;
  isHidden: boolean;
};

// ---------------------------------------------------------------------------
// Per-dataset row -> StagedContent mapping
// ---------------------------------------------------------------------------

function baseDisplayTitle(title: string, display: string): string {
  return display || title;
}

export function stageWebRow(r: Row): StagedContent {
  // A handful of non-content rows (RSS feed, listing pages) have no title and
  // are do_not_import_yet/admin-only. Fall back to the URL/ID so the row still
  // imports as hidden instead of failing the whole run.
  const title =
    cellText(r["source_title"]) ||
    cellText(r["cleaned_display_title"]) ||
    cellText(r["canonical_url"]) ||
    cellText(r["source_url"]) ||
    cellText(r["content_id"]);
  const display = cellText(r["cleaned_display_title"]);
  const layer = orNull(cellText(r["source_layer_merge"]));
  const type = orNull(cellText(r["source_type_merge"]));
  const body = orNull(cellText(r["body_text_full"]) || cellText(r["source_text_excerpt"]));
  return finalize({
    externalId: cellText(r["content_id"]),
    sourceDataset: "web",
    sourceLayer: layer,
    sourceTypeDetail: type,
    sourceType: mapSourceType("web", layer ?? "", type ?? ""),
    sourceUrl: orNull(cellText(r["source_url"])),
    canonicalUrl: orNull(cellText(r["canonical_url"])),
    title,
    displayTitle: baseDisplayTitle(title, display),
    date: parseDate(cellText(r["date"])),
    year: parseYear(cellText(r["year"]) || cellText(r["date"])),
    reportYear: null,
    sourceFileName: orNull(cellText(r["source_input_file"])),
    sourceSection: orNull(cellText(r["source_section"])),
    sourcePageLocation: null,
    bodyText: body,
    excerpt: orNull(cellText(r["source_text_excerpt"])),
    summary: orNull(cellText(r["short_summary_et"])),
    kodaPosition: orNull(cellText(r["koda_position_or_impact_et"])),
    companyRelevance: orNull(cellText(r["company_relevance_et"])),
    sourceEvidence: orNull(cellText(r["source_evidence_short"])),
    outcomeStatus: orNull(cellText(r["outcome_status"])),
    importStatus: orNull(cellText(r["import_status_merge"])),
    publicDisplayStatus: orNull(cellText(r["public_display_merge"])),
    mergeReadiness: orNull(cellText(r["merge_readiness"])),
    mergeNotes: orNull(cellText(r["merge_notes"])),
    extractionQuality: orNull(cellText(r["extraction_quality"])),
    needsHumanReview: parseBool(cellText(r["needs_human_review_merge"])),
    reviewReason: orNull(cellText(r["review_reason"])),
    publicPriority: orNull(cellText(r["public_priority"])),
    primaryCategory: orNull(cellText(r["primary_category"])),
    secondaryCategories: orNull(cellText(r["secondary_categories"])),
    topicGroupCandidate: orNull(cellText(r["topic_group_candidate"])),
    canonicalContentId: orNull(cellText(r["canonical_content_id"])),
    duplicateStatus: orNull(cellText(r["duplicate_status"])),
    isEvergreen: cellText(r["evergreen_candidate"]).toLowerCase() === "yes",
    valdkonnad: splitMulti(cellText(r["filter_valdkonnad_merge"])),
    tegevusalad: splitMulti(cellText(r["filter_tegevusala_merge"])),
    tapsustused: splitMulti(cellText(r["filter_tapsustus_merge_provisional"])),
    body, // for contentHash
    title2: title,
  });
}

export function stageOpinionRow(r: Row): StagedContent {
  const title =
    cellText(r["cleaned_display_title"]) || cellText(r["title_from_filename"]) || cellText(r["file_name"]) || cellText(r["content_id"]);
  const layer = orNull(cellText(r["source_layer"]));
  const type = orNull(cellText(r["source_type"]));
  return finalize({
    externalId: cellText(r["content_id"]),
    sourceDataset: "opinions",
    sourceLayer: layer,
    sourceTypeDetail: type,
    sourceType: mapSourceType("opinions", layer ?? "", type ?? ""),
    sourceUrl: null,
    canonicalUrl: null,
    title,
    displayTitle: title,
    date: parseDate(cellText(r["date"])),
    year: parseYear(cellText(r["year"]) || cellText(r["date"])),
    reportYear: null,
    sourceFileName: orNull(cellText(r["file_name"])),
    sourceSection: null,
    sourcePageLocation: null,
    bodyText: orNull(cellText(r["short_summary_et"])),
    excerpt: orNull(cellText(r["short_summary_et"])),
    summary: orNull(cellText(r["short_summary_et"])),
    kodaPosition: orNull(cellText(r["koda_position_or_impact_et"])),
    companyRelevance: orNull(cellText(r["company_relevance_et"])),
    sourceEvidence: orNull(cellText(r["source_evidence_short"])),
    outcomeStatus: orNull(cellText(r["outcome_status"])),
    importStatus: orNull(cellText(r["import_status_merge"])),
    publicDisplayStatus: orNull(cellText(r["public_display_merge"])),
    mergeReadiness: orNull(cellText(r["merge_readiness"])),
    mergeNotes: orNull(cellText(r["merge_notes"])),
    extractionQuality: orNull(cellText(r["text_extraction_quality"])),
    needsHumanReview: parseBool(cellText(r["needs_human_review_merge"])),
    reviewReason: orNull(cellText(r["corrected_review_reason"]) || cellText(r["review_reason"])),
    publicPriority: orNull(cellText(r["public_priority"])),
    primaryCategory: orNull(cellText(r["primary_category_merge"]) || cellText(r["primary_category"])),
    secondaryCategories: orNull(cellText(r["corrected_secondary_categories"])),
    topicGroupCandidate: orNull(cellText(r["topic_group_candidate"])),
    canonicalContentId: orNull(cellText(r["duplicate_or_related_to"])),
    duplicateStatus: null,
    isEvergreen: cellText(r["evergreen_candidate"]).toLowerCase() === "yes",
    valdkonnad: splitMulti(cellText(r["filter_valdkonnad_merge"])),
    tegevusalad: splitMulti(cellText(r["filter_tegevusala_merge"])),
    tapsustused: splitMulti(cellText(r["filter_tapsustus"])),
    body: cellText(r["short_summary_et"]),
    title2: title,
  });
}

export function stageAnnualRow(r: Row): StagedContent {
  const title =
    cellText(r["source_title"]) || cellText(r["cleaned_display_title"]) || cellText(r["source_file"]) || cellText(r["content_id"]);
  const display = cellText(r["cleaned_display_title"]);
  const layer = orNull(cellText(r["source_layer"]));
  const type = orNull(cellText(r["source_type"]));
  const body = orNull(cellText(r["source_text_excerpt"]));
  return finalize({
    externalId: cellText(r["content_id"]),
    sourceDataset: "annual_reports",
    sourceLayer: layer,
    sourceTypeDetail: type,
    sourceType: mapSourceType("annual_reports", layer ?? "", type ?? ""),
    sourceUrl: null,
    canonicalUrl: null,
    title,
    displayTitle: baseDisplayTitle(title, display),
    date: parseDate(cellText(r["report_year"])),
    year: parseYear(cellText(r["publication_year"]) || cellText(r["report_year"])),
    reportYear: parseYear(cellText(r["report_year"])),
    sourceFileName: orNull(cellText(r["source_file"])),
    sourceSection: orNull(cellText(r["source_section"])),
    sourcePageLocation: orNull(cellText(r["source_page_or_location"])),
    bodyText: body,
    excerpt: orNull(cellText(r["source_text_excerpt"])),
    summary: orNull(cellText(r["short_summary_et"])),
    kodaPosition: orNull(cellText(r["koda_position_or_impact_et"])),
    companyRelevance: orNull(cellText(r["company_relevance_et"])),
    sourceEvidence: orNull(cellText(r["source_evidence_short"])),
    outcomeStatus: orNull(cellText(r["outcome_status_merge"]) || cellText(r["outcome_status"])),
    importStatus: orNull(cellText(r["import_status_merge"])),
    publicDisplayStatus: orNull(cellText(r["public_display_merge"])),
    mergeReadiness: orNull(cellText(r["merge_readiness"])),
    mergeNotes: orNull(cellText(r["merge_notes"])),
    extractionQuality: orNull(cellText(r["extraction_quality"])),
    needsHumanReview: parseBool(cellText(r["needs_human_review_merge"])),
    reviewReason: orNull(cellText(r["review_reason"])),
    publicPriority: orNull(cellText(r["public_priority"])),
    primaryCategory: orNull(cellText(r["primary_category_merge"]) || cellText(r["primary_category"])),
    secondaryCategories: orNull(cellText(r["secondary_categories"])),
    topicGroupCandidate: orNull(cellText(r["topic_group_candidate"])),
    canonicalContentId: orNull(cellText(r["related_content_ids"])),
    duplicateStatus: null,
    isEvergreen: cellText(r["evergreen_candidate"]).toLowerCase() === "yes",
    valdkonnad: splitMulti(cellText(r["filter_valdkonnad_merge"])),
    tegevusalad: splitMulti(cellText(r["filter_tegevusala_merge"])),
    tapsustused: splitMulti(cellText(r["filter_tapsustus"])),
    body: body ?? "",
    title2: title,
  });
}

// Internal: fill derived fields (contentHash, achievement flag, visibility).
type StageInput = Omit<
  StagedContent,
  "contentHash" | "isAchievement" | "titleKey" | "isPublic" | "isHidden" | "language"
> & {
  body: string | null;
  title2: string;
};

function finalize(input: StageInput): StagedContent {
  const { body, title2, ...rest } = input;
  const isAchievement = rest.sourceTypeDetail === "toovoit" || rest.sourceLayer === "koda_achievement";
  const staged: StagedContent = {
    ...rest,
    language: "et",
    contentHash: contentHash(title2, body),
    isAchievement,
    titleKey: titleKey(title2),
    isPublic: false,
    isHidden: true,
  };
  const visible = computeVisibility(staged);
  staged.isPublic = visible;
  staged.isHidden = !visible;
  return staged;
}

// ---------------------------------------------------------------------------
// Conservative public visibility gating (Task 4)
// ---------------------------------------------------------------------------

/**
 * A row is eligible for normal public search only if it is an explicit public
 * candidate that has cleared review and has acceptable extraction quality.
 * Everything else is imported but hidden/supporting.
 */
export function computeVisibility(s: StagedContent): boolean {
  if (s.importStatus !== "import_public_candidate") return false;
  if (s.needsHumanReview) return false;
  if (s.extractionQuality && WEAK_EXTRACTION.has(s.extractionQuality)) return false;
  if (s.publicDisplayStatus && PUBLIC_BLOCKING_DISPLAY.has(s.publicDisplayStatus)) return false;
  if (s.mergeReadiness && PUBLIC_BLOCKING_READINESS.has(s.mergeReadiness)) return false;
  if (s.duplicateStatus === "possible_duplicate") return false;
  return true;
}

/** Stage every content row from the three real content workbooks. */
export async function stageAllContent(): Promise<{
  web: StagedContent[];
  opinions: StagedContent[];
  annual_reports: StagedContent[];
  all: StagedContent[];
}> {
  const web = (await readSheet(FILES.web, SHEETS.web)).rows.map(stageWebRow);
  const opinions = (await readSheet(FILES.opinions, SHEETS.opinions)).rows.map(stageOpinionRow);
  const annual_reports = (await readSheet(FILES.annual_reports, SHEETS.annual_reports)).rows.map(stageAnnualRow);
  return { web, opinions, annual_reports, all: [...web, ...opinions, ...annual_reports] };
}

// ---------------------------------------------------------------------------
// Achievement enrichment
// ---------------------------------------------------------------------------

export type StagedEnrichment = {
  standaloneAchievementId: string;
  achievementTitle: string;
  matchKey: string;
  matchPriority: string | null;
  enrichmentStatus: string | null;
  rowMergeRole: string | null;
  numericImpactStatement: string | null;
  kodaRole: string | null;
  valueType: string | null;
  affectedCompanyTypes: string | null;
  affectedBusinessFunctions: string | null;
  regulatoryArea: string | null;
  primaryTopic: string | null;
  secondaryTopics: string | null;
  outcomeStatus: string | null;
  confidence: string | null;
  sourceEvidence: string | null;
  indexNote: string | null;
};

export function stageEnrichmentRow(r: Row): StagedEnrichment {
  const title = cellText(r["achievement_title"]);
  return {
    standaloneAchievementId: cellText(r["achievement_id"]) || cellText(r["standalone_achievement_id"]),
    achievementTitle: title,
    matchKey: titleKey(title),
    matchPriority: orNull(cellText(r["match_priority"])),
    enrichmentStatus: orNull(cellText(r["achievement_enrichment_status"])),
    rowMergeRole: orNull(cellText(r["row_merge_role"])),
    numericImpactStatement: orNull(cellText(r["numeric_impact_statement"])),
    kodaRole: orNull(cellText(r["koda_role"])),
    valueType: orNull(cellText(r["value_type"])),
    affectedCompanyTypes: orNull(cellText(r["affected_company_types"])),
    affectedBusinessFunctions: orNull(cellText(r["affected_business_functions"])),
    regulatoryArea: orNull(cellText(r["regulatory_area"])),
    primaryTopic: orNull(cellText(r["primary_topic"])),
    secondaryTopics: orNull(cellText(r["secondary_topics"])),
    outcomeStatus: orNull(cellText(r["outcome_status"])),
    confidence: orNull(cellText(r["confidence"])),
    sourceEvidence: orNull(cellText(r["source_evidence"])),
    indexNote: orNull(cellText(r["index_note"])),
  };
}

export async function stageEnrichment(): Promise<StagedEnrichment[]> {
  const { rows } = await readSheet(FILES.enrichment, SHEETS.enrichment);
  return rows.map(stageEnrichmentRow);
}

export type EnrichmentMatch = {
  enrichment: StagedEnrichment;
  contentExternalId: string | null; // matched web achievement externalId
  matched: boolean;
};

/**
 * Deterministically match each enrichment row to a canonical web achievement
 * row by normalized title key. Source URL is NOT used as the key because all
 * achievements share the same Meie töövõidud page URL.
 */
export function matchEnrichment(
  enrichment: StagedEnrichment[],
  webAchievements: StagedContent[]
): EnrichmentMatch[] {
  const byKey = new Map<string, StagedContent>();
  for (const a of webAchievements) {
    if (!byKey.has(a.titleKey)) byKey.set(a.titleKey, a);
  }
  return enrichment.map((e) => {
    const hit = byKey.get(e.matchKey);
    return { enrichment: e, contentExternalId: hit ? hit.externalId : null, matched: !!hit };
  });
}

// ---------------------------------------------------------------------------
// File-level validation + analysis (no database required)
// ---------------------------------------------------------------------------

export type Issue = { dataset: string; externalId: string; field: string; message: string };

export type Analysis = {
  ok: boolean;
  errors: string[];
  rowCounts: Record<string, number>;
  expected: typeof EXPECTED_ROWS;
  totalContentStaged: number;
  visibility: {
    public: number;
    hiddenOrSupporting: number;
    needsReview: number;
    doNotImport: number;
    weakOrFailedExtraction: number;
  };
  perDataset: Record<
    string,
    { total: number; public: number; hidden: number; needsReview: number; achievements: number }
  >;
  duplicateExternalIds: Record<string, string[]>;
  duplicateContentHashGroups: { hash: string; ids: string[] }[];
  invalidEnumValues: Issue[];
  missingRequiredFields: Issue[];
  publicRowsWithReviewFlag: string[];
  enrichment: {
    rows: number;
    matched: number;
    failed: number;
    failedTitles: string[];
    contentRowsCreated: number; // always 0 by design
    allEnrichmentOnly: boolean;
  };
  canonicalAchievements: number;
};

const REQUIRED_FIELDS: (keyof StagedContent)[] = ["externalId", "title", "importStatus"];

function checkEnum(s: StagedContent, issues: Issue[]) {
  const ds = s.sourceDataset;
  if (s.importStatus && !ALLOWED.importStatus.has(s.importStatus))
    issues.push({ dataset: ds, externalId: s.externalId, field: "import_status_merge", message: s.importStatus });
  if (s.publicDisplayStatus && !ALLOWED.publicDisplay.has(s.publicDisplayStatus))
    issues.push({ dataset: ds, externalId: s.externalId, field: "public_display_merge", message: s.publicDisplayStatus });
  if (s.mergeReadiness && !ALLOWED.mergeReadiness.has(s.mergeReadiness))
    issues.push({ dataset: ds, externalId: s.externalId, field: "merge_readiness", message: s.mergeReadiness });
  if (s.extractionQuality && !ALLOWED.extractionQuality.has(s.extractionQuality))
    issues.push({ dataset: ds, externalId: s.externalId, field: "extraction_quality", message: s.extractionQuality });
}

export function analyze(
  staged: { web: StagedContent[]; opinions: StagedContent[]; annual_reports: StagedContent[]; all: StagedContent[] },
  enrichment: StagedEnrichment[],
  matches: EnrichmentMatch[]
): Analysis {
  const errors: string[] = [];
  const rowCounts = {
    web: staged.web.length,
    opinions: staged.opinions.length,
    annual_reports: staged.annual_reports.length,
    enrichment: enrichment.length,
  };

  // Row-count assertions.
  if (rowCounts.web !== EXPECTED_ROWS.web) errors.push(`web rows ${rowCounts.web} != ${EXPECTED_ROWS.web}`);
  if (rowCounts.opinions !== EXPECTED_ROWS.opinions)
    errors.push(`opinions rows ${rowCounts.opinions} != ${EXPECTED_ROWS.opinions}`);
  if (rowCounts.annual_reports !== EXPECTED_ROWS.annual_reports)
    errors.push(`annual rows ${rowCounts.annual_reports} != ${EXPECTED_ROWS.annual_reports}`);
  if (rowCounts.enrichment !== EXPECTED_ROWS.enrichment)
    errors.push(`enrichment rows ${rowCounts.enrichment} != ${EXPECTED_ROWS.enrichment}`);

  const totalContentStaged = staged.all.length;
  if (totalContentStaged !== EXPECTED_ROWS.totalContentBeforeExclusions)
    errors.push(
      `total content ${totalContentStaged} != ${EXPECTED_ROWS.totalContentBeforeExclusions} (the 5009 trap means the enrichment file was wrongly appended)`
    );

  // Duplicate external IDs per dataset.
  const duplicateExternalIds: Record<string, string[]> = {};
  for (const [ds, rows] of Object.entries({
    web: staged.web,
    opinions: staged.opinions,
    annual_reports: staged.annual_reports,
  })) {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.externalId)) dups.add(r.externalId);
      seen.add(r.externalId);
    }
    if (dups.size) {
      duplicateExternalIds[ds] = [...dups];
      errors.push(`${ds} has ${dups.size} duplicate external IDs`);
    }
  }

  // Enum + required-field validation.
  const invalidEnumValues: Issue[] = [];
  const missingRequiredFields: Issue[] = [];
  for (const s of staged.all) {
    checkEnum(s, invalidEnumValues);
    for (const f of REQUIRED_FIELDS) {
      if (!s[f]) missingRequiredFields.push({ dataset: s.sourceDataset, externalId: s.externalId || "(blank)", field: f as string, message: "missing" });
    }
  }
  if (invalidEnumValues.length) errors.push(`${invalidEnumValues.length} invalid enum value(s)`);
  if (missingRequiredFields.length) errors.push(`${missingRequiredFields.length} missing required field(s)`);

  // Duplicate content-hash groups (informational, not fatal).
  const byHash = new Map<string, string[]>();
  for (const s of staged.all) {
    const list = byHash.get(s.contentHash) ?? [];
    list.push(s.externalId);
    byHash.set(s.contentHash, list);
  }
  const duplicateContentHashGroups = [...byHash.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, ids }));

  // Visibility breakdown.
  const visibility = {
    public: staged.all.filter((s) => s.isPublic).length,
    hiddenOrSupporting: staged.all.filter((s) => !s.isPublic).length,
    needsReview: staged.all.filter((s) => s.needsHumanReview).length,
    doNotImport: staged.all.filter((s) => s.importStatus === "do_not_import_yet").length,
    weakOrFailedExtraction: staged.all.filter(
      (s) => s.extractionQuality && WEAK_EXTRACTION.has(s.extractionQuality)
    ).length,
  };

  const perDataset: Analysis["perDataset"] = {};
  for (const [ds, rows] of Object.entries({
    web: staged.web,
    opinions: staged.opinions,
    annual_reports: staged.annual_reports,
  })) {
    perDataset[ds] = {
      total: rows.length,
      public: rows.filter((r) => r.isPublic).length,
      hidden: rows.filter((r) => !r.isPublic).length,
      needsReview: rows.filter((r) => r.needsHumanReview).length,
      achievements: rows.filter((r) => r.isAchievement).length,
    };
  }

  // Safety: no public row should still carry a review flag.
  const publicRowsWithReviewFlag = staged.all.filter((s) => s.isPublic && s.needsHumanReview).map((s) => s.externalId);
  if (publicRowsWithReviewFlag.length) errors.push(`${publicRowsWithReviewFlag.length} public row(s) still flagged for review`);

  // Enrichment checks.
  const canonicalAchievements = staged.web.filter((s) => s.isAchievement).length;
  if (canonicalAchievements !== EXPECTED_ROWS.canonicalAchievements)
    errors.push(`canonical achievements ${canonicalAchievements} != ${EXPECTED_ROWS.canonicalAchievements}`);

  const failed = matches.filter((m) => !m.matched);
  if (failed.length) errors.push(`${failed.length} enrichment row(s) did not match a canonical achievement`);
  const allEnrichmentOnly = enrichment.every((e) => e.rowMergeRole === "enrichment_only");
  if (!allEnrichmentOnly) errors.push(`some enrichment rows are not marked enrichment_only`);

  return {
    ok: errors.length === 0,
    errors,
    rowCounts,
    expected: EXPECTED_ROWS,
    totalContentStaged,
    visibility,
    perDataset,
    duplicateExternalIds,
    duplicateContentHashGroups,
    invalidEnumValues,
    missingRequiredFields,
    publicRowsWithReviewFlag,
    enrichment: {
      rows: enrichment.length,
      matched: matches.filter((m) => m.matched).length,
      failed: failed.length,
      failedTitles: failed.map((m) => m.enrichment.achievementTitle),
      contentRowsCreated: 0,
      allEnrichmentOnly,
    },
    canonicalAchievements,
  };
}

/** Convenience: stage everything and run analysis (no DB). */
export async function stageAndAnalyze(): Promise<{
  staged: Awaited<ReturnType<typeof stageAllContent>>;
  enrichment: StagedEnrichment[];
  matches: EnrichmentMatch[];
  analysis: Analysis;
}> {
  const staged = await stageAllContent();
  const enrichment = await stageEnrichment();
  const matches = matchEnrichment(enrichment, staged.web.filter((s) => s.isAchievement));
  const analysis = analyze(staged, enrichment, matches);
  return { staged, enrichment, matches, analysis };
}

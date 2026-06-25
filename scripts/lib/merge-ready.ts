/**
 * Shared logic for the structured v0.9.10 Koda app-upload package.
 *
 * The active source package is:
 *   - koda_web_content_v0_9_10_app_clean.xlsx (web_content_v0_9)       1132 rows
 *   - koda_opinions_v0_9_8_app_clean.xlsx     (opinions_v0_9)           428 rows
 *   - koda_toovoidud_enrichment_v0_9_10_app_clean.xlsx (toovoidud_v0_9)  73 rows
 *   - koda_taxonomy_rules_v0_9_2.txt           (taxonomy reference only)
 *
 * Total content rows = 1633. Quarantine/report/readme sheets are never
 * imported as public content.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import * as XLSX from "xlsx";
import { contentHash, normalizeTitle } from "../../src/lib/hash";
import { splitTopics } from "../../src/lib/taxonomy-split";
import { normalizeTopicLabel } from "../../src/lib/topics";
import { normalizeRecipient } from "../../src/lib/recipient";

export const IMPORT_DIR = resolve(process.cwd(), "data", "import");

export type DatasetKey = "web" | "opinions" | "toovoidud";

export const FILES = {
  web: ["koda_web_content_v0_9_10_app_clean.xlsx"],
  opinions: ["koda_opinions_v0_9_8_app_clean.xlsx"],
  toovoidud: ["koda_toovoidud_enrichment_v0_9_10_app_clean.xlsx"],
  taxonomy: ["koda_taxonomy_rules_v0_9_2.txt"],
} as const;

export const SHEETS = {
  web: "web_content_v0_9",
  opinions: "opinions_v0_9",
  toovoidud: "toovoidud_v0_9",
  approvedLinks: "approved_links_v0_9",
  candidateLinks: "candidate_links_v0_9",
  opinionLinkStatus: "opinion_link_status_v0_9",
} as const;

export const EXPECTED_ROWS = {
  web: 1132,
  opinions: 428,
  toovoidud: 73,
  totalContentBeforeExclusions: 1633,
  webPublic: 1132,
  webSupportOnly: 0,
  webStagingOnly: 0,
  webDoNotImportPublic: 0,
  opinionsPublic: 428,
  opinionsStagingOnly: 0,
  toovoidudPublic: 73,
  toovoidudHold: 0,
  approvedLinks: 0,
  candidateLinks: 0,
} as const;

export function filePath(name: string): string {
  return resolve(IMPORT_DIR, name);
}

export function resolveImportFile(names: readonly string[]): string {
  for (const name of names) {
    const path = filePath(name);
    if (existsSync(path)) return path;
  }
  throw new Error(`Missing input file. Expected one of: ${names.map(filePath).join(", ")}`);
}

export function activeInputFileName(names: readonly string[]): string {
  return resolveImportFile(names).split(/[\\/]/).pop() ?? names[0];
}

export const ALLOWED = {
  webImportAction: new Set(["import_public", "import_support_only", "import_staging_only", "do_not_import_public"]),
  opinionImportAction: new Set(["import_public", "import_staging_only"]),
  toovoitImportAction: new Set(["enrichment_public", "enrichment_hold", "import"]),
  publicDisplayStatus: new Set([
    "public_candidate",
    "public_ready",
    "support_only",
    "review_required",
    "numeric_review_hold",
    "duplicate_only",
    "source_quality_hold",
    "blocked",
  ]),
  sourceQualityFlag: new Set([
    "ok",
    "duplicate_risk",
    "not_policy_relevant",
    "needs_review",
    "supporting_document_not_opinion",
    "manual_source_checked_v0_9_7",
  ]),
  classificationConfidence: new Set(["high", "medium-high", "medium", "medium-low", "low"]),
} as const;

const PUBLIC_BLOCKING_DISPLAY = new Set([
  "review_required",
  "numeric_review_hold",
  "duplicate_only",
  "source_quality_hold",
  "blocked",
]);
const BAD_SOURCE_QUALITY = new Set(["not_policy_relevant", "needs_review", "supporting_document_not_opinion"]);

export type Row = Record<string, string>;

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

export function splitMulti(s: string): string[] {
  return s
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function joinSearchText(values: Array<string | null | undefined>): string | null {
  const text = values
    .map((v) => v?.trim())
    .filter((v): v is string => !!v)
    .join("\n\n");
  return text || null;
}

export async function readSheet(fileNames: readonly string[], sheetName: string): Promise<{ headers: string[]; rows: Row[] }> {
  const path = resolveImportFile(fileNames);
  const wb = XLSX.readFile(path, { cellDates: true, raw: false });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Missing sheet "${sheetName}" in ${path}. Available: ${wb.SheetNames.join(", ")}`);
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

export type CompatSourceType =
  | "opinion"
  | "archive_opinion"
  | "news"
  | "currently_handled"
  | "service"
  | "event"
  | "achievement"
  | "unknown";

function sourceKindFromWebType(type: string): { layer: string; detail: string; compat: CompatSourceType } {
  if (type === "koda_public_opinion_article") return { layer: "koda_public_opinion", detail: "meie_arvamus_article", compat: "opinion" };
  if (type === "event_or_training") return { layer: "koda_news", detail: "event_or_training", compat: "event" };
  if (type === "service_or_tool_page") return { layer: "koda_news", detail: "service_or_tool_page", compat: "service" };
  return { layer: "koda_news", detail: "meie_uudis", compat: "news" };
}

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
  importAction: string | null;
  publicDisplayAllowed: boolean | null;
  publicDisplayRole: string | null;
  mergeReadiness: string | null;
  mergeNotes: string | null;
  extractionQuality: string | null;
  needsHumanReview: boolean;
  numericClaimNeedsReview: boolean;
  reviewReason: string | null;
  publicPriority: string | null;
  sourceQualityFlag: string | null;
  classificationConfidence: string | null;
  primaryCategory: string | null;
  secondaryCategories: string | null;
  topicGroupCandidate: string | null;
  topicPrimary: string | null;
  topicSecondary: string | null;
  activityPrimary: string | null;
  activitySecondary: string | null;
  sectorScope: string | null;
  situationTags: string | null;
  lawTagsConfirmed: string | null;
  lawTagsCandidate: string | null;
  lawSearchAllowed: boolean;
  // Recipient / ministry metadata (taxonomy v2.1.6) — never affects topic.
  recipientRaw: string | null;
  recipientNormalized: string | null;
  recipientFilterGroup: string | null;
  recipientType: string | null;
  recipientSecondary: string | null;
  recipientNormalizationReviewRequired: boolean;
  canonicalContentId: string | null;
  duplicateStatus: string | null;
  isEvergreen: boolean;
  contentHash: string;
  valdkonnad: string[];
  tegevusalad: string[];
  tapsustused: string[];
  oigusaktid: string[];
  language: string;
  isAchievement: boolean;
  titleKey: string;
  isPublic: boolean;
  isHidden: boolean;
  matchedWebContentId: string | null;
  matchedOpinionContentId: string | null;
};

type StageInput = Omit<
  StagedContent,
  "contentHash" | "isAchievement" | "titleKey" | "isPublic" | "isHidden" | "language"
> & {
  hashText: string | null;
};

/**
 * Topic labels (valdkonnad) that the importer could not map to a canonical
 * taxonomy topic. They are kept as internal classification but never become
 * public filter options (the public filter is the canonical allowlist). The
 * import script logs these as warnings for review.
 */
export const unknownTopicLabels = new Map<string, number>();

type RecipientFields = Pick<
  StagedContent,
  | "recipientRaw"
  | "recipientNormalized"
  | "recipientFilterGroup"
  | "recipientType"
  | "recipientSecondary"
  | "recipientNormalizationReviewRequired"
>;

/**
 * Map recipient/ministry columns to normalized metadata fields. Recipient is an
 * advanced-filter dimension only — it never feeds topic classification. Explicit
 * recipient_normalized / recipient_filter_group / recipient_type columns win;
 * otherwise values are derived from recipient_raw via normalizeRecipient().
 */
function recipientFields(r: Row): RecipientFields {
  const raw = cellText(r["recipient_raw"]) || cellText(r["recipient"]);
  const norm = normalizeRecipient(raw, {
    normalized: orNull(cellText(r["recipient_normalized"])),
    filterGroup: orNull(cellText(r["recipient_filter_group"])),
    type: orNull(cellText(r["recipient_type"])),
  });
  const reviewCol = cellText(r["recipient_normalization_review_required"]);
  return {
    recipientRaw: norm?.raw ?? orNull(raw),
    recipientNormalized: norm?.normalized ?? null,
    recipientFilterGroup: norm?.filterGroup ?? null,
    recipientType: norm?.type ?? null,
    recipientSecondary: orNull(cellText(r["recipient_secondary"])),
    recipientNormalizationReviewRequired: reviewCol ? parseBool(reviewCol) : norm?.reviewRequired ?? false,
  };
}

function makeTaxonomy(primary: string | null, secondary: string | null): string[] {
  // Topics/activities are canonical names that may contain commas, so use the
  // topic-aware splitter that repairs ";"-for-"," corruption (see splitTopics).
  const raw = [...new Set([...splitTopics(primary ?? ""), ...splitTopics(secondary ?? "")])];
  // Normalize each label to its canonical taxonomy label (aliases fold in);
  // unknown labels are kept as-is but recorded as a warning.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const { label, known } = normalizeTopicLabel(value);
    if (!known) unknownTopicLabels.set(value, (unknownTopicLabels.get(value) ?? 0) + 1);
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

function finalize(input: StageInput): StagedContent {
  const { hashText, ...rest } = input;
  const isAchievement = rest.sourceTypeDetail === "toovoit" || rest.sourceLayer === "koda_achievement";
  const staged: StagedContent = {
    ...rest,
    language: "et",
    contentHash: contentHash(rest.title, hashText),
    isAchievement,
    titleKey: normalizeTitle(rest.title),
    isPublic: false,
    isHidden: true,
  };
  const visible = computeVisibility(staged);
  staged.isPublic = visible;
  staged.isHidden = !visible;
  return staged;
}

export function stageWebRow(r: Row): StagedContent {
  const sourceTypeRaw = cellText(r["source_type"]);
  const mapped = sourceKindFromWebType(sourceTypeRaw);
  const title =
    cellText(r["title"]) ||
    cellText(r["page_title"]) ||
    cellText(r["canonical_url"]) ||
    cellText(r["url"]) ||
    cellText(r["web_content_id"]);
  const topicPrimary = orNull(cellText(r["topic_primary"]));
  const topicSecondary = orNull(cellText(r["topic_secondary"]));
  const activityPrimary = orNull(cellText(r["activity_primary"]));
  const activitySecondary = orNull(cellText(r["activity_secondary"]));
  const lawTagsConfirmed = orNull(cellText(r["law_tags_confirmed"]));
  const summary = orNull(cellText(r["public_readable_summary"]) || cellText(r["article_summary"]));
  const excerpt = orNull(cellText(r["first_substantive_paragraph"]) || cellText(r["lead_text"]));
  const sourceEvidence = orNull(cellText(r["evidence_short"]) || cellText(r["law_evidence_text"]));
  const bodyText = joinSearchText([
    summary,
    excerpt,
    sourceEvidence,
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    lawTagsConfirmed,
  ]);

  return finalize({
    externalId: cellText(r["web_content_id"]),
    sourceDataset: "web",
    sourceLayer: mapped.layer,
    sourceTypeDetail: mapped.detail,
    sourceType: mapped.compat,
    sourceUrl: orNull(cellText(r["url"])),
    canonicalUrl: orNull(cellText(r["canonical_url"])),
    title,
    displayTitle: title,
    date: parseDate(cellText(r["sort_date"]) || cellText(r["published_date"]) || cellText(r["updated_date"])),
    year: parseYear(cellText(r["source_year"]) || cellText(r["published_date"]) || cellText(r["sort_date"])),
    reportYear: null,
    sourceFileName: orNull(cellText(r["body_text_source_file"])),
    sourceSection: orNull(cellText(r["source_type"])),
    sourcePageLocation: null,
    bodyText,
    excerpt,
    summary,
    kodaPosition: orNull(cellText(r["stance"])),
    companyRelevance: orNull(cellText(r["value_type"])),
    sourceEvidence,
    outcomeStatus: orNull(cellText(r["work_win_status"])),
    importStatus: orNull(cellText(r["import_action"])),
    publicDisplayStatus: orNull(cellText(r["public_display_status"])),
    importAction: orNull(cellText(r["import_action"])),
    publicDisplayAllowed: parseBool(cellText(r["public_display_allowed"])),
    publicDisplayRole: orNull(cellText(r["public_display_role"])),
    mergeReadiness: null,
    mergeNotes: orNull(cellText(r["notes"])),
    extractionQuality: null,
    needsHumanReview: parseBool(cellText(r["review_required"])),
    numericClaimNeedsReview:
      cellText(r["public_display_status"]) === "numeric_review_hold" && parseBool(cellText(r["numeric_claim_needs_review"])),
    reviewReason: orNull(cellText(r["review_reason"]) || cellText(r["public_block_reason"])),
    publicPriority: orNull(cellText(r["public_preference_rank"])),
    sourceQualityFlag: orNull(cellText(r["source_quality_flag"])),
    classificationConfidence: orNull(cellText(r["classification_confidence"])),
    primaryCategory: topicPrimary,
    secondaryCategories: topicSecondary,
    topicGroupCandidate: orNull(cellText(r["canonical_policy_thread_id_provisional"])),
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    sectorScope: orNull(cellText(r["sector_scope"])),
    situationTags: orNull(cellText(r["situation_tags"])),
    lawTagsConfirmed,
    lawTagsCandidate: orNull(cellText(r["law_tags_candidate"])),
    lawSearchAllowed: !!lawTagsConfirmed && cellText(r["law_match_confidence"]).toLowerCase() !== "low",
    canonicalContentId: orNull(cellText(r["duplicate_of_web_content_id"])),
    duplicateStatus: orNull(cellText(r["duplicate_status"])),
    isEvergreen: false,
    ...recipientFields(r),
    valdkonnad: makeTaxonomy(topicPrimary, topicSecondary),
    tegevusalad: makeTaxonomy(activityPrimary, activitySecondary),
    tapsustused: splitMulti(cellText(r["situation_tags"])),
    oigusaktid: splitMulti(lawTagsConfirmed ?? ""),
    matchedWebContentId: null,
    matchedOpinionContentId: null,
    hashText: bodyText,
  });
}

export function stageOpinionRow(r: Row): StagedContent {
  const title = cellText(r["title"]) || cellText(r["title_extracted_from_pdf"]) || cellText(r["source_file"]) || cellText(r["content_id"]);
  const topicPrimary = orNull(cellText(r["topic_primary"]));
  const topicSecondary = orNull(cellText(r["topic_secondary"]));
  const activityPrimary = orNull(cellText(r["activity_primary"]));
  const activitySecondary = orNull(cellText(r["activity_secondary"]));
  const lawTagsConfirmed = orNull(cellText(r["law_tags_confirmed"]));
  const summary = orNull(cellText(r["first_substantive_paragraph_corrected"]) || cellText(r["first_substantive_paragraph"]));
  const sourceEvidence = orNull(cellText(r["evidence_short"]) || cellText(r["law_evidence_text"]));
  const bodyText = joinSearchText([
    summary,
    sourceEvidence,
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    lawTagsConfirmed,
  ]);

  return finalize({
    externalId: cellText(r["content_id"]),
    sourceDataset: "opinions",
    sourceLayer: "koda_public_opinion",
    sourceTypeDetail: "meie_arvamus_article",
    sourceType: "opinion",
    sourceUrl: null,
    canonicalUrl: null,
    title,
    displayTitle: title,
    date: parseDate(cellText(r["sort_date"]) || cellText(r["document_date"])),
    year: parseYear(cellText(r["source_year"]) || cellText(r["document_date"]) || cellText(r["sort_date"])),
    reportYear: null,
    sourceFileName: orNull(cellText(r["source_file"])),
    // Recipient is now mapped to dedicated recipient* fields (see recipientFields);
    // sourceSection holds the actual section only.
    sourceSection: orNull(cellText(r["source_section"])),
    sourcePageLocation: null,
    bodyText,
    excerpt: summary,
    summary,
    kodaPosition: orNull(cellText(r["stance"])),
    companyRelevance: orNull(cellText(r["value_type"])),
    sourceEvidence,
    outcomeStatus: null,
    importStatus: orNull(cellText(r["import_action"])),
    publicDisplayStatus: orNull(cellText(r["public_display_status"])),
    importAction: orNull(cellText(r["import_action"])),
    publicDisplayAllowed: parseBool(cellText(r["public_display_allowed"])),
    publicDisplayRole: null,
    mergeReadiness: null,
    mergeNotes: orNull(cellText(r["notes"])),
    extractionQuality: null,
    needsHumanReview: parseBool(cellText(r["review_required"])),
    numericClaimNeedsReview: parseBool(cellText(r["numeric_claim_needs_review"])),
    reviewReason: orNull(cellText(r["review_reason"]) || cellText(r["public_block_reason"])),
    publicPriority: null,
    sourceQualityFlag: orNull(cellText(r["source_quality_flag"])),
    classificationConfidence: orNull(cellText(r["classification_confidence"])),
    primaryCategory: topicPrimary,
    secondaryCategories: topicSecondary,
    topicGroupCandidate: null,
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    sectorScope: orNull(cellText(r["sector_scope"])),
    situationTags: orNull(cellText(r["situation_tags"])),
    lawTagsConfirmed,
    lawTagsCandidate: orNull(cellText(r["law_tags_candidate"])),
    lawSearchAllowed: !!lawTagsConfirmed && !["low", "none"].includes(cellText(r["law_match_confidence"]).toLowerCase()),
    canonicalContentId: null,
    duplicateStatus: null,
    isEvergreen: false,
    ...recipientFields(r),
    valdkonnad: makeTaxonomy(topicPrimary, topicSecondary),
    tegevusalad: makeTaxonomy(activityPrimary, activitySecondary),
    tapsustused: splitMulti(cellText(r["situation_tags"])),
    oigusaktid: splitMulti(lawTagsConfirmed ?? ""),
    matchedWebContentId: null,
    matchedOpinionContentId: null,
    hashText: bodyText,
  });
}

export function stageToovoitRow(r: Row): StagedContent {
  const title = cellText(r["public_title"]) || cellText(r["title"]) || cellText(r["source_title"]) || cellText(r["toovoit_id"]);
  const topicPrimary = orNull(cellText(r["topic_primary"]));
  const topicSecondary = orNull(cellText(r["topic_secondary"]));
  const activityPrimary = orNull(cellText(r["activity_primary"]));
  const activitySecondary = orNull(cellText(r["activity_secondary"]));
  const lawTagsConfirmed = orNull(cellText(r["law_tags_confirmed"]));
  const summary = orNull(cellText(r["public_summary"]) || cellText(r["summary"]) || cellText(r["why_it_matters"]));
  const sourceEvidence = orNull(cellText(r["impact_statement"]) || cellText(r["law_evidence_text"]));
  const bodyText = joinSearchText([
    summary,
    sourceEvidence,
    cellText(r["why_it_matters"]),
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    lawTagsConfirmed,
  ]);

  return finalize({
    externalId: cellText(r["toovoit_id"]),
    sourceDataset: "toovoidud",
    sourceLayer: "koda_achievement",
    sourceTypeDetail: "toovoit",
    sourceType: "achievement",
    sourceUrl: orNull(cellText(r["source_url"]) || cellText(r["matched_web_url"])),
    canonicalUrl: null,
    title,
    displayTitle: title,
    date: parseDate(cellText(r["sort_date"]) || cellText(r["published_date"])),
    year: parseYear(cellText(r["source_year"]) || cellText(r["sort_date"])),
    reportYear: null,
    sourceFileName: null,
    sourceSection: orNull(cellText(r["source_section"])),
    sourcePageLocation: null,
    bodyText,
    excerpt: summary,
    summary,
    kodaPosition: orNull(cellText(r["impact_statement"])),
    companyRelevance: orNull(cellText(r["affected_company_profile"]) || cellText(r["beneficiary_scope"])),
    sourceEvidence,
    outcomeStatus: orNull(cellText(r["work_win_status"])),
    importStatus: orNull(cellText(r["import_action"])),
    publicDisplayStatus: orNull(cellText(r["public_display_status"])),
    importAction: orNull(cellText(r["import_action"])),
    publicDisplayAllowed: parseBool(cellText(r["public_display_allowed"])),
    publicDisplayRole: null,
    mergeReadiness: null,
    mergeNotes: orNull(cellText(r["notes"])),
    extractionQuality: null,
    needsHumanReview: parseBool(cellText(r["review_required"])),
    numericClaimNeedsReview: parseBool(cellText(r["numeric_claim_needs_review"])),
    reviewReason: orNull(cellText(r["review_reason"]) || cellText(r["public_block_reason"])),
    publicPriority: orNull(cellText(r["source_preference_rank"])),
    sourceQualityFlag: orNull(cellText(r["source_quality_flag"])),
    classificationConfidence: orNull(cellText(r["classification_confidence"])),
    primaryCategory: topicPrimary,
    secondaryCategories: topicSecondary,
    topicGroupCandidate: orNull(cellText(r["canonical_policy_thread_id"])),
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    sectorScope: orNull(cellText(r["sector_scope"])),
    situationTags: orNull(cellText(r["situation_tags"])),
    lawTagsConfirmed,
    lawTagsCandidate: orNull(cellText(r["law_tags_candidate"])),
    lawSearchAllowed: !!lawTagsConfirmed,
    canonicalContentId: orNull(cellText(r["canonical_toovoit_id"])),
    duplicateStatus: parseBool(cellText(r["is_duplicate"])) ? "possible_duplicate" : null,
    isEvergreen: true,
    ...recipientFields(r),
    valdkonnad: makeTaxonomy(topicPrimary, topicSecondary),
    tegevusalad: makeTaxonomy(activityPrimary, activitySecondary),
    tapsustused: splitMulti(cellText(r["situation_tags"])),
    oigusaktid: splitMulti(lawTagsConfirmed ?? ""),
    matchedWebContentId: orNull(cellText(r["matched_web_content_id"])),
    matchedOpinionContentId: orNull(cellText(r["matched_opinion_content_id"])),
    hashText: bodyText,
  });
}

export function computeVisibility(s: StagedContent): boolean {
  const actionOk =
    s.sourceDataset === "toovoidud"
      ? s.importAction === "enrichment_public" || s.importAction === "import"
      : s.importAction === "import_public";
  if (!actionOk) return false;
  if (s.publicDisplayAllowed !== true) return false;
  if (s.needsHumanReview) return false;
  if (s.numericClaimNeedsReview) return false;
  if (s.publicDisplayStatus && PUBLIC_BLOCKING_DISPLAY.has(s.publicDisplayStatus)) return false;
  if (s.sourceQualityFlag && BAD_SOURCE_QUALITY.has(s.sourceQualityFlag)) return false;
  if (s.duplicateStatus === "possible_duplicate") return false;
  return true;
}

export async function stageAllContent(): Promise<{
  web: StagedContent[];
  opinions: StagedContent[];
  toovoidud: StagedContent[];
  all: StagedContent[];
}> {
  const web = (await readSheet(FILES.web, SHEETS.web)).rows.map(stageWebRow);
  const opinions = (await readSheet(FILES.opinions, SHEETS.opinions)).rows.map(stageOpinionRow);
  const toovoidud = (await readSheet(FILES.toovoidud, SHEETS.toovoidud)).rows.map(stageToovoitRow);
  return { web, opinions, toovoidud, all: [...web, ...opinions, ...toovoidud] };
}

export type StagedLink = {
  webContentId: string;
  opinionContentId: string;
  publicLinkAllowed: boolean;
  linkImportAction: string | null;
  relationStatus: string | null;
  confidence: string | null;
  evidence: string | null;
};

function stageLinkRow(r: Row): StagedLink {
  return {
    webContentId: cellText(r["web_content_id"]),
    opinionContentId: cellText(r["opinion_content_id"]),
    publicLinkAllowed: parseBool(cellText(r["public_link_allowed"])),
    linkImportAction: orNull(cellText(r["link_import_action"])),
    relationStatus: orNull(cellText(r["relation_status"])),
    confidence: orNull(cellText(r["confidence"])),
    evidence: orNull(cellText(r["evidence"])),
  };
}

export async function stageLinks(): Promise<{ approved: StagedLink[]; candidate: StagedLink[] }> {
  const webFile = resolveImportFile(FILES.web);
  const wb = XLSX.readFile(webFile, { cellDates: true, raw: false });
  const approved = wb.SheetNames.includes(SHEETS.approvedLinks)
    ? (await readSheet(FILES.web, SHEETS.approvedLinks)).rows.map(stageLinkRow)
    : [];
  const candidate = wb.SheetNames.includes(SHEETS.candidateLinks)
    ? (await readSheet(FILES.web, SHEETS.candidateLinks)).rows.map(stageLinkRow)
    : [];
  return { approved, candidate };
}

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
    numericReview: number;
    doNotImportPublic: number;
    supportOnly: number;
    stagingOnly: number;
    heldToovoidud: number;
  };
  perDataset: Record<string, { total: number; public: number; hidden: number; needsReview: number; achievements: number }>;
  duplicateExternalIds: Record<string, string[]>;
  duplicateContentHashGroups: { hash: string; ids: string[] }[];
  invalidEnumValues: Issue[];
  missingRequiredFields: Issue[];
  publicRowsWithReviewFlag: string[];
  publicRowsWithNumericReviewFlag: string[];
  blockers: {
    supportOnlyPublic: string[];
    stagingOnlyPublic: string[];
    heldToovoidudPublic: string[];
    candidateLinksPublic: number;
  };
  links: {
    approvedRows: number;
    approvedPublicEligible: number;
    approvedAdminOrBlocked: number;
    candidateRows: number;
    candidateAdminOnly: number;
  };
  law: {
    publicConfirmedLawTagRows: number;
    candidateLawTagRows: number;
  };
  taxonomyReference: {
    fileName: string;
    bytes: number;
  };
};

const REQUIRED_FIELDS: (keyof StagedContent)[] = ["externalId", "title", "importAction"];

function checkEnum(s: StagedContent, issues: Issue[]) {
  const ds = s.sourceDataset;
  const actionAllowed =
    ds === "web"
      ? ALLOWED.webImportAction
      : ds === "opinions"
        ? ALLOWED.opinionImportAction
        : ALLOWED.toovoitImportAction;
  if (s.importAction && !actionAllowed.has(s.importAction as never)) {
    issues.push({ dataset: ds, externalId: s.externalId, field: "import_action", message: s.importAction });
  }
  if (s.publicDisplayStatus && !ALLOWED.publicDisplayStatus.has(s.publicDisplayStatus as never)) {
    issues.push({ dataset: ds, externalId: s.externalId, field: "public_display_status", message: s.publicDisplayStatus });
  }
  if (s.sourceQualityFlag && !ALLOWED.sourceQualityFlag.has(s.sourceQualityFlag as never)) {
    issues.push({ dataset: ds, externalId: s.externalId, field: "source_quality_flag", message: s.sourceQualityFlag });
  }
  if (s.classificationConfidence && !ALLOWED.classificationConfidence.has(s.classificationConfidence as never)) {
    issues.push({ dataset: ds, externalId: s.externalId, field: "classification_confidence", message: s.classificationConfidence });
  }
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const k = key(value);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function analyze(
  staged: { web: StagedContent[]; opinions: StagedContent[]; toovoidud: StagedContent[]; all: StagedContent[] },
  links: { approved: StagedLink[]; candidate: StagedLink[] }
): Analysis {
  const errors: string[] = [];
  const rowCounts = {
    web: staged.web.length,
    opinions: staged.opinions.length,
    toovoidud: staged.toovoidud.length,
    approvedLinks: links.approved.length,
    candidateLinks: links.candidate.length,
  };

  if (rowCounts.web !== EXPECTED_ROWS.web) errors.push(`web rows ${rowCounts.web} != ${EXPECTED_ROWS.web}`);
  if (rowCounts.opinions !== EXPECTED_ROWS.opinions) errors.push(`opinions rows ${rowCounts.opinions} != ${EXPECTED_ROWS.opinions}`);
  if (rowCounts.toovoidud !== EXPECTED_ROWS.toovoidud) errors.push(`toovoidud rows ${rowCounts.toovoidud} != ${EXPECTED_ROWS.toovoidud}`);
  if (rowCounts.approvedLinks !== EXPECTED_ROWS.approvedLinks) errors.push(`approved links ${rowCounts.approvedLinks} != ${EXPECTED_ROWS.approvedLinks}`);
  if (rowCounts.candidateLinks !== EXPECTED_ROWS.candidateLinks) errors.push(`candidate links ${rowCounts.candidateLinks} != ${EXPECTED_ROWS.candidateLinks}`);

  const totalContentStaged = staged.all.length;
  if (totalContentStaged !== EXPECTED_ROWS.totalContentBeforeExclusions) {
    errors.push(`total content ${totalContentStaged} != ${EXPECTED_ROWS.totalContentBeforeExclusions}`);
  }

  const duplicateExternalIds: Record<string, string[]> = {};
  for (const [ds, rows] of Object.entries({ web: staged.web, opinions: staged.opinions, toovoidud: staged.toovoidud })) {
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

  const byHash = new Map<string, string[]>();
  for (const s of staged.all) {
    const list = byHash.get(s.contentHash) ?? [];
    list.push(s.externalId);
    byHash.set(s.contentHash, list);
  }
  const duplicateContentHashGroups = [...byHash.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, ids }));

  const visibility = {
    public: staged.all.filter((s) => s.isPublic).length,
    hiddenOrSupporting: staged.all.filter((s) => !s.isPublic).length,
    needsReview: staged.all.filter((s) => s.needsHumanReview).length,
    numericReview: staged.all.filter((s) => s.numericClaimNeedsReview).length,
    doNotImportPublic: staged.web.filter((s) => s.importAction === "do_not_import_public").length,
    supportOnly: staged.web.filter((s) => s.importAction === "import_support_only").length,
    stagingOnly: staged.all.filter((s) => s.importAction === "import_staging_only").length,
    heldToovoidud: staged.toovoidud.filter((s) => s.importAction === "enrichment_hold").length,
  };

  const perDataset: Analysis["perDataset"] = {};
  for (const [ds, rows] of Object.entries({ web: staged.web, opinions: staged.opinions, toovoidud: staged.toovoidud })) {
    perDataset[ds] = {
      total: rows.length,
      public: rows.filter((r) => r.isPublic).length,
      hidden: rows.filter((r) => !r.isPublic).length,
      needsReview: rows.filter((r) => r.needsHumanReview).length,
      achievements: rows.filter((r) => r.isAchievement).length,
    };
  }

  if (perDataset.web.public !== EXPECTED_ROWS.webPublic) errors.push(`web public ${perDataset.web.public} != ${EXPECTED_ROWS.webPublic}`);
  if (visibility.supportOnly !== EXPECTED_ROWS.webSupportOnly) errors.push(`web support-only ${visibility.supportOnly} != ${EXPECTED_ROWS.webSupportOnly}`);
  if (staged.web.filter((s) => s.importAction === "import_staging_only").length !== EXPECTED_ROWS.webStagingOnly) {
    errors.push(`web staging-only count mismatch`);
  }
  if (visibility.doNotImportPublic !== EXPECTED_ROWS.webDoNotImportPublic) errors.push(`web do-not-import-public count mismatch`);
  if (perDataset.opinions.public !== EXPECTED_ROWS.opinionsPublic) errors.push(`opinions public ${perDataset.opinions.public} != ${EXPECTED_ROWS.opinionsPublic}`);
  if (staged.opinions.filter((s) => s.importAction === "import_staging_only").length !== EXPECTED_ROWS.opinionsStagingOnly) {
    errors.push(`opinions staging-only count mismatch`);
  }
  if (perDataset.toovoidud.public !== EXPECTED_ROWS.toovoidudPublic) errors.push(`toovoidud public ${perDataset.toovoidud.public} != ${EXPECTED_ROWS.toovoidudPublic}`);
  if (visibility.heldToovoidud !== EXPECTED_ROWS.toovoidudHold) errors.push(`toovoidud hold count mismatch`);

  const publicRowsWithReviewFlag = staged.all.filter((s) => s.isPublic && s.needsHumanReview).map((s) => s.externalId);
  const publicRowsWithNumericReviewFlag = staged.all.filter((s) => s.isPublic && s.numericClaimNeedsReview).map((s) => s.externalId);
  if (publicRowsWithReviewFlag.length) errors.push(`${publicRowsWithReviewFlag.length} public row(s) still flagged for review`);
  if (publicRowsWithNumericReviewFlag.length) errors.push(`${publicRowsWithNumericReviewFlag.length} public row(s) still flagged for numeric review`);

  const blockers = {
    supportOnlyPublic: staged.web.filter((s) => s.importAction === "import_support_only" && s.isPublic).map((s) => s.externalId),
    stagingOnlyPublic: staged.all.filter((s) => s.importAction === "import_staging_only" && s.isPublic).map((s) => s.externalId),
    heldToovoidudPublic: staged.toovoidud.filter((s) => s.importAction === "enrichment_hold" && s.isPublic).map((s) => s.externalId),
    candidateLinksPublic: links.candidate.filter((l) => l.publicLinkAllowed || l.linkImportAction === "public").length,
  };
  if (blockers.supportOnlyPublic.length) errors.push(`${blockers.supportOnlyPublic.length} support-only rows are public`);
  if (blockers.stagingOnlyPublic.length) errors.push(`${blockers.stagingOnlyPublic.length} staging-only rows are public`);
  if (blockers.heldToovoidudPublic.length) errors.push(`${blockers.heldToovoidudPublic.length} held toovoidud rows are public`);
  if (blockers.candidateLinksPublic) errors.push(`${blockers.candidateLinksPublic} candidate links look public`);

  const publicIds = new Set(staged.all.filter((s) => s.isPublic).map((s) => s.externalId));
  const approvedPublicEligible = links.approved.filter(
    (l) => l.publicLinkAllowed && l.linkImportAction === "import_public_relation" && publicIds.has(l.webContentId) && publicIds.has(l.opinionContentId)
  ).length;

  const taxonomyFile = resolveImportFile(FILES.taxonomy);
  const taxonomyReference = {
    fileName: taxonomyFile.split(/[\\/]/).pop() ?? FILES.taxonomy[0],
    bytes: statSync(taxonomyFile).size,
  };

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
    publicRowsWithNumericReviewFlag,
    blockers,
    links: {
      approvedRows: links.approved.length,
      approvedPublicEligible,
      approvedAdminOrBlocked: links.approved.length - approvedPublicEligible,
      candidateRows: links.candidate.length,
      candidateAdminOnly: links.candidate.length,
    },
    law: {
      publicConfirmedLawTagRows: staged.all.filter((s) => s.isPublic && s.lawSearchAllowed && s.lawTagsConfirmed).length,
      candidateLawTagRows: staged.all.filter((s) => s.lawTagsCandidate).length,
    },
    taxonomyReference,
  };
}

export async function stageAndAnalyze(): Promise<{
  staged: Awaited<ReturnType<typeof stageAllContent>>;
  links: Awaited<ReturnType<typeof stageLinks>>;
  analysis: Analysis;
}> {
  const staged = await stageAllContent();
  const links = await stageLinks();
  const analysis = analyze(staged, links);
  return { staged, links, analysis };
}

export function actionCounts(rows: StagedContent[]): Record<string, number> {
  return countBy(rows, (row) => row.importAction ?? "(blank)");
}

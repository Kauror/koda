/**
 * Shared logic for the **v1** Koda app-import package (production source of truth).
 *
 * The active source package is:
 *   - koda_opinions_v1_3_URL_MATCHED.xlsx  sheet `opinions_app_import`   750 rows
 *   - koda_web_content_v1_2.xlsx           sheet `web_app_import`       1009 rows
 *   - koda_toovoidud_v1_3_URL_MATCHED.xlsx sheet `toovoidud_app_import`   90 rows
 *   - koda_content_links_v1_3.xlsx         cross-layer relation/manifest workbook
 *   - koda_taxonomy_rules_v1_1.txt         taxonomy reference only — never imported
 *
 * Total importable content rows = 1849. The `excluded_rows` /
 * `*_excluded_review` sheets and the candidate/blocked/missing link sheets are
 * never imported as public content or public relations.
 *
 * The v1 import sheets are "slim": every row in an import sheet has already
 * passed the producer's QA gate (the layer import flag is TRUE), so the public
 * gate here is deliberately simple and defensive — see computeVisibility().
 *
 * Column names can drift slightly between producer revisions, so all field
 * reads go through alias-based helpers (firstPresent / requiredField). Genuinely
 * required public fields (id, title, summary) fail fast with a clear error.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import * as XLSX from "xlsx";
import { contentHash, normalizeTitle } from "../../src/lib/hash";
import { splitTopics } from "../../src/lib/taxonomy-split";
import { normalizeTopicLabel } from "../../src/lib/topics";
import { normalizeRecipient } from "../../src/lib/recipient";
import {
  DEFAULT_DISPLAY_TYPE,
  DEFAULT_ROW_ORIGIN,
  isNestedDisplay,
  isStandaloneDisplay,
  isValidDisplayType,
  isValidRowOrigin,
  resolveWorkWinNesting,
  type WorkWinNestingInput,
} from "../../src/lib/work-win-nesting";

export const IMPORT_DIR = resolve(process.cwd(), "data", "import");

export type DatasetKey = "web" | "opinions" | "toovoidud";

/** v1 production source files. Listed as alias arrays for resilience. */
export const FILES = {
  opinions: [
    "koda_opinions_v1_3_URL_MATCHED.xlsx",
    "koda_opinions_v1_1_SOURCE_REPAIR_PATCH_05_REMAINING_88.xlsx",
    "koda_opinions_v1_1.xlsx",
    "koda_opinions_v1.1.xlsx",
    "koda_opinions_v1.0.xlsx",
    "koda_opinions_v1_0.xlsx",
  ],
  web: [
    "koda_web_content_v1_2.xlsx",
    "koda_web_content_v1_1_SOURCE_REPAIR_PATCH_05_REMAINING_88.xlsx",
    "koda_web_content_v1_1.xlsx",
    "koda_web_content_v1.1.xlsx",
    "koda_web_content_v1.xlsx",
  ],
  // v1.2 backfill: the slim töövõidud workbook (122 rows incl. nested/timeline)
  // supersedes the v1.3 URL-matched file (90 rows). Older files kept as fallbacks.
  toovoidud: [
    "koda_toovoidud_v1_5_APP_IMPORT_SLIM.xlsx",
    "koda_toovoidud_v1.5.xlsx",
    "koda_toovoidud_v1_5.xlsx",
    "koda_toovoidud_v1_3_URL_MATCHED.xlsx",
    "koda_toovoidud_v1_1.xlsx",
    "koda_toovoidud_v1.1.xlsx",
    "koda_toovoidud_v1.xlsx",
  ],
  // v1.4 BACKFILL_UPDATED content-links workbook preferred when present; v1_3 is
  // the current production source.
  links: [
    "koda_content_links_v1_4_BACKFILL_UPDATED.xlsx",
    "koda_content_links_v1_3.xlsx",
    "koda_content_links_v1_2.xlsx",
    "koda_content_links_v1.2.xlsx",
    "koda_content_links_v1.xlsx",
  ],
  taxonomy: [
    "koda_taxonomy_rules_v1_2.txt",
    "koda_taxonomy_rules_v1_1.txt",
    "koda_taxonomy_rules_v1_0.txt",
    "koda_taxonomy_rules_v1.0.txt",
  ],
} as const;

/** v1 import + excluded/review + link sheet names. */
export const SHEETS = {
  opinions: "opinions_app_import",
  opinionsExcluded: "excluded_rows",
  web: "web_app_import",
  webExcluded: "web_excluded_review",
  toovoidud: "toovoidud_app_import",
  toovoidudExcluded: "toovoidud_excluded_review",
  // v1.2: news-only recommendations — important news that must NEVER be imported
  // as töövõidud (kept for the importer's leak guard).
  toovoidudNewsOnly: "news_only_recommendations",
  // Cross-layer link workbook (koda_content_links_v1.xlsx).
  publicRelatedLinks: "public_related_links",
  crossLayerLinks: "cross_layer_links",
  policyThreads: "policy_threads",
  candidateLinks: "candidate_or_review_links",
  blockedLinks: "blocked_or_rejected_links",
  missingTargets: "missing_or_excluded_targets",
  smokeTest: "cross_layer_smoke_test",
  contentManifest: "content_manifest",
} as const;

/**
 * Expected v1 counts. Content-row and excluded-row counts are hard invariants.
 * The public-related-link count is informational only: the exact number comes
 * from the link workbook and must NOT hard-fail unless the workbook's own smoke
 * test reports a blocker (see analyze()).
 */
export const EXPECTED_ROWS = {
  web: 1009,
  opinions: 750,
  toovoidud: 122, // v1.2: 90 original + 18 new standalone + 14 series/nested
  totalImportable: 1881, // 1009 web + 750 opinions + 122 töövõidud
  webExcluded: 123,
  opinionsExcluded: 9,
  toovoidudExcluded: 7,
  toovoidudNewsOnly: 7, // news_only_recommendations (never imported as töövõidud)
  // v1.2 row_origin breakdown of the 122 töövõit import rows.
  toovoidudOriginal90: 90,
  toovoidudPhase2Standalone: 18,
  toovoidudSeriesNested: 14,
  publicRelatedLinks: 166, // koda_content_links_v1_3.xlsx
  policyThreads: 148,
  publicPolicyThreads: 140,
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

// ---------------------------------------------------------------------------
// Cell + alias helpers
// ---------------------------------------------------------------------------

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

/** First non-empty value among the given column aliases, trimmed; "" if none. */
export function firstPresent(row: Row, keys: readonly string[]): string {
  for (const k of keys) {
    const v = cellText(row[k]);
    if (v !== "") return v;
  }
  return "";
}

/** Like firstPresent but throws a clear validation error when nothing is found. */
export function requiredField(row: Row, keys: readonly string[], context: string): string {
  const v = firstPresent(row, keys);
  if (v === "") {
    throw new Error(`Missing required field for ${context}: expected one of [${keys.join(", ")}]`);
  }
  return v;
}

/** Boolean parser tolerant of TRUE/True/1/yes/jah and numeric 1/0. */
export function parseBoolFlexible(value: unknown): boolean {
  const s = cellText(value).trim().toLowerCase();
  return ["true", "1", "1.0", "yes", "y", "jah"].includes(s);
}

/** Back-compat alias used by older call sites. */
export const parseBool = parseBoolFlexible;

export function parseYear(s: string): number | null {
  const m = s.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Date parser tolerant of ISO (2016-12-01), dotted EE (01.12.2016), slashed,
 * year-only (2016 → 1 Jan) and Date objects. Returns null when unparseable.
 * Year-only values are returned as the 1 Jan of that year; callers must use the
 * accompanying *date precision* to avoid rendering a precise day.
 */
export function parseDateFlexible(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = cellText(value);
  if (!s) return null;
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const dotted = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) return new Date(Date.UTC(+dotted[3], +dotted[2] - 1, +dotted[1]));
  const slashed = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashed) return new Date(Date.UTC(+slashed[3], +slashed[1] - 1, +slashed[2]));
  const monthOnly = s.match(/^(\d{4})-(\d{1,2})$/);
  if (monthOnly) return new Date(Date.UTC(+monthOnly[1], +monthOnly[2] - 1, 1));
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) return new Date(Date.UTC(+yearOnly[1], 0, 1));
  return null;
}

/** Back-compat alias. */
export const parseDate = parseDateFlexible;

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

export function readSheet(fileNames: readonly string[], sheetName: string): { headers: string[]; rows: Row[] } {
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

export function sheetNames(fileNames: readonly string[]): string[] {
  const path = resolveImportFile(fileNames);
  return XLSX.readFile(path, { bookSheets: true }).SheetNames;
}

export function hasSheet(fileNames: readonly string[], sheetName: string): boolean {
  return sheetNames(fileNames).includes(sheetName);
}

// ---------------------------------------------------------------------------
// Staged content model
// ---------------------------------------------------------------------------

export type CompatSourceType = "opinion" | "news" | "achievement" | "unknown";

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
  // v1 date safety fields (töövõidud, but stored for all layers).
  displayDatePrecision: string | null; // day | month | year
  dateConfidence: string | null; // high | medium | low | unverified
  dateBasis: string | null; // machine reason
  effectiveDate: Date | null; // legal effective date (NOT achievement date)
  deadlineDate: Date | null; // future compliance/deadline date
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
  // v1 visibility / ranking fields (web; null elsewhere).
  contentRoleFinal: string | null;
  publicActivityFilterTags: string | null;
  publicActivityDisplayTags: string | null;
  publicSectorPageAllowed: string | null; // TRUE | LIMITED | FALSE
  sectorResultEligibility: string | null;
  generalSearchEligibility: string | null;
  recommendedAppVisibilityFinal: string | null;
  publicSectorRankScore: number | null;
  generalSearchRankScore: number | null;
  // Töövõidu value fields.
  whatChangedEt: string | null;
  kodaRoleEt: string | null;
  businessValueEt: string | null;
  beforeAfterEt: string | null;
  workWinTypePrimary: string | null;
  workWinTypeSecondary: string | null;
  // Policy thread identity (preserved across layers).
  canonicalPolicyThreadId: string | null;
  policyThreadId: string | null;
  // v1.2 töövõidud nesting / timeline fields (null for web/opinions).
  rowOrigin: string | null;
  displayType: string | null;
  parentToovoitId: string | null;
  parentCandidateId: string | null;
  policyThreadKey: string | null;
  policyThreadTitle: string | null;
  timelineYear: number | null;
  timelineStage: string | null;
  // Import / review gating.
  importEligible: boolean; // the layer-specific v1 import flag (TRUE)
  importAction: string | null;
  publicDisplayStatus: string | null;
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
  // Recipient / ministry metadata (never affects topic).
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
> & { hashText: string | null };

/**
 * Topic labels (valdkonnad) the importer could not map to a canonical taxonomy
 * topic. Kept as internal classification but never exposed as public filters.
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
 * Map recipient/ministry columns to normalized metadata. v1 opinions carry
 * `recipient` / `recipient_filter_group` / `recipient_type`; older revisions
 * used `recipient_raw` / `recipient_normalized`. Recipient is an advanced-filter
 * dimension only — it never feeds topic classification.
 */
function recipientFields(r: Row): RecipientFields {
  const raw = firstPresent(r, ["recipient_raw", "recipient"]);
  const norm = normalizeRecipient(raw, {
    normalized: orNull(firstPresent(r, ["recipient_normalized"])),
    filterGroup: orNull(firstPresent(r, ["recipient_filter_group"])),
    type: orNull(firstPresent(r, ["recipient_type"])),
  });
  const reviewCol = firstPresent(r, ["recipient_normalization_review_required"]);
  return {
    recipientRaw: norm?.raw ?? orNull(raw),
    recipientNormalized: norm?.normalized ?? null,
    recipientFilterGroup: norm?.filterGroup ?? null,
    recipientType: norm?.type ?? null,
    recipientSecondary: orNull(firstPresent(r, ["recipient_secondary"])),
    recipientNormalizationReviewRequired: reviewCol ? parseBoolFlexible(reviewCol) : norm?.reviewRequired ?? false,
  };
}

/** Topic tags: canonicalize labels (aliases fold in), record unknowns. */
function makeTopicTags(primary: string | null, secondary: string | null): string[] {
  const raw = [...new Set([...splitTopics(primary ?? ""), ...splitTopics(secondary ?? "")])];
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

/**
 * Activity (tegevusala) tags. Built from the app-safe public activity tags when
 * present (web), else from activity_primary/secondary (opinions/töövõidud). The
 * cross-sector label IS kept here for search/ranking matching (it is stripped at
 * display time by activities.ts), so it must NOT be filtered out at import.
 */
function makeActivityTags(...values: Array<string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const label of splitTopics(value ?? "")) {
      if (!seen.has(label)) {
        seen.add(label);
        out.push(label);
      }
    }
  }
  return out;
}

function toIntOrNull(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

type NestingFields = Pick<
  StagedContent,
  | "rowOrigin"
  | "displayType"
  | "parentToovoitId"
  | "parentCandidateId"
  | "policyThreadKey"
  | "policyThreadTitle"
  | "timelineYear"
  | "timelineStage"
>;

/** Non-töövõit layers carry no nesting fields. */
function emptyNestingFields(): NestingFields {
  return {
    rowOrigin: null,
    displayType: null,
    parentToovoitId: null,
    parentCandidateId: null,
    policyThreadKey: null,
    policyThreadTitle: null,
    timelineYear: null,
    timelineStage: null,
  };
}

/**
 * v1.2 töövõidud nesting columns. Backward-compat: a töövõit row from an older
 * file with no display_type/row_origin defaults to a plain standalone original-90
 * card, so legacy data still imports as normal top-level work-win cards.
 */
function toovoitNestingFields(r: Row): NestingFields {
  return {
    rowOrigin: firstPresent(r, ["row_origin"]) || DEFAULT_ROW_ORIGIN,
    displayType: firstPresent(r, ["display_type"]) || DEFAULT_DISPLAY_TYPE,
    parentToovoitId: orNull(firstPresent(r, ["parent_toovoit_id"])),
    parentCandidateId: orNull(firstPresent(r, ["parent_candidate_id"])),
    policyThreadKey: orNull(firstPresent(r, ["policy_thread_key"])),
    policyThreadTitle: orNull(firstPresent(r, ["policy_thread_title"])),
    timelineYear: toIntOrNull(firstPresent(r, ["timeline_year"])),
    timelineStage: orNull(firstPresent(r, ["timeline_stage"])),
  };
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

// ---------------------------------------------------------------------------
// Per-layer staging (v1 field mapping with aliases)
// ---------------------------------------------------------------------------

export function stageWebRow(r: Row): StagedContent {
  const externalId = requiredField(r, ["web_content_id", "content_id"], "web row id");
  const title = requiredField(r, ["title", "page_title", "canonical_url", "url"], `web ${externalId} title`);
  const topicPrimary = orNull(firstPresent(r, ["topic_primary"]));
  const topicSecondary = orNull(firstPresent(r, ["topic_secondary"]));
  const lawTagsConfirmed = orNull(firstPresent(r, ["law_tags_confirmed"]));
  // v1: prefer the curated app summary; never use lead_text / first paragraph.
  const summary = orNull(firstPresent(r, ["app_public_summary_ee", "article_summary"]));
  const sourceEvidence = orNull(firstPresent(r, ["evidence_short", "law_evidence_text"]));
  // v1 app-safe activity tags (filter form drives search; display form is for UI).
  // The curated `public_activity_filter_tags` is the ONLY source of web activity:
  // we never fall back to raw activity_primary/secondary, so rows the producer
  // intentionally cleared (e.g. organization news such as the Oliver Väärtnõu
  // appointment, public_sector_page_allowed=FALSE) get NO sector relationship.
  const filterTags = orNull(firstPresent(r, ["public_activity_filter_tags"]));
  const displayTags = orNull(firstPresent(r, ["public_activity_display_tags"]));
  const filterTagList = splitTopics(filterTags ?? "");
  const activityPrimary = filterTagList[0] ?? null;
  const activitySecondary = filterTagList.length > 1 ? filterTagList.slice(1).join("; ") : null;
  const contentRoleFinal = orNull(firstPresent(r, ["content_role_final", "content_role", "web_content_role"]));
  const bodyText = joinSearchText([summary, sourceEvidence, topicPrimary, topicSecondary, activityPrimary, activitySecondary, lawTagsConfirmed]);

  return finalize({
    externalId,
    sourceDataset: "web",
    sourceLayer: "koda_news",
    sourceTypeDetail: "meie_uudis",
    sourceType: "news",
    sourceUrl: orNull(firstPresent(r, ["url"])),
    canonicalUrl: orNull(firstPresent(r, ["canonical_url"])),
    title,
    displayTitle: title,
    date: parseDateFlexible(firstPresent(r, ["sort_date", "published_date", "document_date", "updated_date"])),
    year: parseYear(firstPresent(r, ["source_year", "published_date", "sort_date"])),
    reportYear: null,
    displayDatePrecision: null,
    dateConfidence: orNull(firstPresent(r, ["date_confidence"])),
    dateBasis: null,
    effectiveDate: null,
    deadlineDate: null,
    sourceFileName: null,
    sourceSection: orNull(firstPresent(r, ["source_type"])),
    sourcePageLocation: null,
    bodyText,
    excerpt: summary,
    summary,
    kodaPosition: orNull(firstPresent(r, ["stance"])),
    companyRelevance: orNull(firstPresent(r, ["value_type"])),
    sourceEvidence,
    outcomeStatus: null,
    contentRoleFinal,
    publicActivityFilterTags: filterTags,
    publicActivityDisplayTags: displayTags,
    publicSectorPageAllowed: orNull(firstPresent(r, ["public_sector_page_allowed"])),
    sectorResultEligibility: orNull(firstPresent(r, ["sector_result_eligibility"])),
    generalSearchEligibility: orNull(firstPresent(r, ["general_search_eligibility"])),
    recommendedAppVisibilityFinal: orNull(firstPresent(r, ["recommended_app_visibility_final"])),
    publicSectorRankScore: toIntOrNull(firstPresent(r, ["public_sector_rank_score"])),
    generalSearchRankScore: toIntOrNull(firstPresent(r, ["general_search_rank_score"])),
    whatChangedEt: null,
    kodaRoleEt: null,
    businessValueEt: null,
    beforeAfterEt: null,
    workWinTypePrimary: orNull(firstPresent(r, ["work_win_type_primary"])),
    workWinTypeSecondary: orNull(firstPresent(r, ["work_win_type_secondary"])),
    canonicalPolicyThreadId: orNull(firstPresent(r, ["canonical_policy_thread_id", "canonical_policy_thread_id_provisional"])),
    policyThreadId: orNull(firstPresent(r, ["policy_thread_id"])),
    ...emptyNestingFields(),
    importEligible: parseBoolFlexible(firstPresent(r, ["final_web_import_candidate"])),
    importAction: orNull(firstPresent(r, ["final_web_import_decision", "import_action"])),
    publicDisplayStatus: orNull(firstPresent(r, ["recommended_app_visibility_final", "public_display_status"])),
    needsHumanReview: parseBoolFlexible(firstPresent(r, ["review_required", "final_web_import_review_required"])),
    numericClaimNeedsReview: parseBoolFlexible(firstPresent(r, ["numeric_claim_needs_review"])),
    reviewReason: orNull(firstPresent(r, ["review_reason", "final_web_import_review_reason"])),
    publicPriority: null,
    sourceQualityFlag: orNull(firstPresent(r, ["source_quality_flag"])),
    classificationConfidence: orNull(firstPresent(r, ["classification_confidence"])),
    primaryCategory: topicPrimary,
    secondaryCategories: topicSecondary,
    topicGroupCandidate: orNull(firstPresent(r, ["canonical_policy_thread_id", "canonical_policy_thread_id_provisional"])),
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    sectorScope: orNull(firstPresent(r, ["sector_scope"])),
    situationTags: orNull(firstPresent(r, ["situation_tags"])),
    lawTagsConfirmed,
    lawTagsCandidate: orNull(firstPresent(r, ["law_tags_candidate"])),
    lawSearchAllowed: !!lawTagsConfirmed && firstPresent(r, ["law_match_confidence"]).toLowerCase() !== "low",
    canonicalContentId: orNull(firstPresent(r, ["duplicate_of_web_content_id"])),
    duplicateStatus: orNull(firstPresent(r, ["duplicate_status"])),
    isEvergreen: false,
    ...recipientFields(r),
    valdkonnad: makeTopicTags(topicPrimary, topicSecondary),
    // Search/ranking activity tags from the curated filter tags only (cross-sector
    // kept for matching; empty filter tags ⇒ no sector tags at all).
    tegevusalad: makeActivityTags(filterTags ?? ""),
    tapsustused: splitMulti(firstPresent(r, ["situation_tags"])),
    oigusaktid: splitMulti(lawTagsConfirmed ?? ""),
    matchedWebContentId: null,
    matchedOpinionContentId: null,
    hashText: bodyText,
  });
}

export function stageOpinionRow(r: Row): StagedContent {
  const externalId = requiredField(r, ["content_id", "opinion_content_id"], "opinion row id");
  const title = requiredField(
    r,
    ["title", "title_extracted_from_pdf", "source_file_name", "source_file"],
    `opinion ${externalId} title`
  );
  const topicPrimary = orNull(firstPresent(r, ["topic_primary"]));
  const topicSecondary = orNull(firstPresent(r, ["topic_secondary"]));
  const activityPrimary = orNull(firstPresent(r, ["activity_primary"]));
  const activitySecondary = orNull(firstPresent(r, ["activity_secondary"]));
  const lawTagsConfirmed = orNull(firstPresent(r, ["law_tags_confirmed"]));
  // v1 slim sheet uses `public_summary` (= executive_summary_ee_final).
  const summary = orNull(
    firstPresent(r, ["public_summary", "executive_summary_ee_final", "first_substantive_paragraph_corrected", "first_substantive_paragraph"])
  );
  const sourceEvidence = orNull(firstPresent(r, ["evidence_short", "summary_evidence_note", "evidence_quote_1", "law_evidence_text"]));
  const bodyText = joinSearchText([
    summary,
    sourceEvidence,
    firstPresent(r, ["key_points", "chamber_position", "why_it_matters"]) || null,
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    lawTagsConfirmed,
  ]);

  return finalize({
    externalId,
    sourceDataset: "opinions",
    sourceLayer: "koda_public_opinion",
    sourceTypeDetail: "meie_arvamus_article",
    sourceType: "opinion",
    sourceUrl: orNull(firstPresent(r, ["related_koda_news_url"])),
    canonicalUrl: null,
    title,
    displayTitle: title,
    date: parseDateFlexible(firstPresent(r, ["document_date", "sort_date"])),
    year: parseYear(firstPresent(r, ["source_year", "document_date", "sort_date"])),
    reportYear: null,
    displayDatePrecision: null,
    dateConfidence: null,
    dateBasis: null,
    effectiveDate: null,
    deadlineDate: null,
    sourceFileName: orNull(firstPresent(r, ["source_file", "source_file_name"])),
    sourceSection: orNull(firstPresent(r, ["source_section"])),
    sourcePageLocation: null,
    bodyText,
    excerpt: summary,
    summary,
    kodaPosition: orNull(firstPresent(r, ["chamber_position", "stance"])),
    companyRelevance: orNull(firstPresent(r, ["business_impact", "value_type"])),
    sourceEvidence,
    outcomeStatus: null,
    contentRoleFinal: null,
    publicActivityFilterTags: null,
    publicActivityDisplayTags: null,
    publicSectorPageAllowed: null,
    sectorResultEligibility: null,
    generalSearchEligibility: null,
    recommendedAppVisibilityFinal: null,
    publicSectorRankScore: null,
    generalSearchRankScore: null,
    whatChangedEt: null,
    kodaRoleEt: orNull(firstPresent(r, ["koda_request", "chamber_position"])),
    businessValueEt: orNull(firstPresent(r, ["business_impact"])),
    beforeAfterEt: null,
    workWinTypePrimary: null,
    workWinTypeSecondary: null,
    canonicalPolicyThreadId: orNull(firstPresent(r, ["canonical_policy_thread_id"])),
    policyThreadId: orNull(firstPresent(r, ["policy_thread_id"])),
    ...emptyNestingFields(),
    importEligible: parseBoolFlexible(firstPresent(r, ["final_app_import_eligible"])),
    importAction: orNull(firstPresent(r, ["readiness", "import_action"])),
    publicDisplayStatus: orNull(firstPresent(r, ["readiness", "public_display_status"])),
    needsHumanReview: parseBoolFlexible(firstPresent(r, ["review_required"])) || !parseBoolFlexibleDefaultTrue(r, "final_quality_passed"),
    numericClaimNeedsReview: parseBoolFlexible(firstPresent(r, ["numeric_claim_needs_review"])),
    reviewReason: orNull(firstPresent(r, ["review_reason"])),
    publicPriority: null,
    sourceQualityFlag: orNull(firstPresent(r, ["source_quality_flag"])),
    classificationConfidence: orNull(firstPresent(r, ["classification_confidence"])),
    primaryCategory: topicPrimary,
    secondaryCategories: topicSecondary,
    topicGroupCandidate: orNull(firstPresent(r, ["canonical_policy_thread_id"])),
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    sectorScope: orNull(firstPresent(r, ["sector_scope"])),
    situationTags: orNull(firstPresent(r, ["situation_tags"])),
    lawTagsConfirmed,
    lawTagsCandidate: orNull(firstPresent(r, ["law_tags_candidate"])),
    lawSearchAllowed: !!lawTagsConfirmed && !["low", "none"].includes(firstPresent(r, ["law_match_confidence"]).toLowerCase()),
    canonicalContentId: null,
    duplicateStatus: null,
    isEvergreen: false,
    ...recipientFields(r),
    valdkonnad: makeTopicTags(topicPrimary, topicSecondary),
    tegevusalad: makeActivityTags(activityPrimary, activitySecondary),
    tapsustused: splitMulti(firstPresent(r, ["situation_tags"])),
    oigusaktid: splitMulti(lawTagsConfirmed ?? ""),
    matchedWebContentId: orNull(firstPresent(r, ["related_koda_news_content_id"])),
    matchedOpinionContentId: null,
    hashText: bodyText,
  });
}

/** Helper: a 0/1/TRUE QA-pass column defaults to "passed" when absent. */
function parseBoolFlexibleDefaultTrue(r: Row, key: string): boolean {
  const v = firstPresent(r, [key]);
  return v === "" ? true : parseBoolFlexible(v);
}

export function stageToovoitRow(r: Row): StagedContent {
  const externalId = requiredField(r, ["toovoit_id", "work_win_id"], "töövõit row id");
  // v1.5 slim sheet uses work_win_title_ee; older revisions used title_public/etc.
  // Never fall back to source_title silently (that is the news article title).
  const title = requiredField(
    r,
    ["work_win_title_ee", "work_win_title_public", "public_title", "title", "source_title"],
    `töövõit ${externalId} title`
  );
  const topicPrimary = orNull(firstPresent(r, ["topic_primary"]));
  const topicSecondary = orNull(firstPresent(r, ["topic_secondary"]));
  const activityPrimary = orNull(firstPresent(r, ["activity_primary"]));
  const activitySecondary = orNull(firstPresent(r, ["activity_secondary"]));
  const lawTagsConfirmed = orNull(firstPresent(r, ["law_tags_confirmed"]));
  const summary = orNull(firstPresent(r, ["work_win_summary_ee", "app_public_summary", "public_summary", "summary"]));
  const whatChangedEt = orNull(firstPresent(r, ["what_changed_ee"]));
  const kodaRoleEt = orNull(firstPresent(r, ["koda_role_ee"]));
  const businessValueEt = orNull(firstPresent(r, ["business_value_ee"]));
  const beforeAfterEt = orNull(firstPresent(r, ["before_after_ee"]));
  const sourceEvidence = orNull(firstPresent(r, ["source_match_evidence", "evidence_short", "law_evidence_text"]));
  const bodyText = joinSearchText([
    summary,
    whatChangedEt,
    businessValueEt,
    kodaRoleEt,
    sourceEvidence,
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    lawTagsConfirmed,
  ]);

  return finalize({
    externalId,
    sourceDataset: "toovoidud",
    sourceLayer: "koda_achievement",
    sourceTypeDetail: "toovoit",
    sourceType: "achievement",
    // Use a specific public source URL; do not fall back to the generic listing page here.
    // v1.5 slim sheet provides evidence_source_url / public_detail_url (specific koda.ee articles).
    sourceUrl: orNull(
      firstPresent(r, [
        "evidence_source_url",
        "public_detail_url",
        "primary_work_win_source_url",
        "source_url",
        "matched_web_url",
      ])
    ),
    canonicalUrl: null,
    title,
    displayTitle: title,
    // Achievement display date is display_date/source_date (+ precision). effective/deadline kept separate.
    date: parseDateFlexible(firstPresent(r, ["display_date", "source_date", "achievement_year", "source_year"])),
    // Year falls back to timeline_year so the 28 dateless v1.5 rows still show a year.
    year: parseYear(firstPresent(r, ["achievement_year", "source_year", "timeline_year", "source_date", "display_date"])),
    reportYear: null,
    displayDatePrecision: orNull(firstPresent(r, ["display_date_precision"])),
    dateConfidence: orNull(firstPresent(r, ["date_confidence"])),
    dateBasis: orNull(firstPresent(r, ["date_basis"])),
    effectiveDate: parseDateFlexible(firstPresent(r, ["effective_date"])),
    deadlineDate: parseDateFlexible(firstPresent(r, ["deadline_date"])),
    sourceFileName: null,
    sourceSection: orNull(firstPresent(r, ["primary_work_win_source"])),
    sourcePageLocation: null,
    bodyText,
    excerpt: summary,
    summary,
    kodaPosition: kodaRoleEt,
    companyRelevance: orNull(firstPresent(r, ["business_value_ee", "affected_company_profile", "beneficiary_scope"])),
    sourceEvidence,
    outcomeStatus: orNull(firstPresent(r, ["work_win_status"])),
    contentRoleFinal: null,
    publicActivityFilterTags: orNull(firstPresent(r, ["public_activity_filter_tags"])),
    publicActivityDisplayTags: orNull(firstPresent(r, ["public_activity_display_tags"])),
    publicSectorPageAllowed: null,
    sectorResultEligibility: null,
    generalSearchEligibility: null,
    recommendedAppVisibilityFinal: null,
    publicSectorRankScore: null,
    generalSearchRankScore: null,
    whatChangedEt,
    kodaRoleEt,
    businessValueEt,
    beforeAfterEt,
    workWinTypePrimary: orNull(firstPresent(r, ["work_win_type_primary"])),
    workWinTypeSecondary: orNull(firstPresent(r, ["work_win_type_secondary"])),
    canonicalPolicyThreadId: orNull(firstPresent(r, ["canonical_policy_thread_id"])),
    policyThreadId: orNull(firstPresent(r, ["policy_thread_id"])),
    ...toovoitNestingFields(r),
    // v1.5 slim sheet gates on import_ready (TRUE); older revisions used work_win_import_candidate.
    importEligible: parseBoolFlexible(firstPresent(r, ["import_ready", "work_win_import_candidate", "final_work_win_import_candidate"])),
    importAction: orNull(firstPresent(r, ["import_action"])),
    publicDisplayStatus: orNull(firstPresent(r, ["work_win_public_readiness", "public_display_status"])),
    needsHumanReview: parseBoolFlexible(firstPresent(r, ["review_required", "work_win_review_required"])),
    numericClaimNeedsReview: parseBoolFlexible(firstPresent(r, ["numeric_claim_needs_review"])),
    reviewReason: orNull(firstPresent(r, ["review_reason", "work_win_review_reason", "public_block_reason"])),
    publicPriority: null,
    sourceQualityFlag: orNull(firstPresent(r, ["source_quality_flag"])),
    classificationConfidence: orNull(firstPresent(r, ["classification_confidence"])),
    primaryCategory: topicPrimary,
    secondaryCategories: topicSecondary,
    topicGroupCandidate: orNull(firstPresent(r, ["canonical_policy_thread_id"])),
    topicPrimary,
    topicSecondary,
    activityPrimary,
    activitySecondary,
    sectorScope: orNull(firstPresent(r, ["sector_scope"])),
    situationTags: orNull(firstPresent(r, ["situation_tags"])),
    lawTagsConfirmed,
    lawTagsCandidate: orNull(firstPresent(r, ["law_tags_candidate"])),
    lawSearchAllowed: !!lawTagsConfirmed,
    canonicalContentId: orNull(firstPresent(r, ["canonical_toovoit_id"])),
    duplicateStatus: parseBoolFlexible(firstPresent(r, ["is_duplicate"])) ? "possible_duplicate" : null,
    isEvergreen: true,
    ...recipientFields(r),
    valdkonnad: makeTopicTags(topicPrimary, topicSecondary),
    tegevusalad: makeActivityTags(firstPresent(r, ["public_activity_filter_tags"]) || `${activityPrimary ?? ""};${activitySecondary ?? ""}`),
    tapsustused: splitMulti(firstPresent(r, ["situation_tags"])),
    oigusaktid: splitMulti(lawTagsConfirmed ?? ""),
    matchedWebContentId: orNull(firstPresent(r, ["matched_web_content_id"])),
    matchedOpinionContentId: orNull(firstPresent(r, ["matched_opinion_content_id"])),
    hashText: bodyText,
  });
}

/**
 * v1 public gate. A staged import-sheet row is public when:
 *   1. it is in the official import sheet (guaranteed — we only stage those);
 *   2. the layer-specific import flag is TRUE;
 *   3. a public summary exists;
 *   4. no explicit human-review/blocked flag is set.
 * Excluded/review-sheet rows are never staged here, so (the spec's "not in
 * excluded sheet") holds by construction.
 *
 * Note: `numeric_claim_needs_review` is NOT a publish blocker in v1. It is a
 * producer-side diagnostic; the layer import flag (final_web_import_candidate /
 * final_app_import_eligible / work_win_import_candidate) is the authoritative
 * final gate and already incorporates it, so rows kept in the import sheet are
 * public. The flag is still stored on the row for audit.
 */
export function computeVisibility(s: StagedContent): boolean {
  if (!s.importEligible) return false;
  if (!s.summary || s.summary.trim() === "") return false;
  if (s.needsHumanReview) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Staging entry points
// ---------------------------------------------------------------------------

export function stageAllContent(): {
  web: StagedContent[];
  opinions: StagedContent[];
  toovoidud: StagedContent[];
  all: StagedContent[];
} {
  const web = readSheet(FILES.web, SHEETS.web).rows.map(stageWebRow);
  const opinions = readSheet(FILES.opinions, SHEETS.opinions).rows.map(stageOpinionRow);
  const toovoidud = readSheet(FILES.toovoidud, SHEETS.toovoidud).rows.map(stageToovoitRow);
  return { web, opinions, toovoidud, all: [...web, ...opinions, ...toovoidud] };
}

/** Ids present in each excluded/review sheet (never public content). */
export function stageExcludedIds(): { web: string[]; opinions: string[]; toovoidud: string[] } {
  const ids = (file: readonly string[], sheet: string, key: readonly string[]): string[] => {
    if (!hasSheet(file, sheet)) return [];
    return readSheet(file, sheet).rows.map((r) => firstPresent(r, key)).filter(Boolean);
  };
  return {
    web: ids(FILES.web, SHEETS.webExcluded, ["web_content_id", "content_id"]),
    opinions: ids(FILES.opinions, SHEETS.opinionsExcluded, ["content_id"]),
    // v1.5 slim excluded/review sheet keys rows by excluded_row_id (not toovoit_id).
    toovoidud: ids(FILES.toovoidud, SHEETS.toovoidudExcluded, ["excluded_row_id", "candidate_id", "toovoit_id"]),
  };
}

/**
 * Candidate ids on the `news_only_recommendations` sheet. These are important
 * news rows that must NEVER be imported as töövõidud (taxonomy v1.2 §28.6/§28.8).
 * Returned so the importer can assert none leaked into the töövõit import sheet.
 */
export function stageNewsOnlyToovoitIds(): string[] {
  if (!hasSheet(FILES.toovoidud, SHEETS.toovoidudNewsOnly)) return [];
  return readSheet(FILES.toovoidud, SHEETS.toovoidudNewsOnly)
    .rows.map((r) => firstPresent(r, ["candidate_id", "toovoit_id", "id"]))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Cross-layer link workbook (koda_content_links_v1.xlsx)
// ---------------------------------------------------------------------------

/** A public "Veel samal teemal" / evidence relation (source → target). */
export type PublicRelatedLink = {
  sourceContentId: string;
  sourceLayer: string;
  targetContentId: string;
  targetLayer: string;
  relationRole: string | null;
  relationLabelEt: string | null;
  canonicalPolicyThreadId: string | null;
  linkConfidence: string | null;
  linkBasis: string | null;
  sortPriority: number | null;
};

export type PolicyThread = {
  id: string;
  title: string;
  summary: string | null;
  representativeContentId: string | null;
  memberIds: string[];
  topicPrimary: string | null;
  topicSecondary: string | null;
  publicThreadEligible: boolean;
};

export type SmokeTestRow = {
  testId: string;
  testName: string;
  status: string;
  issueCount: number;
  severity: string;
  actionRequired: string;
  notes: string;
};

export type LinkWorkbook = {
  publicRelated: PublicRelatedLink[];
  policyThreads: PolicyThread[];
  smokeTest: SmokeTestRow[];
  counts: {
    publicRelated: number;
    crossLayer: number;
    policyThreads: number;
    candidate: number;
    blocked: number;
    missingTargets: number;
  };
};

const ACCEPTABLE_LINK_CONFIDENCE = new Set(["high", "curated_medium"]);

export function stagePublicRelatedLink(r: Row): PublicRelatedLink {
  return {
    sourceContentId: firstPresent(r, ["source_content_id"]),
    sourceLayer: firstPresent(r, ["source_layer"]),
    targetContentId: firstPresent(r, ["target_content_id"]),
    targetLayer: firstPresent(r, ["target_layer"]),
    relationRole: orNull(firstPresent(r, ["relationship_role", "relation_type"])),
    relationLabelEt: orNull(firstPresent(r, ["app_relation_label_ee", "relation_type"])),
    canonicalPolicyThreadId: orNull(firstPresent(r, ["canonical_policy_thread_id"])),
    linkConfidence: orNull(firstPresent(r, ["link_confidence", "related_confidence"])),
    linkBasis: orNull(firstPresent(r, ["link_basis", "related_basis"])),
    sortPriority: toIntOrNull(firstPresent(r, ["sort_priority"])),
  };
}

export function stagePolicyThread(r: Row): PolicyThread {
  return {
    id: firstPresent(r, ["canonical_policy_thread_id", "policy_thread_id"]),
    title: firstPresent(r, ["thread_title"]),
    summary: orNull(firstPresent(r, ["thread_summary"])),
    representativeContentId: orNull(firstPresent(r, ["representative_content_id"])),
    memberIds: splitMulti(firstPresent(r, ["thread_member_ids_public_valid"])),
    topicPrimary: orNull(firstPresent(r, ["thread_topic_primary"])),
    topicSecondary: orNull(firstPresent(r, ["thread_topic_secondary"])),
    publicThreadEligible: parseBoolFlexible(firstPresent(r, ["public_thread_eligible"])) && !parseBoolFlexible(firstPresent(r, ["thread_review_required"])),
  };
}

function countSheet(file: readonly string[], sheet: string): number {
  return hasSheet(file, sheet) ? readSheet(file, sheet).rows.length : 0;
}

export function stageLinkWorkbook(): LinkWorkbook {
  const publicRelated = hasSheet(FILES.links, SHEETS.publicRelatedLinks)
    ? readSheet(FILES.links, SHEETS.publicRelatedLinks).rows.map(stagePublicRelatedLink)
    : [];
  const policyThreads = hasSheet(FILES.links, SHEETS.policyThreads)
    ? readSheet(FILES.links, SHEETS.policyThreads).rows.map(stagePolicyThread)
    : [];
  const smokeTest: SmokeTestRow[] = hasSheet(FILES.links, SHEETS.smokeTest)
    ? readSheet(FILES.links, SHEETS.smokeTest).rows.map((r) => ({
        testId: firstPresent(r, ["test_id"]),
        testName: firstPresent(r, ["test_name"]),
        status: firstPresent(r, ["status"]).toUpperCase(),
        issueCount: toIntOrNull(firstPresent(r, ["issue_count"])) ?? 0,
        severity: firstPresent(r, ["severity"]).toLowerCase(),
        actionRequired: firstPresent(r, ["action_required"]),
        notes: firstPresent(r, ["notes"]),
      }))
    : [];
  return {
    publicRelated,
    policyThreads,
    smokeTest,
    counts: {
      publicRelated: publicRelated.length,
      crossLayer: countSheet(FILES.links, SHEETS.crossLayerLinks),
      policyThreads: countSheet(FILES.links, SHEETS.policyThreads),
      candidate: countSheet(FILES.links, SHEETS.candidateLinks),
      blocked: countSheet(FILES.links, SHEETS.blockedLinks),
      missingTargets: countSheet(FILES.links, SHEETS.missingTargets),
    },
  };
}

/** Map a public related link to an evidence-graph linkType by target layer. */
export function evidenceLinkTypeForTarget(targetLayer: string): string {
  switch (targetLayer) {
    case "opinions":
    case "opinion":
      return "related_opinion";
    case "toovoidud":
    case "toovoit":
    case "work_win":
      return "related_work_win";
    case "web":
    default:
      return "related_news";
  }
}

// ---------------------------------------------------------------------------
// Analysis / validation
// ---------------------------------------------------------------------------

export type Issue = { dataset: string; externalId: string; field: string; message: string };

export type Analysis = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  rowCounts: {
    web: number;
    opinions: number;
    toovoidud: number;
    total: number;
    publicRelatedLinks: number;
    crossLayerLinks: number;
    policyThreads: number;
    publicPolicyThreads: number;
    candidateLinks: number;
    blockedLinks: number;
    missingTargets: number;
  };
  excludedCounts: { web: number; opinions: number; toovoidud: number };
  expected: typeof EXPECTED_ROWS;
  totalContentStaged: number;
  visibility: { public: number; hidden: number; needsReview: number; numericReview: number };
  perDataset: Record<string, { total: number; public: number; hidden: number; needsReview: number; achievements: number }>;
  duplicateExternalIds: Record<string, string[]>;
  duplicateContentHashGroups: { hash: string; ids: string[] }[];
  // v1.2 töövõidud nesting / backfill analysis.
  toovoidudOrigins: Record<string, number>;
  nesting: {
    topLevel: number;
    nested: number;
    threads: number;
    unresolved: Issue[]; // nested row with neither a parent nor a policy thread
    invalidDisplayType: Issue[];
    invalidRowOrigin: Issue[];
    invalidParentRefs: Issue[]; // parent_toovoit_id pointing at no imported top-level row
    seriesNotNested: Issue[]; // row_origin=phase2_series_nested but display_type=standalone_card
  };
  newsOnly: { count: number; leakedIntoImport: Issue[] };
  importFlagViolations: Issue[];
  missingRequiredFields: Issue[];
  missingSummaryRows: Issue[];
  rawFragmentSummaryRows: Issue[];
  crossSectorDisplayTagRows: Issue[];
  dateRegressions: { id: string; field: string; value: string; ok: boolean; note: string }[];
  links: {
    publicRelated: number;
    byConfidence: Record<string, number>;
    targetsNotImported: { source: string; target: string }[];
    targetsExcluded: { source: string; target: string }[];
    lowOrRejected: { source: string; target: string; confidence: string }[];
    candidate: number;
    blocked: number;
    missingTargets: number;
  };
  smokeTest: { rows: SmokeTestRow[]; failures: SmokeTestRow[]; blockerFailures: SmokeTestRow[] };
  law: { publicConfirmedLawTagRows: number; candidateLawTagRows: number };
  taxonomyReference: { fileName: string; bytes: number };
};

const REQUIRED_FIELDS: (keyof StagedContent)[] = ["externalId", "title", "summary"];

/** Raw date/title fragment artefacts that must not leak into public summaries. */
const RAW_FRAGMENT_RE = /\b\d{1,2},\d{1,2},\d{2,4}\b/; // e.g. 20,12,2016

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const k = key(value);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function containsCrossSector(value: string | null): boolean {
  if (!value) return false;
  const t = value.toLocaleLowerCase("et-EE");
  return t.includes("kõik tegevusalad") || t.includes("koik tegevusalad") || t.includes("valdkondadeülene") || t.includes("valdkondadeulene");
}

/** Known töövõit date regressions (must stay safe). */
function dateRegressionChecks(toovoidud: StagedContent[]): Analysis["dateRegressions"] {
  const out: Analysis["dateRegressions"] = [];
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const byTitle = (needle: string) =>
    toovoidud.find((s) => s.title.toLocaleLowerCase("et-EE").includes(needle));

  const pandi = byTitle("panditulumaks");
  if (pandi) {
    out.push({
      id: pandi.externalId,
      field: "display_date",
      value: iso(pandi.date),
      ok: iso(pandi.date) !== "2026-06-24",
      note: "panditulumaks must not use 2026-06-24 as display/achievement date",
    });
  }
  const sooline = toovoidud.find((s) => {
    const t = s.title.toLocaleLowerCase("et-EE");
    return t.includes("soolise tasakaalu") || (t.includes("börsiettevõte") && t.includes("aruandlus"));
  });
  if (sooline) {
    out.push({
      id: sooline.externalId,
      field: "display_date",
      value: iso(sooline.date),
      ok: iso(sooline.date) !== "2026-12-31",
      note: "börsiettevõtete soolise tasakaalu töövõit must not use 2026-12-31 as display/achievement date",
    });
    out.push({
      id: sooline.externalId,
      field: "deadline_date",
      value: iso(sooline.deadlineDate),
      ok: sooline.deadlineDate == null || iso(sooline.deadlineDate) === "2026-06-30",
      note: "30.06.2026 must remain a deadline_date, not the achievement/display date",
    });
  }
  return out;
}

/**
 * v1.2 töövõidud nesting validation. Surfaces (loudly, never silently) any:
 *  - unknown display_type / row_origin;
 *  - phase2_series_nested row left as a standalone card;
 *  - nested row whose parent_toovoit_id points at no imported top-level töövõit;
 *  - nested row with neither a parent nor a policy thread (would vanish).
 * Returns the nesting structure counts plus per-issue lists for the report.
 */
function nestingChecks(toovoidud: StagedContent[]): Analysis["nesting"] & { origins: Record<string, number> } {
  const issue = (s: StagedContent, field: string, message: string): Issue => ({
    dataset: "toovoidud",
    externalId: s.externalId,
    field,
    message,
  });

  const origins: Record<string, number> = {};
  for (const s of toovoidud) origins[s.rowOrigin ?? "(none)"] = (origins[s.rowOrigin ?? "(none)"] ?? 0) + 1;

  const invalidDisplayType: Issue[] = [];
  const invalidRowOrigin: Issue[] = [];
  const seriesNotNested: Issue[] = [];
  for (const s of toovoidud) {
    if (!isValidDisplayType(s.displayType)) invalidDisplayType.push(issue(s, "display_type", `unknown display_type "${s.displayType}"`));
    if (!isValidRowOrigin(s.rowOrigin)) invalidRowOrigin.push(issue(s, "row_origin", `unknown row_origin "${s.rowOrigin}"`));
    // §28.10 rule 19: a series/nested row must carry a nested display type.
    if (s.rowOrigin === "phase2_series_nested" && !isNestedDisplay(s.displayType)) {
      seriesNotNested.push(issue(s, "display_type", `phase2_series_nested must use a nested display_type, got "${s.displayType}"`));
    }
  }

  // parent_toovoit_id must point at an imported top-level (standalone) töövõit.
  const topLevelExternalIds = new Set(
    toovoidud.filter((s) => isStandaloneDisplay(s.displayType) && s.externalId).map((s) => s.externalId as string)
  );
  const invalidParentRefs: Issue[] = [];
  for (const s of toovoidud) {
    if (s.parentToovoitId && !topLevelExternalIds.has(s.parentToovoitId)) {
      invalidParentRefs.push(issue(s, "parent_toovoit_id", `parent_toovoit_id "${s.parentToovoitId}" matches no imported top-level töövõit`));
    }
  }

  const nesting = resolveWorkWinNesting(
    toovoidud.map<WorkWinNestingInput>((s) => ({
      id: s.externalId,
      externalId: s.externalId,
      rowOrigin: s.rowOrigin,
      displayType: s.displayType,
      parentToovoitId: s.parentToovoitId,
      parentCandidateId: s.parentCandidateId,
      policyThreadKey: s.policyThreadKey,
      policyThreadTitle: s.policyThreadTitle,
      timelineYear: s.timelineYear,
      timelineStage: s.timelineStage,
    }))
  );
  const unresolved: Issue[] = nesting.unresolved.map((u) => ({
    dataset: "toovoidud",
    externalId: u.externalId ?? "(blank)",
    field: "parent/thread",
    message: "nested row has neither a resolvable parent nor a policy thread",
  }));

  return {
    origins,
    topLevel: nesting.topLevelIds.size,
    nested: nesting.nestedIds.size,
    threads: nesting.threads.length,
    unresolved,
    invalidDisplayType,
    invalidRowOrigin,
    invalidParentRefs,
    seriesNotNested,
  };
}

export function analyze(
  staged: { web: StagedContent[]; opinions: StagedContent[]; toovoidud: StagedContent[]; all: StagedContent[] },
  links: LinkWorkbook,
  excluded: { web: string[]; opinions: string[]; toovoidud: string[] },
  newsOnlyToovoitIds: string[] = []
): Analysis {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rowCounts = {
    web: staged.web.length,
    opinions: staged.opinions.length,
    toovoidud: staged.toovoidud.length,
    total: staged.all.length,
    publicRelatedLinks: links.counts.publicRelated,
    crossLayerLinks: links.counts.crossLayer,
    policyThreads: links.counts.policyThreads,
    candidateLinks: links.counts.candidate,
    blockedLinks: links.counts.blocked,
    missingTargets: links.counts.missingTargets,
    publicPolicyThreads: links.policyThreads.filter((t) => t.publicThreadEligible).length,
  };
  const excludedCounts = { web: excluded.web.length, opinions: excluded.opinions.length, toovoidud: excluded.toovoidud.length };

  // (3) Import-row count invariants (hard).
  if (rowCounts.web !== EXPECTED_ROWS.web) errors.push(`web import rows ${rowCounts.web} != ${EXPECTED_ROWS.web}`);
  if (rowCounts.opinions !== EXPECTED_ROWS.opinions) errors.push(`opinions import rows ${rowCounts.opinions} != ${EXPECTED_ROWS.opinions}`);
  if (rowCounts.toovoidud !== EXPECTED_ROWS.toovoidud) errors.push(`toovoidud import rows ${rowCounts.toovoidud} != ${EXPECTED_ROWS.toovoidud}`);
  if (rowCounts.total !== EXPECTED_ROWS.totalImportable) errors.push(`total importable rows ${rowCounts.total} != ${EXPECTED_ROWS.totalImportable}`);
  if (excludedCounts.web !== EXPECTED_ROWS.webExcluded) warnings.push(`web excluded rows ${excludedCounts.web} != ${EXPECTED_ROWS.webExcluded}`);
  if (excludedCounts.opinions !== EXPECTED_ROWS.opinionsExcluded) warnings.push(`opinions excluded rows ${excludedCounts.opinions} != ${EXPECTED_ROWS.opinionsExcluded}`);
  if (excludedCounts.toovoidud !== EXPECTED_ROWS.toovoidudExcluded) warnings.push(`toovoidud excluded rows ${excludedCounts.toovoidud} != ${EXPECTED_ROWS.toovoidudExcluded}`);

  // Duplicate external IDs (hard).
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

  // (3b) v1.2 töövõidud row_origin breakdown (90 / 18 / 14) — hard invariants.
  const nesting = nestingChecks(staged.toovoidud);
  const toovoidudOrigins = nesting.origins;
  if ((toovoidudOrigins["original_90_locked"] ?? 0) !== EXPECTED_ROWS.toovoidudOriginal90)
    errors.push(`töövõit original_90_locked rows ${toovoidudOrigins["original_90_locked"] ?? 0} != ${EXPECTED_ROWS.toovoidudOriginal90}`);
  if ((toovoidudOrigins["phase2_new_standalone"] ?? 0) !== EXPECTED_ROWS.toovoidudPhase2Standalone)
    errors.push(`töövõit phase2_new_standalone rows ${toovoidudOrigins["phase2_new_standalone"] ?? 0} != ${EXPECTED_ROWS.toovoidudPhase2Standalone}`);
  if ((toovoidudOrigins["phase2_series_nested"] ?? 0) !== EXPECTED_ROWS.toovoidudSeriesNested)
    errors.push(`töövõit phase2_series_nested rows ${toovoidudOrigins["phase2_series_nested"] ?? 0} != ${EXPECTED_ROWS.toovoidudSeriesNested}`);

  // (3c) Nesting integrity — never silently drop/duplicate a series/nested row.
  if (nesting.invalidDisplayType.length) errors.push(`${nesting.invalidDisplayType.length} töövõit row(s) have an unknown display_type`);
  if (nesting.invalidRowOrigin.length) errors.push(`${nesting.invalidRowOrigin.length} töövõit row(s) have an unknown row_origin`);
  if (nesting.seriesNotNested.length) errors.push(`${nesting.seriesNotNested.length} phase2_series_nested row(s) use a standalone display_type`);
  if (nesting.invalidParentRefs.length) errors.push(`${nesting.invalidParentRefs.length} nested row(s) reference a missing parent töövõit`);
  if (nesting.unresolved.length) errors.push(`${nesting.unresolved.length} nested row(s) have neither a parent nor a policy thread`);

  // (3d) news_only_recommendations must NOT appear as imported töövõidud.
  const importToovoitIds = new Set(staged.toovoidud.map((s) => s.externalId));
  const newsOnlyLeaked: Issue[] = newsOnlyToovoitIds
    .filter((id) => importToovoitIds.has(id))
    .map((id) => ({ dataset: "toovoidud", externalId: id, field: "news_only", message: "news-only recommendation imported as a töövõit" }));
  if (newsOnlyLeaked.length) errors.push(`${newsOnlyLeaked.length} news-only recommendation(s) leaked into the töövõit import sheet`);

  // (4) Import sheets must not contain FALSE import flags.
  const importFlagViolations: Issue[] = staged.all
    .filter((s) => !s.importEligible)
    .map((s) => ({ dataset: s.sourceDataset, externalId: s.externalId, field: "import_flag", message: "import flag is not TRUE" }));
  if (importFlagViolations.length) errors.push(`${importFlagViolations.length} import-sheet row(s) have a FALSE import flag`);

  // (5) Excluded rows must not appear in the import sheets.
  const importIds = new Set(staged.all.map((s) => s.externalId));
  for (const [ds, ids] of Object.entries(excluded)) {
    const leaked = ids.filter((id) => importIds.has(id));
    if (leaked.length) errors.push(`${leaked.length} ${ds} excluded/review row(s) also appear in the import sheet`);
  }

  // (6) Required public fields.
  const missingRequiredFields: Issue[] = [];
  const missingSummaryRows: Issue[] = [];
  for (const s of staged.all) {
    for (const f of REQUIRED_FIELDS) {
      if (!s[f]) missingRequiredFields.push({ dataset: s.sourceDataset, externalId: s.externalId || "(blank)", field: f as string, message: "missing" });
    }
    if (!s.summary || s.summary.trim() === "") {
      missingSummaryRows.push({ dataset: s.sourceDataset, externalId: s.externalId, field: "summary", message: "empty public summary" });
    }
  }
  if (missingSummaryRows.length) errors.push(`${missingSummaryRows.length} import row(s) have an empty public summary`);

  // (7) Web summaries should not contain raw date/title fragments (e.g. 20,12,2016
  // or 24,02,22). Reported as a warning, not a hard failure: the producer package
  // is the QA'd source of truth, so a rare residual fragment is surfaced for
  // cleanup without blocking the whole production import.
  const rawFragmentSummaryRows: Issue[] = staged.all
    .filter((s) => s.summary && RAW_FRAGMENT_RE.test(s.summary))
    .map((s) => ({ dataset: s.sourceDataset, externalId: s.externalId, field: "summary", message: "raw date/title fragment in summary" }));
  if (rawFragmentSummaryRows.length) {
    warnings.push(
      `${rawFragmentSummaryRows.length} row(s) have a raw date fragment in the public summary: ${rawFragmentSummaryRows.map((i) => i.externalId).join(", ")}`
    );
  }

  // (8) Public activity DISPLAY tags must not contain the cross-sector label.
  const crossSectorDisplayTagRows: Issue[] = staged.all
    .filter((s) => containsCrossSector(s.publicActivityDisplayTags))
    .map((s) => ({ dataset: s.sourceDataset, externalId: s.externalId, field: "public_activity_display_tags", message: "contains Kõik tegevusalad / valdkondadeülene" }));
  if (crossSectorDisplayTagRows.length) errors.push(`${crossSectorDisplayTagRows.length} row(s) expose the cross-sector label as a public display tag`);

  // (9) Töövõit date regressions.
  const dateRegressions = dateRegressionChecks(staged.toovoidud);
  for (const dr of dateRegressions) if (!dr.ok) errors.push(`date regression (${dr.id} ${dr.field}=${dr.value}): ${dr.note}`);

  // Content-hash duplicates (informational).
  const byHash = new Map<string, string[]>();
  for (const s of staged.all) {
    const list = byHash.get(s.contentHash) ?? [];
    list.push(s.externalId);
    byHash.set(s.contentHash, list);
  }
  const duplicateContentHashGroups = [...byHash.entries()].filter(([, ids]) => ids.length > 1).map(([hash, ids]) => ({ hash, ids }));

  const visibility = {
    public: staged.all.filter((s) => s.isPublic).length,
    hidden: staged.all.filter((s) => !s.isPublic).length,
    needsReview: staged.all.filter((s) => s.needsHumanReview).length,
    numericReview: staged.all.filter((s) => s.numericClaimNeedsReview).length,
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

  // (10-12) Public related links: target only imported, never excluded, acceptable confidence.
  const excludedSet = new Set([...excluded.web, ...excluded.opinions, ...excluded.toovoidud]);
  const targetsNotImported: { source: string; target: string }[] = [];
  const targetsExcluded: { source: string; target: string }[] = [];
  const lowOrRejected: { source: string; target: string; confidence: string }[] = [];
  for (const l of links.publicRelated) {
    if (!importIds.has(l.sourceContentId) || !importIds.has(l.targetContentId)) {
      targetsNotImported.push({ source: l.sourceContentId, target: l.targetContentId });
    }
    if (excludedSet.has(l.sourceContentId) || excludedSet.has(l.targetContentId)) {
      targetsExcluded.push({ source: l.sourceContentId, target: l.targetContentId });
    }
    if (l.linkConfidence && !ACCEPTABLE_LINK_CONFIDENCE.has(l.linkConfidence)) {
      lowOrRejected.push({ source: l.sourceContentId, target: l.targetContentId, confidence: l.linkConfidence });
    }
  }
  if (targetsNotImported.length) errors.push(`${targetsNotImported.length} public related link(s) point to a non-imported row`);
  if (targetsExcluded.length) errors.push(`${targetsExcluded.length} public related link(s) point to an excluded/review row`);
  if (lowOrRejected.length) errors.push(`${lowOrRejected.length} public related link(s) have low/rejected confidence`);

  if (rowCounts.publicRelatedLinks !== EXPECTED_ROWS.publicRelatedLinks) {
    errors.push(`public related links ${rowCounts.publicRelatedLinks} != ${EXPECTED_ROWS.publicRelatedLinks}`);
  }
  if (rowCounts.policyThreads !== EXPECTED_ROWS.policyThreads) {
    errors.push(`policy threads ${rowCounts.policyThreads} != ${EXPECTED_ROWS.policyThreads}`);
  }
  if (rowCounts.publicPolicyThreads !== EXPECTED_ROWS.publicPolicyThreads) {
    errors.push(`public policy threads ${rowCounts.publicPolicyThreads} != ${EXPECTED_ROWS.publicPolicyThreads}`);
  }

  // (13) Cross-layer smoke test: any blocker FAIL is a hard error.
  const failures = links.smokeTest.filter((t) => t.status !== "PASS" && t.status !== "WARN" && t.status !== "");
  const blockerFailures = links.smokeTest.filter((t) => t.status === "FAIL" && ["blocker", "critical", "major"].includes(t.severity));
  for (const f of blockerFailures) errors.push(`cross-layer smoke test ${f.testId} FAILED (${f.severity}): ${f.testName}`);
  for (const w of links.smokeTest.filter((t) => t.status === "WARN")) warnings.push(`cross-layer smoke test ${w.testId} WARN: ${w.testName} (${w.issueCount} issue(s))`);

  // (14) Taxonomy rulebook file.
  const taxonomyFile = resolveImportFile(FILES.taxonomy);
  const taxonomyReference = { fileName: taxonomyFile.split(/[\\/]/).pop() ?? FILES.taxonomy[0], bytes: statSync(taxonomyFile).size };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    rowCounts,
    excludedCounts,
    expected: EXPECTED_ROWS,
    totalContentStaged: staged.all.length,
    visibility,
    perDataset,
    duplicateExternalIds,
    duplicateContentHashGroups,
    toovoidudOrigins,
    nesting: {
      topLevel: nesting.topLevel,
      nested: nesting.nested,
      threads: nesting.threads,
      unresolved: nesting.unresolved,
      invalidDisplayType: nesting.invalidDisplayType,
      invalidRowOrigin: nesting.invalidRowOrigin,
      invalidParentRefs: nesting.invalidParentRefs,
      seriesNotNested: nesting.seriesNotNested,
    },
    newsOnly: { count: newsOnlyToovoitIds.length, leakedIntoImport: newsOnlyLeaked },
    importFlagViolations,
    missingRequiredFields,
    missingSummaryRows,
    rawFragmentSummaryRows,
    crossSectorDisplayTagRows,
    dateRegressions,
    links: {
      publicRelated: links.publicRelated.length,
      byConfidence: countBy(links.publicRelated, (l) => l.linkConfidence ?? "(none)"),
      targetsNotImported,
      targetsExcluded,
      lowOrRejected,
      candidate: links.counts.candidate,
      blocked: links.counts.blocked,
      missingTargets: links.counts.missingTargets,
    },
    smokeTest: { rows: links.smokeTest, failures, blockerFailures },
    law: {
      publicConfirmedLawTagRows: staged.all.filter((s) => s.isPublic && s.lawSearchAllowed && s.lawTagsConfirmed).length,
      candidateLawTagRows: staged.all.filter((s) => s.lawTagsCandidate).length,
    },
    taxonomyReference,
  };
}

export function stageAndAnalyze(): {
  staged: ReturnType<typeof stageAllContent>;
  links: LinkWorkbook;
  excluded: ReturnType<typeof stageExcludedIds>;
  analysis: Analysis;
} {
  const staged = stageAllContent();
  const links = stageLinkWorkbook();
  const excluded = stageExcludedIds();
  const newsOnly = stageNewsOnlyToovoitIds();
  const analysis = analyze(staged, links, excluded, newsOnly);
  return { staged, links, excluded, analysis };
}

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const DATA_BUNDLE_DIR = "data/import/bundles/koda_data_bundle_v1";

export const REQUIRED_BUNDLE_FILES = [
  "manifest.json",
  "qa_report.json",
  "content_items.jsonl",
  "achievement_enrichment.jsonl",
  "taxonomy.json",
  "taxonomy_rules.json",
  "review_candidates.jsonl",
  "tag_dictionary.json",
] as const;

export type JsonRecord = Record<string, unknown>;

export type BundleReadResult<T> =
  | { ok: true; data: T; warnings: string[] }
  | { ok: false; error: string; missingFiles: string[] };

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

export type ReviewProgress = {
  total: number;
  approved: number;
  rejected: number;
  needsReview: number;
  decided: number;
  undecided: number;
  progressPercent: number;
};

/**
 * Review progress over the current bundle candidates. Pure: takes the candidate
 * ids and the saved decision-by-candidate map so it is trivial to unit-test.
 * `progressPercent` is decided (any saved decision) / total.
 */
export function computeReviewProgress(
  candidateIds: string[],
  decisionByCandidateId: Map<string, string>,
): ReviewProgress {
  let approved = 0;
  let rejected = 0;
  let needsReview = 0;
  for (const id of candidateIds) {
    switch (decisionByCandidateId.get(id)) {
      case "approved":
        approved++;
        break;
      case "rejected":
        rejected++;
        break;
      case "needs_review":
        needsReview++;
        break;
    }
  }
  const total = candidateIds.length;
  const decided = approved + rejected + needsReview;
  const undecided = total - decided;
  const progressPercent = total > 0 ? Math.round((decided / total) * 100) : 0;
  return { total, approved, rejected, needsReview, decided, undecided, progressPercent };
}

export type ReviewCandidate = JsonRecord & {
  candidateId: string;
  contentId?: string;
  title?: string;
  url?: string;
  confidence?: string;
  recommendedAction?: string;
  currentValdkond?: string[];
  suggestedValdkond?: string[];
  currentTegevusala?: string[];
  suggestedTegevusala?: string[];
  currentTapsustus?: string[];
  suggestedTapsustus?: string[];
  ruleSource?: string;
  evidence?: string;
  reviewNote?: string;
};

export type ContentBundleItem = JsonRecord & {
  externalId?: string;
  title?: string;
  displayTitle?: string;
  canonicalUrl?: string;
  sourceUrl?: string;
  sourceDataset?: string;
  sourceLayer?: string;
  sourceTypeDetail?: string;
  publicDisplayStatus?: string;
  importStatus?: string;
  isPublic?: boolean;
  needsHumanReview?: boolean;
  publicPriority?: string | null;
  valdkonnad?: string[];
  tegevusalad?: string[];
  tapsustused?: string[];
};

export type BundleOverview = {
  manifest: JsonRecord;
  qaReport: JsonRecord;
  files: { fileName: string; exists: boolean; sizeBytes: number | null }[];
};

export type CandidateFilters = {
  q?: string;
  decision?: string;
  confidence?: string;
  recommendedAction?: string;
  currentValdkond?: string;
  suggestedValdkond?: string;
  currentTegevusala?: string;
  suggestedTegevusala?: string;
  page?: number;
  pageSize?: number;
};

export type ContentFilters = {
  q?: string;
  sourceDataset?: string;
  sourceLayer?: string;
  sourceTypeDetail?: string;
  publicDisplayStatus?: string;
  importStatus?: string;
  isPublic?: string;
  needsHumanReview?: string;
  page?: number;
  pageSize?: number;
};

const cache = new Map<string, { mtimeMs: number; value: unknown }>();

export function bundlePath(fileName?: string): string {
  const base = resolve(process.cwd(), DATA_BUNDLE_DIR);
  return fileName ? join(base, fileName) : base;
}

export function missingBundleFiles(): string[] {
  return REQUIRED_BUNDLE_FILES.filter((file) => !existsSync(bundlePath(file)));
}

export function bundleFriendlyError(missingFiles = missingBundleFiles()): string {
  if (missingFiles.length === 0) return "";
  return `Andmepakett ei ole valmis. Puuduvad failid: ${missingFiles.join(", ")}.`;
}

/** Friendly (path-free) error for a corrupt/unreadable bundle file. */
export function bundleParseError(fileName: string): string {
  return `Andmepaketi faili "${fileName}" ei õnnestunud lugeda (vigane või rikutud sisu).`;
}

/**
 * Read the bundle after confirming every required file exists, turning any
 * JSON/JSONL parse failure into a friendly BundleReadResult error instead of an
 * unhandled exception (which would 500 the admin pages). Never leaks file paths.
 */
function guardedBundleRead<T>(read: () => T): BundleReadResult<T> {
  const missing = missingBundleFiles();
  if (missing.length > 0) {
    return { ok: false, error: bundleFriendlyError(missing), missingFiles: missing };
  }
  try {
    return { ok: true, data: read(), warnings: [] };
  } catch (error) {
    const fileName = error instanceof BundleFileError ? error.fileName : "andmepakett";
    return { ok: false, error: bundleParseError(fileName), missingFiles: [] };
  }
}

/** Carries the offending file name so guardedBundleRead can report it path-free. */
class BundleFileError extends Error {
  constructor(public fileName: string, cause: unknown) {
    super(`Failed to read bundle file: ${fileName}`);
    this.cause = cause;
  }
}

export function readBundleJson<T extends JsonRecord>(fileName: string): T {
  const filePath = bundlePath(fileName);
  const stat = statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value as T;
  let parsed: T;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new BundleFileError(fileName, error);
  }
  cache.set(filePath, { mtimeMs: stat.mtimeMs, value: parsed });
  return parsed;
}

export function readBundleJsonl<T extends JsonRecord>(fileName: string): T[] {
  const filePath = bundlePath(fileName);
  const stat = statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value as T[];
  const text = readFileSync(filePath, "utf8").trim();
  let parsed: T[];
  try {
    parsed = text ? text.split(/\r?\n/).map((line) => JSON.parse(line) as T) : [];
  } catch (error) {
    throw new BundleFileError(fileName, error);
  }
  cache.set(filePath, { mtimeMs: stat.mtimeMs, value: parsed });
  return parsed;
}

export function readBundleOverview(): BundleReadResult<BundleOverview> {
  return guardedBundleRead(() => ({
    manifest: readBundleJson<JsonRecord>("manifest.json"),
    qaReport: readBundleJson<JsonRecord>("qa_report.json"),
    files: REQUIRED_BUNDLE_FILES.map((fileName) => {
      const path = bundlePath(fileName);
      return { fileName, exists: existsSync(path), sizeBytes: existsSync(path) ? statSync(path).size : null };
    }),
  }));
}

export function readReviewCandidates(): BundleReadResult<ReviewCandidate[]> {
  return guardedBundleRead(() =>
    readBundleJsonl<JsonRecord>("review_candidates.jsonl").map(normalizeReviewCandidate),
  );
}

export function readContentItems(): BundleReadResult<ContentBundleItem[]> {
  return guardedBundleRead(() => readBundleJsonl<ContentBundleItem>("content_items.jsonl"));
}

export function readTaxonomyBundle(): BundleReadResult<{
  taxonomy: JsonRecord;
  taxonomyRules: JsonRecord;
  tagDictionary: JsonRecord;
}> {
  return guardedBundleRead(() => ({
    taxonomy: readBundleJson<JsonRecord>("taxonomy.json"),
    taxonomyRules: readBundleJson<JsonRecord>("taxonomy_rules.json"),
    tagDictionary: readBundleJson<JsonRecord>("tag_dictionary.json"),
  }));
}

export function findReviewCandidate(id: string): BundleReadResult<ReviewCandidate | null> {
  const rows = readReviewCandidates();
  if (!rows.ok) return rows;
  return { ok: true, warnings: [], data: rows.data.find((row) => row.candidateId === id) ?? null };
}

export function findContentItem(externalId: string): BundleReadResult<ContentBundleItem | null> {
  const rows = readContentItems();
  if (!rows.ok) return rows;
  return { ok: true, warnings: [], data: rows.data.find((row) => row.externalId === externalId) ?? null };
}

export function filterReviewCandidates(
  rows: ReviewCandidate[],
  filters: CandidateFilters,
  decisionByCandidateId: Map<string, string>,
): { rows: ReviewCandidate[]; pagination: Pagination } {
  const q = normalize(filters.q);
  const filtered = rows.filter((row) => {
    const decision = decisionByCandidateId.get(row.candidateId) ?? "undecided";
    if (filters.decision && filters.decision !== "all" && decision !== filters.decision) return false;
    if (filters.confidence && row.confidence !== filters.confidence) return false;
    if (filters.recommendedAction && row.recommendedAction !== filters.recommendedAction) return false;
    if (filters.currentValdkond && !includesValue(row.currentValdkond, filters.currentValdkond)) return false;
    if (filters.suggestedValdkond && !includesValue(row.suggestedValdkond, filters.suggestedValdkond)) return false;
    if (filters.currentTegevusala && !includesValue(row.currentTegevusala, filters.currentTegevusala)) return false;
    if (filters.suggestedTegevusala && !includesValue(row.suggestedTegevusala, filters.suggestedTegevusala)) return false;
    if (!q) return true;
    return [row.candidateId, row.contentId, row.title, row.url, row.evidence, row.reviewNote]
      .map((value) => normalize(stringValue(value)))
      .some((value) => value.includes(q));
  });
  // Undecided-first by default: still-to-review candidates surface above
  // already-decided ones. Array.sort is stable, so bundle order is preserved
  // within each group, and the explicit decision filters above are unaffected.
  const ordered = filtered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aDecided = decisionByCandidateId.has(a.row.candidateId) ? 1 : 0;
      const bDecided = decisionByCandidateId.has(b.row.candidateId) ? 1 : 0;
      return aDecided - bDecided || a.index - b.index;
    })
    .map((entry) => entry.row);
  return paginate(ordered, filters.page, filters.pageSize);
}

export function filterContentItems(
  rows: ContentBundleItem[],
  filters: ContentFilters,
): { rows: ContentBundleItem[]; pagination: Pagination } {
  const q = normalize(filters.q);
  const filtered = rows.filter((row) => {
    if (filters.sourceDataset && row.sourceDataset !== filters.sourceDataset) return false;
    if (filters.sourceLayer && row.sourceLayer !== filters.sourceLayer) return false;
    if (filters.sourceTypeDetail && row.sourceTypeDetail !== filters.sourceTypeDetail) return false;
    if (filters.publicDisplayStatus && row.publicDisplayStatus !== filters.publicDisplayStatus) return false;
    if (filters.importStatus && row.importStatus !== filters.importStatus) return false;
    if (filters.isPublic === "true" && row.isPublic !== true) return false;
    if (filters.isPublic === "false" && row.isPublic !== false) return false;
    if (filters.needsHumanReview === "true" && row.needsHumanReview !== true) return false;
    if (filters.needsHumanReview === "false" && row.needsHumanReview !== false) return false;
    if (!q) return true;
    return [row.externalId, row.title, row.displayTitle, row.canonicalUrl, row.sourceUrl]
      .map((value) => normalize(stringValue(value)))
      .some((value) => value.includes(q));
  });
  return paginate(filtered, filters.page, filters.pageSize);
}

export function uniqueValues<T extends JsonRecord>(rows: T[], key: keyof T): string[] {
  return [...new Set(rows.map((row) => stringValue(row[key])).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "et"),
  );
}

export function tagValues(rows: ReviewCandidate[], key: keyof ReviewCandidate): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    for (const value of arrayValue(row[key])) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b, "et"));
}

export function normalizeReviewCandidate(row: JsonRecord): ReviewCandidate {
  const sourceRow = row.sourceRow && typeof row.sourceRow === "object" ? (row.sourceRow as JsonRecord) : {};
  const rowNumber = stringValue(sourceRow.rowNumber);
  const candidateId = stringValue(row.candidateId) || stringValue(row.contentId) || rowNumber || hashFallback(row);
  return {
    ...row,
    candidateId,
    contentId: stringValue(row.contentId) || candidateId,
    title: stringValue(row.title),
    url: stringValue(row.url),
    confidence: stringValue(row.confidence),
    recommendedAction: stringValue(row.recommendedAction),
    currentValdkond: arrayValue(row.currentValdkond),
    suggestedValdkond: arrayValue(row.suggestedValdkond),
    currentTegevusala: arrayValue(row.currentTegevusala),
    suggestedTegevusala: arrayValue(row.suggestedTegevusala),
    currentTapsustus: arrayValue(row.currentTapsustus),
    suggestedTapsustus: arrayValue(row.suggestedTapsustus),
    ruleSource: stringValue(row.ruleSource),
    evidence: stringValue(row.evidence),
    reviewNote: stringValue(row.reviewNote),
  };
}

export function arrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

export function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function paginate<T>(rows: T[], page = 1, pageSize = 50): { rows: T[]; pagination: Pagination } {
  const safePageSize = Math.max(1, Math.min(200, pageSize || 50));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(pages, page || 1));
  return {
    rows: rows.slice((safePage - 1) * safePageSize, safePage * safePageSize),
    pagination: { page: safePage, pageSize: safePageSize, total, pages },
  };
}

function includesValue(values: string[] | undefined, value: string): boolean {
  return (values ?? []).some((item) => item === value);
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("et");
}

function hashFallback(row: JsonRecord): string {
  const text = JSON.stringify(row);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `candidate-${hash.toString(16)}`;
}

/**
 * Pure filter/sort helpers for the admin ingestion staging view. No Prisma, so
 * they are unit-testable. Default ordering surfaces still-to-review items first
 * (needs_review, new) and newest-first within each group.
 */

export type StagingViewRow = {
  id: string;
  title: string | null;
  canonicalUrl: string;
  publishedAt: Date | null;
  createdAt: Date;
  reviewStatus: string;
  detectedSourceType: string | null;
  detectedLaws: unknown;
  detectedValdkonnad: unknown;
  matchedContentItemId: string | null;
};

export type StagingFilters = {
  reviewStatus?: string;
  detectedSourceType?: string;
  law?: string; // law slug
  valdkond?: string;
  q?: string;
  year?: number | null;
};

const REVIEW_STATUS_RANK: Record<string, number> = {
  needs_review: 0,
  new: 1,
  matched_existing: 2,
  approved: 3,
  rejected: 4,
  ignored: 5,
};

/** Safely extract law slugs from a detectedLaws JSON value. */
export function lawSlugsOf(detectedLaws: unknown): string[] {
  if (!Array.isArray(detectedLaws)) return [];
  const slugs: string[] = [];
  for (const entry of detectedLaws) {
    if (typeof entry === "string") slugs.push(entry);
    else if (entry && typeof entry === "object" && typeof (entry as { slug?: unknown }).slug === "string") {
      slugs.push((entry as { slug: string }).slug);
    }
  }
  return slugs;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function dateMs(row: StagingViewRow): number {
  return (row.publishedAt ?? row.createdAt)?.getTime?.() ?? 0;
}

export function selectStagingItems<T extends StagingViewRow>(rows: T[], filters: StagingFilters): T[] {
  const q = (filters.q ?? "").trim().toLocaleLowerCase("et");
  const filtered = rows.filter((row) => {
    if (filters.reviewStatus && row.reviewStatus !== filters.reviewStatus) return false;
    if (filters.detectedSourceType && row.detectedSourceType !== filters.detectedSourceType) return false;
    if (filters.law && !lawSlugsOf(row.detectedLaws).includes(filters.law)) return false;
    if (filters.valdkond && !stringArray(row.detectedValdkonnad).includes(filters.valdkond)) return false;
    if (filters.year != null && !Number.isNaN(filters.year)) {
      const y = row.publishedAt ? row.publishedAt.getUTCFullYear() : null;
      if (y !== filters.year) return false;
    }
    if (q) {
      const hay = `${row.title ?? ""} ${row.canonicalUrl}`.toLocaleLowerCase("et");
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return filtered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byStatus =
        (REVIEW_STATUS_RANK[a.row.reviewStatus] ?? 9) - (REVIEW_STATUS_RANK[b.row.reviewStatus] ?? 9);
      if (byStatus !== 0) return byStatus;
      const byDate = dateMs(b.row) - dateMs(a.row);
      if (byDate !== 0) return byDate;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

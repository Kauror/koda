/**
 * Safe date extraction + filtering/sorting helpers for admin tools.
 *
 * Content items expose a normalized `date` ("YYYY-MM-DD"), plus `year` and
 * `reportYear` fallbacks. Review candidates have no own date — callers resolve
 * one by joining to the candidate's content item. Everything here is pure and
 * null-safe so it can be unit-tested and never crashes an admin page.
 */

export const NO_DATE_LABEL = "Kuupäev puudub";

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

export type DatedFields = {
  date?: unknown; // usually "YYYY-MM-DD" but treated defensively
  year?: unknown; // number or numeric string
  reportYear?: unknown;
};

export type ItemDate = {
  /** Epoch ms for sorting; null when no usable date is known. */
  sortKey: number | null;
  /** "YYYY-MM-DD" when a full date is known, else null. */
  iso: string | null;
  /** Calendar year when known (full date or year-only), else null. */
  year: number | null;
  /** True when the row has any usable (sortable) date. */
  hasDate: boolean;
  /** True when only year-level granularity is known. */
  yearOnly: boolean;
};

export const UNKNOWN_DATE: ItemDate = { sortKey: null, iso: null, year: null, hasDate: false, yearOnly: false };

function inYearRange(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

function parseYearValue(value: unknown): number | null {
  if (typeof value === "number" && inYearRange(value)) return value;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})$/);
    if (m) {
      const year = Number(m[1]);
      if (inYearRange(year)) return year;
    }
  }
  return null;
}

function yearResult(year: number): ItemDate {
  return { sortKey: Date.UTC(year, 0, 1), iso: null, year, hasDate: true, yearOnly: true };
}

/** Extract a comparable, display-safe date from a content item or resolved candidate. */
export function extractItemDate(fields: DatedFields): ItemDate {
  const raw = typeof fields.date === "string" ? fields.date.trim() : "";
  if (raw) {
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) {
      const year = Number(ymd[1]);
      const month = Number(ymd[2]);
      const day = Number(ymd[3]);
      if (inYearRange(year) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          sortKey: Date.UTC(year, month - 1, day),
          iso: `${ymd[1]}-${ymd[2]}-${ymd[3]}`,
          year,
          hasDate: true,
          yearOnly: false,
        };
      }
    }
    const ym = raw.match(/^(\d{4})-(\d{2})$/);
    if (ym) {
      const year = Number(ym[1]);
      const month = Number(ym[2]);
      if (inYearRange(year) && month >= 1 && month <= 12) {
        return { sortKey: Date.UTC(year, month - 1, 1), iso: `${ym[1]}-${ym[2]}-01`, year, hasDate: true, yearOnly: false };
      }
    }
    const yearOnly = parseYearValue(raw);
    if (yearOnly != null) return yearResult(yearOnly);
    // Last resort: let the engine try, but only trust an in-range year.
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      const year = new Date(parsed).getUTCFullYear();
      if (inYearRange(year)) {
        const iso = new Date(parsed).toISOString().slice(0, 10);
        return { sortKey: parsed, iso, year, hasDate: true, yearOnly: false };
      }
    }
  }

  const fallbackYear = parseYearValue(fields.year) ?? parseYearValue(fields.reportYear);
  if (fallbackYear != null) return yearResult(fallbackYear);
  return UNKNOWN_DATE;
}

/** Human-readable date for admin tables. */
export function formatItemDate(d: ItemDate): string {
  if (!d.hasDate) return NO_DATE_LABEL;
  if (d.yearOnly || !d.iso) return d.year != null ? String(d.year) : NO_DATE_LABEL;
  return new Date(d.iso).toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export type DateFilter = {
  dateFrom?: string | null;
  dateTo?: string | null;
  year?: number | null;
};

function boundMs(value: string | null | undefined, edge: "start" | "end"): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (!inYearRange(year)) return null;
  const month = m[2] ? Number(m[2]) : edge === "start" ? 1 : 12;
  const day = m[3] ? Number(m[3]) : edge === "start" ? 1 : 31;
  return edge === "start" ? Date.UTC(year, month - 1, day) : Date.UTC(year, month - 1, day, 23, 59, 59, 999);
}

export function hasActiveDateFilter(f: DateFilter): boolean {
  return Boolean(f.dateFrom || f.dateTo || (f.year != null && !Number.isNaN(f.year)));
}

/**
 * Does the date pass the filter? With no active date filter, everything passes
 * (including unknown dates). When a date filter is active, unknown-date rows are
 * excluded.
 */
export function matchesDateFilter(d: ItemDate, f: DateFilter): boolean {
  if (!hasActiveDateFilter(f)) return true;
  if (!d.hasDate || d.sortKey == null) return false;
  if (f.year != null && !Number.isNaN(f.year) && d.year !== f.year) return false;
  const from = boundMs(f.dateFrom, "start");
  if (from != null && d.sortKey < from) return false;
  const to = boundMs(f.dateTo, "end");
  if (to != null && d.sortKey > to) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sorting (unknown dates always sort last)
// ---------------------------------------------------------------------------

export function compareItemDate(a: ItemDate, b: ItemDate, direction: "newest" | "oldest"): number {
  const ak = a.hasDate ? a.sortKey : null;
  const bk = b.hasDate ? b.sortKey : null;
  if (ak == null && bk == null) return 0;
  if (ak == null) return 1;
  if (bk == null) return -1;
  return direction === "newest" ? bk - ak : ak - bk;
}

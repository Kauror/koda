/**
 * Public date safety gate (trust/safety).
 *
 * The imported `date` comes from the source `sort_date` column, which for many
 * rows is an import/placeholder value rather than a verified publication date:
 *   - the package/import date (e.g. 2026-06-24) used as a generic default;
 *   - a year-end placeholder (31.12.<year>) for "happened sometime this year";
 *   - a year-start placeholder (01.01.<year>) for year-only values;
 *   - impossible future exact dates.
 *
 * Showing those as exact public dates (e.g. "Töövõit 24. juuni 2026") presents
 * uncertain data as confident fact. This helper degrades or suppresses such
 * dates instead. It is the single source of truth for public date rendering and
 * for the recency signal used in ranking.
 *
 * Pure (no Prisma / no I/O). Schema note: ideally ContentItem would carry
 * `displayDatePrecision` / `dateConfidence` / `dateBasis` columns; until that
 * migration lands, the same fields are derived here at read time.
 */

export type DatePrecision = "day" | "month" | "year" | "unknown";
export type DateConfidence = "high" | "medium" | "low" | "unverified";

export type PublicDate = {
  /** ISO yyyy-mm-dd only when an exact day is trusted; else null. */
  iso: string | null;
  /** Trusted year when known (day/month/year precision); else null. */
  year: number | null;
  precision: DatePrecision;
  confidence: DateConfidence;
  /** Short machine reason, for admin/debug. */
  basis: string;
  /** Ready-to-render Estonian label, or null when the date must be suppressed. */
  text: string | null;
  /** Date to use for the recency ranking signal (only verified day/month), else null. */
  rankingDate: Date | null;
};

export type PublicDateInput = {
  date: Date | null;
  year?: number | null;
  reportYear?: number | null;
  classificationConfidence?: string | null;
  /**
   * v1 producer-supplied date precision (töövõidud: display_date_precision).
   * When set, it is authoritative for how precisely the date may be shown:
   * "year" never renders a day, "month" renders month+year, "day" may render a
   * full day (still subject to the placeholder/future/low-confidence guards).
   */
  displayDatePrecision?: string | null;
  /** v1 producer-supplied date confidence (date_confidence: high|medium|low). */
  dateConfidence?: string | null;
  /** v1 machine reason for the date (date_basis), passed through to `basis`. */
  dateBasis?: string | null;
};

/**
 * Known import/package placeholder dates (UTC yyyy-mm-dd). Rows stamped with one
 * of these have no verified date — the value is an import default. Extend via
 * the KODA_IMPORT_PLACEHOLDER_DATES env (comma-separated) without a code change.
 */
const DEFAULT_IMPORT_PLACEHOLDER_DATES = ["2026-06-24"];

function importPlaceholderDates(): Set<string> {
  const fromEnv = (process.env.KODA_IMPORT_PLACEHOLDER_DATES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_IMPORT_PLACEHOLDER_DATES, ...fromEnv]);
}

const MIN_YEAR = 1990;

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatFull(d: Date): string {
  return d.toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" });
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString("et-EE", { month: "long", year: "numeric" });
}

const LOW_CONFIDENCE_CLASSIFICATION = new Set(["low", "medium-low"]);

function mapDateConfidence(raw: string | null | undefined): DateConfidence {
  switch ((raw ?? "").toLowerCase()) {
    case "high":
      return "high";
    case "medium":
    case "medium-high":
      return "medium";
    case "low":
    case "medium-low":
      return "low";
    default:
      return "unverified";
  }
}

/**
 * Compute the safe public date for a content row.
 *
 * `now` is injectable for deterministic tests; defaults to the current date.
 */
export function computePublicDate(input: PublicDateInput, now: Date = new Date()): PublicDate {
  const curYear = now.getUTCFullYear();
  const todayMs = startOfUtcDay(now);
  const placeholders = importPlaceholderDates();
  const lowClassification = input.classificationConfidence
    ? LOW_CONFIDENCE_CLASSIFICATION.has(input.classificationConfidence.toLowerCase())
    : false;

  const d = input.date;
  const suppressed = (basis: string): PublicDate => ({
    iso: null, year: null, precision: "unknown", confidence: "unverified", basis, text: null, rankingDate: null,
  });
  const yearOnly = (year: number, confidence: DateConfidence, basis: string): PublicDate => ({
    iso: null, year, precision: "year", confidence, basis, text: String(year), rankingDate: null,
  });

  // A plausible *explicit* source year (from year/reportYear fields) is trusted
  // up to and including the current year. These come from source_year columns,
  // not from the suspect sort_date, so a current-year value is acceptable.
  const plausibleExplicitYear = (y: number | null | undefined): boolean =>
    y != null && y >= MIN_YEAR && y <= curYear;
  const explicitYear =
    [input.reportYear, input.year].find((y) => plausibleExplicitYear(y)) ?? null;

  if (!d || Number.isNaN(d.getTime())) {
    // No date at all → fall back to an explicit source year if we have one.
    return explicitYear != null ? yearOnly(explicitYear, "medium", "explicit-year-no-date") : suppressed("no-date");
  }

  const iso = isoOf(d);
  const dYear = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  const isFuture = startOfUtcDay(d) > todayMs;
  // 31.12 / year-end is the documented "happened sometime this year" placeholder.
  const isYearEnd = month === 12 && day === 31;
  const isImportPlaceholder = placeholders.has(iso);

  // v1 explicit-precision branch (töövõidud display_date_precision). When the
  // producer states the precision, it is authoritative for how precisely we may
  // render — we never upgrade a year-level date to a day. We still suppress
  // import-placeholder dates and (for day precision) future dates.
  const precision = (input.displayDatePrecision ?? "").toLowerCase();
  if (precision === "year" || precision === "month" || precision === "day") {
    const conf = mapDateConfidence(input.dateConfidence);
    const basisTag = input.dateBasis ? `precision-${precision}:${input.dateBasis}` : `precision-${precision}`;
    const lowConf = conf === "low" || conf === "unverified";
    if (isImportPlaceholder && explicitYear == null) return suppressed(`import-placeholder-${basisTag}`);
    if (precision === "year") {
      const y = dYear >= MIN_YEAR && dYear <= curYear ? dYear : explicitYear;
      return y != null ? yearOnly(y, conf, basisTag) : suppressed(`year-out-of-range-${basisTag}`);
    }
    if (precision === "month") {
      if (isFuture || dYear < MIN_YEAR) {
        return explicitYear != null ? yearOnly(explicitYear, conf, `future-${basisTag}`) : suppressed(`future-${basisTag}`);
      }
      // Month precision: never a precise day; recency uses month-level date.
      return { iso: null, year: dYear, precision: "month", confidence: conf, basis: basisTag, text: formatMonth(d), rankingDate: lowConf ? null : d };
    }
    // precision === "day"
    if (isFuture || isImportPlaceholder) {
      return explicitYear != null ? yearOnly(explicitYear, conf, `degraded-${basisTag}`) : suppressed(`degraded-${basisTag}`);
    }
    if (lowConf) {
      // Day stated but low confidence → show the year only, no recency boost.
      const y = dYear >= MIN_YEAR ? dYear : explicitYear;
      return y != null ? yearOnly(y, conf, `low-confidence-${basisTag}`) : suppressed(`low-confidence-${basisTag}`);
    }
    return { iso, year: dYear, precision: "day", confidence: conf, basis: basisTag, text: formatFull(d), rankingDate: d };
  }

  // (Jan-1 is intentionally NOT treated as a placeholder: it is a real calendar
  // day and the task's placeholder list is import-date / 31.12 / future only.)
  // Trusted exact day: real-looking date, not future, not a year-end placeholder,
  // not an import default, and classification confidence is not low.
  if (!isFuture && !isYearEnd && !isImportPlaceholder && !lowClassification && dYear >= MIN_YEAR) {
    return { iso, year: dYear, precision: "day", confidence: "high", basis: "verified-day", text: formatFull(d), rankingDate: d };
  }

  // Exact day is NOT trusted. Try to show a trustworthy year instead.
  // Prefer an explicit source year; otherwise the date's own year, but only when
  // it is strictly in the PAST (a current/future year-end/import placeholder year
  // is itself unreliable, so we suppress rather than assert it).
  if (explicitYear != null) {
    const basis = isImportPlaceholder
      ? "import-placeholder-date-explicit-year"
      : isFuture
        ? "future-date-explicit-year"
        : isYearEnd
          ? "year-end-placeholder-explicit-year"
          : "low-confidence-explicit-year";
    return yearOnly(explicitYear, "medium", basis);
  }
  if (!isFuture && !isImportPlaceholder && isYearEnd && dYear >= MIN_YEAR && dYear < curYear) {
    // A past year-end placeholder (e.g. 2019-12-31): the year is reliable.
    return yearOnly(dYear, "low", "past-year-end-placeholder");
  }

  // Future / current-year placeholder / import default with no reliable year →
  // suppress entirely rather than assert a misleading date.
  return suppressed(
    isFuture ? "future-date-no-year" : isImportPlaceholder ? "import-placeholder-no-year" : "low-confidence-no-year"
  );
}

/** Convenience: the recency ranking date (verified day/month only), else null. */
export function rankingDateFor(input: PublicDateInput, now: Date = new Date()): Date | null {
  return computePublicDate(input, now).rankingDate;
}

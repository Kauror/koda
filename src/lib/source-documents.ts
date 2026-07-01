/**
 * Opinion source-document (pöördumine PDF) matching — pure, Prisma-free so it can
 * be unit-tested with plain objects. Links a manifest PDF (filename
 * `YYYY-MM-DD - Recipient - Title.pdf`) to an opinion ContentItem, never guessing:
 * uncertain/ambiguous rows are reported, not linked.
 *
 * The DB orchestration (read manifest, verify files on disk, upsert SourceDocument,
 * write reports) lives in scripts/import-source-documents.ts.
 */
import { normalizeRecipient } from "./recipient";

export type OpinionRef = {
  externalId: string;
  sourceFileName: string | null;
  title: string;
  date: Date | null;
  recipientNormalized: string | null;
  recipientRaw: string | null;
};

export type ParsedFilename = { date: string | null; recipient: string | null; title: string | null };

export type MatchMethod = "exact_filename" | "parsed_date_recipient_title" | "fuzzy";
export type MatchConfidence = "high" | "medium" | "low";

export type MatchResult =
  | { status: "matched"; opinion: OpinionRef; method: MatchMethod; confidence: MatchConfidence }
  | { status: "ambiguous"; tier: MatchMethod; candidates: OpinionRef[] }
  | { status: "unmatched" };

const FOLD: Record<string, string> = { "ä": "a", "ö": "o", "õ": "o", "ü": "u", "š": "s", "ž": "z" };

/** Lowercase + fold Estonian diacritics + collapse to alphanumeric tokens. */
export function foldText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLocaleLowerCase("et-EE")
    .replace(/[äöõüšž]/g, (c) => FOLD[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized key for exact-filename comparison (drops the .pdf extension). */
export function normalizeFilenameKey(name: string | null | undefined): string {
  return foldText((name ?? "").replace(/\.pdf$/i, ""));
}

/** Parse `YYYY-MM-DD - Recipient - Title.pdf` into its parts. */
export function parseOpinionFilename(name: string): ParsedFilename {
  const base = name.replace(/\.pdf$/i, "").trim();
  const m = base.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\s*-\s*(.+)$/);
  if (!m) return { date: null, recipient: null, title: base || null };
  return { date: m[1], recipient: m[2].trim() || null, title: m[3].trim() || null };
}

/** Canonical recipient bucket (reuses the app's recipient normalization/aliases). */
export function recipientKey(value: string | null | undefined): string {
  const norm = normalizeRecipient(value);
  return norm?.filterGroup ?? foldText(value);
}

export function isSupplementaryFilename(name: string): boolean {
  const { title } = parseOpinionFilename(name);
  return /\b(lisa|seletuskiri|kooskolastustabel|uhiskiri|uhispoordumine|annex|appendix|joint position)\b/.test(
    foldText(title ?? name)
  );
}

function dateKey(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function daysApart(isoDate: string, d: Date): number {
  const a = Date.parse(isoDate + "T00:00:00Z");
  const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.abs((a - b) / 86_400_000);
}

function tokens(s: string): string[] {
  return foldText(s).split(" ").filter((t) => t.length >= 3);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** True when either normalized title contains the other (min-length guarded). */
function titleContains(a: string, b: string): boolean {
  if (!a || !b) return false;
  const min = Math.min(a.length, b.length);
  return min >= 12 && (a.includes(b) || b.includes(a));
}

/**
 * Match one manifest PDF (by original filename) to at most one opinion. Tiered,
 * and it NEVER guesses: two or more equally-plausible candidates return
 * `ambiguous`, and a weak/no match returns `unmatched`.
 */
export function matchDocument(originalFilename: string, opinions: OpinionRef[]): MatchResult {
  const parsed = parseOpinionFilename(originalFilename);
  const fnKey = normalizeFilenameKey(originalFilename);

  // Tier 1 — exact original filename (opinion.sourceFileName).
  if (fnKey) {
    const exact = opinions.filter((o) => o.sourceFileName && normalizeFilenameKey(o.sourceFileName) === fnKey);
    if (exact.length === 1) return { status: "matched", opinion: exact[0], method: "exact_filename", confidence: "high" };
    if (exact.length > 1) return { status: "ambiguous", tier: "exact_filename", candidates: exact };
  }

  // Tier 2 — parsed date + title (+ recipient to disambiguate).
  if (parsed.date && parsed.title) {
    const titleKey = foldText(parsed.title);
    const sameDate = opinions.filter((o) => dateKey(o.date) === parsed.date);
    const equal = sameDate.filter((o) => foldText(o.title) === titleKey);
    let candidates = equal.length ? equal : sameDate.filter((o) => titleContains(foldText(o.title), titleKey));
    if (parsed.recipient && candidates.length > 1) {
      const rk = recipientKey(parsed.recipient);
      const byRecipient = candidates.filter((o) => recipientKey(o.recipientNormalized ?? o.recipientRaw) === rk);
      if (byRecipient.length) candidates = byRecipient;
    }
    if (candidates.length === 1) {
      return {
        status: "matched",
        opinion: candidates[0],
        method: "parsed_date_recipient_title",
        confidence: equal.length === 1 ? "high" : "medium",
      };
    }
    if (candidates.length > 1) return { status: "ambiguous", tier: "parsed_date_recipient_title", candidates };
  }

  // Tier 3 — fuzzy: close date + recipient agreement + strong title overlap,
  // accepted only when a single candidate clearly wins.
  if (parsed.title) {
    const parsedTok = new Set(tokens(parsed.title));
    const scored = opinions
      .map((o) => ({
        o,
        dd: parsed.date && o.date ? daysApart(parsed.date, o.date) : 999,
        recOk: !parsed.recipient || recipientKey(parsed.recipient) === recipientKey(o.recipientNormalized ?? o.recipientRaw),
        jac: jaccard(parsedTok, new Set(tokens(o.title))),
      }))
      .filter((x) => x.dd <= 3 && x.recOk && x.jac >= 0.6)
      .sort((a, b) => b.jac - a.jac || a.dd - b.dd);
    if (scored.length === 1) return { status: "matched", opinion: scored[0].o, method: "fuzzy", confidence: "low" };
    if (scored.length > 1) {
      if (scored[0].jac - scored[1].jac >= 0.2) {
        return { status: "matched", opinion: scored[0].o, method: "fuzzy", confidence: "low" };
      }
      return { status: "ambiguous", tier: "fuzzy", candidates: scored.map((x) => x.o) };
    }
  }

  return { status: "unmatched" };
}

/**
 * Pick the single primary source document to show as "Vaata pöördumist" for one
 * opinion: prefer a verified, non-supplementary PDF; fall back to stable id order.
 */
export function pickPrimaryDoc<T extends { id: string; originalFilename: string; fileVerified: boolean; isPrimary: boolean }>(
  docs: T[]
): T | null {
  if (docs.length === 0) return null;
  const rank = (d: T) =>
    (d.fileVerified ? 0 : 100) + (d.isPrimary ? 0 : 10) + (isSupplementaryFilename(d.originalFilename) ? 5 : 0);
  return [...docs].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
}

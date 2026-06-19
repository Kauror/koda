/**
 * Conservative legal-act (õigusakt) mention detection.
 *
 * Matching tiers, strongest first:
 *  - exact_name      canonical law name as a standalone token sequence    → high
 *  - inflected_name  canonical name + an Estonian case ending (seaduse…)   → high
 *  - alias           a registered alternative full name/spelling           → medium
 *  - abbreviation    official abbreviation as a standalone token (≥3 ch)   → medium
 *  - weak_keyword    a narrow topical phrase (suggestion only)             → low
 *
 * Broad everyday words ("jäätmed", "pakend", "maks", "töö") are not registered
 * anywhere, so they never match. Weak keywords are returned but NEVER drive
 * public law recognition or confirmed tagging — callers must filter them out.
 *
 * Prisma-free and null-safe so it can be unit-tested with plain objects.
 */
import { normalizeTitle } from "./hash";
import { LAWS, getLawBySlug, type LawEntry } from "./law-dictionary";

export type LawMatchType = "exact_name" | "inflected_name" | "alias" | "abbreviation" | "weak_keyword";
export type LawConfidence = "high" | "medium" | "low";

export type LawMention = {
  slug: string;
  canonicalName: string;
  matchType: LawMatchType;
  confidence: LawConfidence;
  matchedText: string;
};

/** Text fields a content row may expose; all optional/nullable. */
export type LawTextFields = {
  title?: string | null;
  displayTitle?: string | null;
  adminDisplayTitleOverride?: string | null;
  summary?: string | null;
  adminSummaryOverride?: string | null;
  excerpt?: string | null;
  bodyText?: string | null;
  companyRelevance?: string | null;
  kodaPosition?: string | null;
  sourceEvidence?: string | null;
};

/** Longest trailing case ending allowed after a name before it stops matching. */
const MAX_INFLECTION_TAIL = 5;
const MIN_ABBREVIATION_LEN = 3;

function confidenceRank(c: LawConfidence): number {
  return c === "high" ? 2 : c === "medium" ? 1 : 0;
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Find `phrase` in `haystack` (both already normalized) honouring a left word
 * boundary. Returns "exact" when the phrase ends on a boundary, "inflected"
 * when a short alphabetic case ending follows, otherwise null.
 */
function matchPhrase(haystack: string, phrase: string): { kind: "exact" | "inflected"; text: string } | null {
  if (!phrase) return null;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(phrase, from);
    if (idx === -1) return null;
    const leftOk = idx === 0 || haystack[idx - 1] === " ";
    if (leftOk) {
      const end = idx + phrase.length;
      const after = end >= haystack.length ? "" : haystack[end];
      if (after === "" || after === " ") return { kind: "exact", text: phrase };
      if (isWordChar(after)) {
        let k = end;
        while (k < haystack.length && haystack[k] !== " ") k++;
        if (k - end <= MAX_INFLECTION_TAIL) return { kind: "inflected", text: haystack.slice(idx, k) };
      }
    }
    from = idx + 1;
  }
}

function hasStandaloneToken(haystack: string, token: string): boolean {
  if (!token) return false;
  return haystack.split(" ").includes(token);
}

function buildHaystack(fields: LawTextFields): string {
  const parts = [
    fields.adminDisplayTitleOverride,
    fields.displayTitle,
    fields.title,
    fields.adminSummaryOverride,
    fields.summary,
    fields.companyRelevance,
    fields.kodaPosition,
    fields.sourceEvidence,
    fields.excerpt,
    fields.bodyText,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  return normalizeTitle(parts.join(" "));
}

function mention(law: LawEntry, matchType: LawMatchType, confidence: LawConfidence, matchedText: string): LawMention {
  return { slug: law.slug, canonicalName: law.canonicalName, matchType, confidence, matchedText };
}

/** Strongest mention of one law within an already-normalized haystack, or null. */
function bestLawMention(haystack: string, law: LawEntry): LawMention | null {
  const nameMatch = matchPhrase(haystack, normalizeTitle(law.canonicalName));
  if (nameMatch) {
    return mention(law, nameMatch.kind === "exact" ? "exact_name" : "inflected_name", "high", nameMatch.text);
  }
  for (const alias of law.aliases ?? []) {
    const aliasMatch = matchPhrase(haystack, normalizeTitle(alias));
    if (aliasMatch) return mention(law, "alias", "medium", aliasMatch.text);
  }
  if (law.abbreviation) {
    const abbr = normalizeTitle(law.abbreviation);
    if (abbr.length >= MIN_ABBREVIATION_LEN && hasStandaloneToken(haystack, abbr)) {
      return mention(law, "abbreviation", "medium", law.abbreviation);
    }
  }
  for (const keyword of law.weakKeywords ?? []) {
    const weakMatch = matchPhrase(haystack, normalizeTitle(keyword));
    if (weakMatch) return mention(law, "weak_keyword", "low", weakMatch.text);
  }
  return null;
}

/** All distinct law mentions in the given text fields (one strongest per law). */
export function extractLawMentions(fields: LawTextFields): LawMention[] {
  const haystack = buildHaystack(fields);
  if (!haystack) return [];
  const out: LawMention[] = [];
  for (const law of LAWS) {
    const m = bestLawMention(haystack, law);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Detect the law a free-text query refers to. Weak (low-confidence) matches are
 * ignored so broad/topical words fall back to normal keyword search. Returns the
 * highest-confidence, longest match.
 */
export function detectLaw(query: string | null | undefined): { law: LawEntry; mention: LawMention } | null {
  if (typeof query !== "string") return null;
  const haystack = normalizeTitle(query);
  if (!haystack) return null;
  let best: { law: LawEntry; mention: LawMention } | null = null;
  for (const law of LAWS) {
    const m = bestLawMention(haystack, law);
    if (!m || m.confidence === "low") continue;
    if (
      !best ||
      confidenceRank(m.confidence) > confidenceRank(best.mention.confidence) ||
      (confidenceRank(m.confidence) === confidenceRank(best.mention.confidence) &&
        m.matchedText.length > best.mention.matchedText.length)
    ) {
      best = { law, mention: m };
    }
  }
  return best;
}

/**
 * Strongest mention of a specific law slug in the given fields, or null if it
 * is below `minConfidence` (default "medium" — i.e. weak keywords excluded).
 */
export function lawMentionForSlug(
  fields: LawTextFields,
  slug: string,
  minConfidence: LawConfidence = "medium"
): LawMention | null {
  const law = getLawBySlug(slug);
  if (!law) return null;
  const haystack = buildHaystack(fields);
  if (!haystack) return null;
  const m = bestLawMention(haystack, law);
  if (!m || confidenceRank(m.confidence) < confidenceRank(minConfidence)) return null;
  return m;
}

/**
 * Filter content to rows that confirm a law (confidence ≥ medium) and sort them
 * newest-first. Pure helper shared by search and the public law page.
 */
export function rankLawContent<T extends LawTextFields & { date: Date | null }>(items: T[], slug: string): T[] {
  return items
    .filter((item) => lawMentionForSlug(item, slug, "medium") !== null)
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

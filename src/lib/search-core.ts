/**
 * Pure search/ranking core for the merge-ready Koda data model. No Prisma, no
 * I/O — so it can be unit-tested with plain candidate objects. The DB
 * orchestration lives in search.ts.
 *
 * Estonian text matching is intentionally simple (normalized lowercase
 * substring/token matching). It is structured so PostgreSQL full-text/trigram
 * can replace the text scorer later without touching the rest.
 */
import { normalizeTitle } from "./hash";
import { publicTitle, publicSummary } from "./content-display";

// ---------------------------------------------------------------------------
// Query model
// ---------------------------------------------------------------------------

export type ResultType = "toovoit" | "arvamus" | "uudis" | "aastaaruanne" | "kontekst";
export const RESULT_TYPES: ResultType[] = ["toovoit", "arvamus", "uudis", "aastaaruanne", "kontekst"];

export type SearchQuery = {
  q: string;
  valdkond: string[]; // tag slugs (TagType.valdkond)
  tegevusala: string[]; // tag slugs (TagType.tegevusala)
  tapsustus: string[]; // tag slugs (TagType.tapsustus) — provisional, light weight
  type: ResultType[]; // optional result-type filter
};

type Raw = string | string[] | undefined;

function list(v: Raw): string[] {
  const raw = Array.isArray(v) ? v.join(",") : v || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function first(v: Raw): string {
  return (Array.isArray(v) ? v[0] : v) || "";
}

/**
 * Parse URL params into a SearchQuery. New params: q, valdkond, tegevusala,
 * tapsustus, type. Legacy params (sektor/huvid/tegevused/suurus) are mapped
 * into the free-text query for backward compatibility with old bookmarks.
 */
export function parseSearchParams(params: Record<string, Raw>): SearchQuery {
  const q = first(params.q).trim();
  const valdkond = list(params.valdkond);
  const tegevusala = list(params.tegevusala);
  const tapsustus = list(params.tapsustus);
  const type = list(params.type).filter((t): t is ResultType =>
    (RESULT_TYPES as string[]).includes(t)
  );

  // Backward compatibility: if no new params were given but legacy ones were,
  // fold the legacy slugs into the free-text query (best effort).
  const hasNew = q || valdkond.length || tegevusala.length || tapsustus.length || type.length;
  let effectiveQ = q;
  if (!hasNew) {
    const legacy = [...list(params.huvid), ...list(params.sektor), ...list(params.tegevused)]
      .map((s) => s.replace(/-/g, " "))
      .join(" ")
      .trim();
    if (legacy) effectiveQ = legacy;
  }

  return { q: effectiveQ, valdkond, tegevusala, tapsustus, type };
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return !q.q && !q.valdkond.length && !q.tegevusala.length && !q.tapsustus.length && !q.type.length;
}

// ---------------------------------------------------------------------------
// Candidate model
// ---------------------------------------------------------------------------

export type TagRef = { slug: string; name: string };

export type Candidate = {
  id: string;
  externalId: string | null;
  title: string;
  displayTitle: string | null;
  adminDisplayTitleOverride: string | null;
  summary: string | null;
  adminSummaryOverride: string | null;
  companyRelevance: string | null;
  kodaPosition: string | null;
  sourceEvidence: string | null;
  excerpt: string | null;
  bodyText: string | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
  sourceDataset: string | null;
  sourceLayer: string | null;
  sourceTypeDetail: string | null;
  publicDisplayStatus: string | null;
  outcomeStatus: string | null;
  publicPriority: string | null;
  manualWeight: number;
  isEvergreen: boolean;
  date: Date | null;
  canonicalContentId: string | null;
  duplicateStatus: string | null;
  contentHash: string | null;
  valdkonnad: TagRef[];
  tegevusalad: TagRef[];
  tapsustused: TagRef[];
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function isAchievement(c: Candidate): boolean {
  return c.sourceTypeDetail === "toovoit" || c.sourceLayer === "koda_achievement";
}

export type ResultKind = "toovoit" | "seisukoht" | "kontekst";

/** Which result group a candidate belongs to. */
export function assignKind(c: Candidate): ResultKind {
  if (isAchievement(c)) return "toovoit";
  if (c.sourceDataset === "annual_reports" || c.sourceLayer === "koda_workgroup_context")
    return "kontekst";
  return "seisukoht";
}

/** Primary result-type token (for the `type` filter). */
export function primaryType(c: Candidate): ResultType {
  if (isAchievement(c)) return "toovoit";
  if (c.sourceDataset === "annual_reports") return "aastaaruanne";
  if (c.sourceTypeDetail === "meie_uudis") return "uudis";
  if (c.sourceTypeDetail === "meie_arvamus_article" || c.sourceDataset === "opinions")
    return "arvamus";
  if (c.sourceLayer === "koda_workgroup_context") return "kontekst";
  return "uudis";
}

// ---------------------------------------------------------------------------
// Scoring (pure)
// ---------------------------------------------------------------------------

export type ScoreBreakdown = {
  text: number;
  filter: number;
  boost: number;
  total: number;
  /** distinct topic/sector/tapsustus matches, for the filter predicate */
  valdkondMatches: number;
  tegevusalaMatches: number;
};

function countTokens(haystack: string, tokens: string[]): number {
  let n = 0;
  for (const t of tokens) if (t && haystack.includes(t)) n++;
  return n;
}

function recencyBoost(date: Date | null): number {
  if (!date) return 0;
  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 90) return 16;
  if (ageDays <= 180) return 12;
  if (ageDays <= 365) return 8;
  if (ageDays <= 730) return 4;
  return 0;
}

export function scoreCandidate(c: Candidate, q: SearchQuery): ScoreBreakdown {
  // --- B. Text match ---
  let text = 0;
  const qn = normalizeTitle(q.q || "");
  const tokens = qn ? qn.split(" ").filter(Boolean) : [];
  if (qn) {
    const titleHay = normalizeTitle(publicTitle(c));
    if (titleHay === qn) text += 120;
    else if (titleHay.includes(qn)) text += 60;
    text += 12 * countTokens(titleHay, tokens);

    const strongHay = normalizeTitle(
      [publicSummary(c), c.kodaPosition, c.companyRelevance].filter(Boolean).join(" ")
    );
    text += 8 * countTokens(strongHay, tokens);

    const medHay = normalizeTitle([c.sourceEvidence, c.excerpt].filter(Boolean).join(" "));
    text += 5 * countTokens(medHay, tokens);

    const bodyHay = normalizeTitle(c.bodyText || "");
    text += 2 * countTokens(bodyHay, tokens);

    text = Math.min(text, 220); // cap so body spam cannot dominate
  }

  // --- C. Filter match ---
  const valdkondMatches = c.valdkonnad.filter((t) => q.valdkond.includes(t.slug)).length;
  const tegevusalaMatches = c.tegevusalad.filter((t) => q.tegevusala.includes(t.slug)).length;
  const tapsustusMatches = c.tapsustused.filter((t) => q.tapsustus.includes(t.slug)).length;
  let filter = 0;
  filter += Math.min(valdkondMatches, 2) * 40; // topic: high, capped
  filter += Math.min(tegevusalaMatches, 2) * 28; // sector: medium-high, capped
  filter += Math.min(tapsustusMatches, 2) * 8; // provisional: light, capped

  // --- D/E/F/G. Static boosts (always applied) ---
  let boost = 0;
  // Source / public-display priority. Töövõidud are the product's headline
  // result type and must rank strongly even when their title does not literally
  // contain the query word, so they get a large source boost.
  if (isAchievement(c)) boost += 90;
  else if (c.publicDisplayStatus === "main_result_candidate") boost += 30;
  else if (c.sourceLayer === "koda_news" || c.sourceLayer === "koda_public_opinion") boost += 12;
  else if (c.publicDisplayStatus === "annual_context") boost += 8;
  else if (c.publicDisplayStatus === "topic_history") boost += 4;

  // Outcome status.
  if (c.outcomeStatus === "achieved") boost += 20;
  else if (c.outcomeStatus === "partially_achieved") boost += 14;
  else if (c.outcomeStatus === "ongoing") boost += 10;

  // Priority / manual weight / evergreen.
  if (c.publicPriority === "high") boost += 15;
  else if (c.publicPriority === "medium") boost += 6;
  boost += c.manualWeight * 10;
  if (c.isEvergreen) boost += 6;

  // Small recency boost (capped, cannot outrank a strong achievement).
  boost += recencyBoost(c.date);

  return {
    text,
    filter,
    boost,
    total: text + filter + boost,
    valdkondMatches,
    tegevusalaMatches,
  };
}

/**
 * Does the candidate satisfy all *active* filters? AND across active
 * constraints. `tapsustus` is never required (provisional) — it only boosts.
 */
export function passesActiveFilters(q: SearchQuery, s: ScoreBreakdown, c: Candidate): boolean {
  if (q.q && s.text === 0) return false; // free text given but nothing matched
  if (q.valdkond.length && s.valdkondMatches === 0) return false;
  if (q.tegevusala.length && s.tegevusalaMatches === 0) return false;
  if (q.type.length && !q.type.includes(primaryType(c))) return false;
  return true;
}

export type RankedCandidate = { c: Candidate; total: number };

function dateMs(c: Candidate): number {
  return c.date?.getTime() ?? 0;
}

/**
 * Conservative public ordering: score still wins, but within a modest score
 * band recent ordinary content rises above older ordinary content. Strong old
 * achievements are intentionally protected by their larger source boost.
 */
export function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  const aKind = assignKind(a.c);
  const bKind = assignKind(b.c);
  const sameKind = aKind === bKind;
  const neitherAchievement = aKind !== "toovoit" && bKind !== "toovoit";
  const threshold = sameKind && neitherAchievement ? 32 : sameKind ? 12 : 0;

  if (threshold > 0 && Math.abs(a.total - b.total) <= threshold) {
    const byDate = dateMs(b.c) - dateMs(a.c);
    if (byDate !== 0) return byDate;
  }

  const byScore = b.total - a.total;
  if (byScore !== 0) return byScore;
  return dateMs(b.c) - dateMs(a.c);
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const OUTCOME_BADGE: Record<string, string> = {
  achieved: "Saavutatud",
  partially_achieved: "Osaliselt saavutatud",
  ongoing: "Käsil",
};

const TYPE_BADGE: Record<ResultType, string> = {
  toovoit: "Töövõit",
  arvamus: "Arvamus",
  uudis: "Uudis",
  aastaaruanne: "Aastaaruanne",
  kontekst: "Taust",
};

/**
 * Rank supporting opinion rows for a public parent by shared topic + light text
 * overlap, then cap. Pure — the caller supplies already-eligible opinion rows.
 */
export function rankRelatedOpinions(parent: Candidate, opinions: Candidate[], cap: number): Candidate[] {
  const parentValdkond = new Set(parent.valdkonnad.map((t) => t.slug));
  const parentHay = normalizeTitle(
    [publicTitle(parent), publicSummary(parent)].filter(Boolean).join(" ")
  );
  const parentTokens = parentHay.split(" ").filter((t) => t.length > 3).slice(0, 12);

  const scored = opinions
    .map((o) => {
      const shared = o.valdkonnad.filter((t) => parentValdkond.has(t.slug)).length;
      if (shared === 0) return { o, score: -1 };
      const hay = normalizeTitle(
        [publicTitle(o), publicSummary(o), o.sourceEvidence].filter(Boolean).join(" ")
      );
      const text = parentTokens.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
      return { o, score: shared * 10 + text };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, cap).map((x) => x.o);
}

export function buildBadges(c: Candidate): string[] {
  const badges: string[] = [];
  const t = primaryType(c);
  badges.push(TYPE_BADGE[t]);
  if (c.outcomeStatus && OUTCOME_BADGE[c.outcomeStatus] && t !== "toovoit") {
    badges.push(OUTCOME_BADGE[c.outcomeStatus]);
  } else if (t === "toovoit" && c.outcomeStatus === "partially_achieved") {
    badges.push(OUTCOME_BADGE.partially_achieved);
  }
  return badges;
}

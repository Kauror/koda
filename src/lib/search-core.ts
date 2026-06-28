/**
 * Pure search/ranking core for the merge-ready Koda data model. No Prisma, no
 * I/O, so it can be unit-tested with plain candidate objects. The DB
 * orchestration lives in search.ts.
 *
 * Estonian text matching is intentionally simple (normalized lowercase
 * substring/token matching). It is structured so PostgreSQL full-text/trigram
 * can replace the text scorer later without touching the rest.
 */
import { normalizeTitle } from "./hash";
import { publicSummary, publicTitle } from "./content-display";
import { canonicalTopicId } from "./topics";
import { rankingDateFor } from "./public-date";
import {
  genericSectorFallbackRequiresSignal,
  getSectorRelevance as getSectorRelevanceForScore,
  hasGenericSectorTag,
  sectorMatchesSlug,
} from "./sector-relevance";

export {
  getRelatedTopicsForSector,
  getSectorRelevance,
  getSectorRelevanceExplanation,
  genericSectorFallbackRequiresSignal,
  hasExactSectorMatch,
  hasGenericSectorTag,
  hasOnlyGenericOrNoSector,
  hasSpecificNonMatchingSector,
} from "./sector-relevance";
export type {
  SectorRelevanceExplanation,
  SectorRelevanceRule,
  SectorRelevanceScore,
} from "./sector-relevance";

// ---------------------------------------------------------------------------
// Query model
// ---------------------------------------------------------------------------

export type ResultType = "toovoit" | "arvamus" | "uudis" | "aastaaruanne" | "kontekst";
export const RESULT_TYPES: ResultType[] = ["toovoit", "arvamus", "uudis", "aastaaruanne", "kontekst"];

export type SearchQuery = {
  q: string;
  valdkond: string[]; // tag slugs (TagType.valdkond)
  tegevusala: string[]; // tag slugs (TagType.tegevusala)
  tapsustus: string[]; // tag slugs (TagType.tapsustus), provisional/light weight
  recipient: string[]; // recipientFilterGroup slugs (advanced metadata filter)
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
  const recipient = list(params.recipient);
  const type = list(params.type).filter((t): t is ResultType =>
    (RESULT_TYPES as string[]).includes(t)
  );

  const hasNew =
    q || valdkond.length || tegevusala.length || tapsustus.length || recipient.length || type.length;
  let effectiveQ = q;
  if (!hasNew) {
    const legacy = [...list(params.huvid), ...list(params.sektor), ...list(params.tegevused)]
      .map((s) => s.replace(/-/g, " "))
      .join(" ")
      .trim();
    if (legacy) effectiveQ = legacy;
  }

  return { q: effectiveQ, valdkond, tegevusala, tapsustus, recipient, type };
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return (
    !q.q &&
    !q.valdkond.length &&
    !q.tegevusala.length &&
    !q.tapsustus.length &&
    !q.recipient.length &&
    !q.type.length
  );
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
  oigusaktid: TagRef[];
  lawSearchAllowed: boolean;
  /** Slug of activity_primary, so a primary match can rank above a secondary one. */
  activityPrimarySlug: string | null;
  // Optional metadata used by the date-safety / related-content layers. Optional
  // so plain test candidates need not set them.
  /** Calendar year (source_year), used as a date fallback. */
  year?: number | null;
  /** Annual report year, used as a date fallback. */
  reportYear?: number | null;
  /** Classification confidence (high|medium|...|low), degrades date trust. */
  classificationConfidence?: string | null;
  /** v1 producer date precision (töövõit display_date_precision: day|month|year). */
  displayDatePrecision?: string | null;
  /** v1 producer date confidence (date_confidence: high|medium|low). */
  dateConfidence?: string | null;
  /** Policy-thread id (canonical_policy_thread_id), for strict related content. */
  topicGroupCandidate?: string | null;
  /** Recipient/ministry filter bucket (metadata only — never affects topic). */
  recipientFilterGroup?: string | null;
  /** Recipient/ministry display name (normalized). */
  recipientNormalized?: string | null;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function isAchievement(c: Candidate): boolean {
  return c.sourceTypeDetail === "toovoit" || c.sourceLayer === "koda_achievement";
}

export function isKodaNews(c: Candidate): boolean {
  return c.sourceTypeDetail === "meie_uudis" || c.sourceLayer === "koda_news";
}

export function isFormalOpinion(c: Candidate): boolean {
  return c.sourceTypeDetail === "meie_arvamus_article" || c.sourceLayer === "koda_public_opinion";
}

export type ResultKind = "toovoit" | "arvamus" | "uudis" | "kontekst";
export const RESULT_GROUPS: ResultKind[] = ["toovoit", "arvamus", "uudis", "kontekst"];

/** Which result group a candidate belongs to. */
export function assignKind(c: Candidate): ResultKind {
  if (isAchievement(c)) return "toovoit";
  if (c.sourceDataset === "annual_reports" || c.sourceLayer === "koda_workgroup_context") {
    return "kontekst";
  }
  if (isKodaNews(c)) return "uudis";
  return "arvamus";
}

/**
 * Whether a recipient/ministry chip may be shown on this card. Recipient is
 * content metadata for Koda opinions/seisukohad, not a property of every card:
 * show it on opinion ("arvamus") cards and on news cards that actually carry
 * recipient data (a news row only has a recipient when the source recorded which
 * ministry the Koda pöördumine/seisukoht was addressed to — i.e. the news is
 * about a Koda opinion). Never on töövõidud or annual/background (kontekst)
 * cards, and never when there is no recipient.
 */
export function shouldShowRecipientChip(opts: { kind: ResultKind; hasRecipient: boolean }): boolean {
  if (!opts.hasRecipient) return false;
  return opts.kind === "arvamus" || opts.kind === "uudis";
}

/** Primary result-type token (for the `type` filter). */
export function primaryType(c: Candidate): ResultType {
  if (isAchievement(c)) return "toovoit";
  if (c.sourceDataset === "annual_reports") return "aastaaruanne";
  if (isKodaNews(c)) return "uudis";
  if (isFormalOpinion(c) || c.sourceDataset === "opinions") return "arvamus";
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
  sectorFallbackMatches: number;
  sectorRelatedTopicMatches: number;
  sectorKeywordMatches: number;
  /** True when an active sector filter is satisfied via a cross-sector (valdkondadeülene) tag. */
  crossSectorMatch: boolean;
};

function countTokens(haystack: string, tokens: string[]): number {
  let n = 0;
  for (const t of tokens) if (t && haystack.includes(t)) n++;
  return n;
}

function lawHaystack(c: Candidate): string {
  return c.lawSearchAllowed ? normalizeTitle(c.oigusaktid.map((t) => t.name).join(" ")) : "";
}

export function isConservativeLawQuery(qn: string): boolean {
  return /\b(seadus|seadustik|määrus|maarus|direktiiv|regulatsioon)\b/u.test(qn) || qn.endsWith("seadus");
}

function matchesConfirmedLawQuery(c: Candidate, qn: string): boolean {
  const hay = lawHaystack(c);
  if (!hay || !qn) return false;
  return hay.includes(qn);
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

    const lawHay = lawHaystack(c);
    if (lawHay.includes(qn)) text += 70;
    text += 16 * countTokens(lawHay, tokens);

    const bodyHay = normalizeTitle(c.bodyText || "");
    text += 2 * countTokens(bodyHay, tokens);

    text = Math.min(text, 220); // cap so body spam cannot dominate
  }

  // Topic (valdkond) matching goes through the canonical taxonomy, not raw slug
  // equality: both the selected filter ids and the candidate's tags are
  // normalized to canonical topic ids. This lets a canonical filter (e.g.
  // "energia_elektrihind_varustuskindlus") match rows still tagged with a legacy
  // alias ("Energia") without exposing the alias as a filter option. (Sector /
  // tegevusala matching below is intentionally left unchanged.)
  const candidateTopicIds = new Set(
    c.valdkonnad.map((t) => canonicalTopicId(t.slug) ?? canonicalTopicId(t.name)).filter(Boolean) as string[]
  );
  const queryTopicIds = q.valdkond.map((v) => canonicalTopicId(v)).filter(Boolean) as string[];
  const valdkondMatches = queryTopicIds.filter((id) => candidateTopicIds.has(id)).length;
  const tegevusalaMatches = c.tegevusalad.filter((t) => sectorMatchesSlug(t.slug, q.tegevusala)).length;
  const tapsustusMatches = c.tapsustused.filter((t) => q.tapsustus.includes(t.slug)).length;
  const sectorActive = q.tegevusala.length > 0;
  // Tier 1: activity_primary matches the selected sector exactly.
  const primaryActivityMatch =
    sectorActive && c.activityPrimarySlug != null && sectorMatchesSlug(c.activityPrimarySlug, q.tegevusala);
  // Tier 3: a cross-sector ("Kõik tegevusalad / valdkondadeülene") tag applies to
  // every sector, so it's included under any specific filter (ranked lowest).
  const genericSectorMatch = sectorActive && tegevusalaMatches === 0 && hasGenericSectorTag(c);
  const genericNeedsRelevance = genericSectorMatch && genericSectorFallbackRequiresSignal(q.tegevusala);
  const crossSectorMatch = genericSectorMatch && !genericNeedsRelevance;
  // Conservative keyword/topic fallback only for rows with no sector, plus
  // signal-gated generic rows in sectors that need a narrower cross-sector gate.
  const sectorRelevance =
    tegevusalaMatches === 0 && (!genericSectorMatch || genericNeedsRelevance)
      ? getSectorRelevanceForScore(c, q.tegevusala)
      : { matches: 0, topicMatches: 0, keywordMatches: 0 };

  let filter = 0;
  filter += Math.min(valdkondMatches, 2) * 40; // topic: high, capped
  // Sector tiers: primary exact > secondary/other exact > cross-sector fallback.
  if (primaryActivityMatch) filter += 44; // tier 1: primary activity, strong
  else if (tegevusalaMatches > 0) filter += 28; // tier 2: secondary/other exact, medium
  else if (crossSectorMatch) filter += 10; // tier 3: cross-sector, lower
  filter += Math.min(sectorRelevance.topicMatches, 2) * 14; // related sector topic: medium
  filter += Math.min(sectorRelevance.matches, 1) * 6; // controlled sector fallback
  filter += Math.min(sectorRelevance.keywordMatches, 2) * 3; // keyword-only fallback: light
  filter += Math.min(tapsustusMatches, 2) * 8; // provisional: light, capped

  let boost = 0;
  // Toovoit rows are the product's headline result type and must rank strongly
  // even when their title does not literally contain the query word.
  if (isAchievement(c)) boost += 90;
  else if (c.publicDisplayStatus === "main_result_candidate") boost += 30;
  else if (c.sourceLayer === "koda_news" || c.sourceLayer === "koda_public_opinion") boost += 12;
  else if (c.publicDisplayStatus === "annual_context") boost += 8;
  else if (c.publicDisplayStatus === "topic_history") boost += 4;

  if (isKodaNews(c)) {
    const activeTopicOrSector =
      q.valdkond.length > 0 || q.tegevusala.length > 0 || q.tapsustus.length > 0;
    const directFilterMatch =
      valdkondMatches > 0 ||
      tegevusalaMatches > 0 ||
      sectorRelevance.matches > 0 ||
      crossSectorMatch ||
      tapsustusMatches > 0;
    const textMatch = q.q.length > 0 && text > 0;
    if (directFilterMatch || textMatch) boost += 12;
    if (activeTopicOrSector && tegevusalaMatches > 0) boost += 8;
    else if (activeTopicOrSector && (sectorRelevance.matches > 0 || crossSectorMatch)) boost += 4;
  }

  if (c.outcomeStatus === "achieved") boost += 20;
  else if (c.outcomeStatus === "partially_achieved") boost += 14;
  else if (c.outcomeStatus === "ongoing") boost += 10;

  if (c.publicPriority === "high") boost += 15;
  else if (c.publicPriority === "medium") boost += 6;
  boost += c.manualWeight * 10;
  if (c.isEvergreen) boost += 6;
  // Recency uses only a VERIFIED date (public-date gate): placeholder/import/
  // future dates (e.g. 2026-06-24, 31.12) must not buy a recency boost — that is
  // how uncertain rows were jumping to the top.
  //  - verified date  → normal recency boost;
  //  - a date that exists but is suspicious (placeholder/future/low-conf) → small
  //    penalty, so a fake-recent row ranks below genuinely recent content;
  //  - genuinely no date → neutral (0), so dateless töövõidud are not penalised.
  const verifiedDate = rankingDateFor({
    date: c.date,
    year: c.year ?? null,
    reportYear: c.reportYear ?? null,
    classificationConfidence: c.classificationConfidence ?? null,
    displayDatePrecision: c.displayDatePrecision ?? null,
    dateConfidence: c.dateConfidence ?? null,
  });
  if (verifiedDate) boost += recencyBoost(verifiedDate);
  else if (c.date) boost -= 4;

  return {
    text,
    filter,
    boost,
    total: text + filter + boost,
    valdkondMatches,
    tegevusalaMatches,
    sectorFallbackMatches: sectorRelevance.matches,
    sectorRelatedTopicMatches: sectorRelevance.topicMatches,
    sectorKeywordMatches: sectorRelevance.keywordMatches,
    crossSectorMatch,
  };
}

/**
 * Does the candidate satisfy all active filters? AND across active constraints.
 * `tapsustus` is never required (provisional), it only boosts.
 *
 * `opts.lawMatch` lets a confirmed legal-act match satisfy the free-text
 * requirement: a row that mentions the recognized law (possibly only in an
 * inflected form the literal text scorer missed) still qualifies. All other
 * active filters (valdkond/tegevusala/type) must still pass.
 */
export function passesActiveFilters(
  q: SearchQuery,
  s: ScoreBreakdown,
  c: Candidate,
  opts?: { lawMatch?: boolean; relaxLawGate?: boolean }
): boolean {
  const qn = normalizeTitle(q.q || "");
  // A law-looking query normally requires a confirmed law match — unless we've
  // relaxed the gate (no confirmed matches anywhere → fall back to normal search).
  if (q.q && isConservativeLawQuery(qn) && !opts?.lawMatch && !opts?.relaxLawGate && !matchesConfirmedLawQuery(c, qn)) {
    return false;
  }
  if (q.q && s.text === 0 && !opts?.lawMatch) return false;
  if (q.valdkond.length && s.valdkondMatches === 0) return false;
  if (q.tegevusala.length && s.tegevusalaMatches === 0 && s.sectorFallbackMatches === 0 && !s.crossSectorMatch) {
    return false;
  }
  // Recipient/ministry is an advanced metadata filter (AND constraint). It only
  // narrows results by recipientFilterGroup — it never affects topic scoring.
  if (q.recipient.length && !(c.recipientFilterGroup && q.recipient.includes(c.recipientFilterGroup))) {
    return false;
  }
  if (q.type.length && !q.type.includes(primaryType(c))) return false;
  return true;
}

export type RankedCandidate = { c: Candidate; total: number };
export type GroupCapMap = Record<ResultKind, number>;
export type RankedGroups = Record<ResultKind, RankedCandidate[]>;
export type ResultGroupCount = { matched: number; displayed: number; cap: number };
export type ResultGroupCounts = Record<ResultKind, ResultGroupCount>;

export type GroupedRankedCandidates = {
  allGroups: RankedGroups;
  displayedGroups: RankedGroups;
  displayed: RankedCandidate[];
  groupCounts: ResultGroupCounts;
  totalMatchedBeforeCaps: number;
  totalDisplayed: number;
};

function emptyRankedGroups(): RankedGroups {
  return { toovoit: [], arvamus: [], uudis: [], kontekst: [] };
}

export function groupRankedCandidates(scored: RankedCandidate[], caps: GroupCapMap): GroupedRankedCandidates {
  const allGroups = emptyRankedGroups();
  for (const s of scored) {
    allGroups[assignKind(s.c)].push(s);
  }

  const displayedGroups = emptyRankedGroups();
  const groupCounts = {} as ResultGroupCounts;
  for (const kind of RESULT_GROUPS) {
    displayedGroups[kind] = allGroups[kind].slice(0, caps[kind]);
    groupCounts[kind] = {
      matched: allGroups[kind].length,
      displayed: displayedGroups[kind].length,
      cap: caps[kind],
    };
  }

  const displayed = [
    ...displayedGroups.toovoit,
    ...displayedGroups.arvamus,
    ...displayedGroups.uudis,
    ...displayedGroups.kontekst,
  ];

  return {
    allGroups,
    displayedGroups,
    displayed,
    groupCounts,
    totalMatchedBeforeCaps: scored.length,
    totalDisplayed: displayed.length,
  };
}

function dateMs(c: Candidate): number {
  // Tie-break recency uses only the VERIFIED date (public-date gate), so a
  // placeholder/future date cannot push an uncertain row above a real one.
  const verified = rankingDateFor({
    date: c.date,
    year: c.year ?? null,
    reportYear: c.reportYear ?? null,
    classificationConfidence: c.classificationConfidence ?? null,
    displayDatePrecision: c.displayDatePrecision ?? null,
    dateConfidence: c.dateConfidence ?? null,
  });
  return verified?.getTime() ?? 0;
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
  const threshold = sameKind && aKind === "uudis" ? 48 : sameKind && neitherAchievement ? 32 : sameKind ? 12 : 0;

  if (threshold > 0 && Math.abs(a.total - b.total) <= threshold) {
    const byDate = dateMs(b.c) - dateMs(a.c);
    if (byDate !== 0) return byDate;
  }

  const byScore = b.total - a.total;
  if (byScore !== 0) return byScore;
  const byDate = dateMs(b.c) - dateMs(a.c);
  if (byDate !== 0) return byDate;
  // Fully tied: break by a stable id so ordering does not depend on the
  // (unordered) DB fetch order — keeps ranking deterministic across runs.
  return stableKey(a.c).localeCompare(stableKey(b.c));
}

/** Stable per-row key for deterministic final tie-breaking. */
function stableKey(c: Candidate): string {
  return c.externalId ?? c.id;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const TYPE_BADGE: Record<ResultType, string> = {
  toovoit: "Töövõit",
  arvamus: "Arvamus",
  uudis: "Uudis",
  aastaaruanne: "Aastaaruanne",
  kontekst: "Taust",
};

/**
 * Rank supporting opinion rows for a public parent by shared topic + light text
 * overlap, then cap. Pure; the caller supplies already-eligible opinion rows.
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
  const t = primaryType(c);
  return [TYPE_BADGE[t]];
}

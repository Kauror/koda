/**
 * Merge-ready search/ranking (v1). Fetches public-eligible candidates with
 * Prisma, scores them in TypeScript (search-core), groups the results and
 * attaches lightweight evidence hints from ContentEvidenceLink + supporting
 * opinions. See docs/search-ranking-v1.md.
 */
import { Prisma, TagType } from "@prisma/client";
import { prisma } from "./db";
import { isPublicSearchEligible } from "./eligibility";
import { detectLaw, extractLawMentions, lawMentionForSlug } from "./law-match";
import { slugify } from "./slug";
import { compactText, getCleanPublicExcerpt, publicSourceUrl, publicTitle, sourceCtaLabel } from "./content-display";
import {
  type Candidate,
  type ResultGroupCounts,
  type ResultKind,
  type ResultType,
  type SearchQuery,
  assignKind,
  buildBadges,
  compareRankedCandidates,
  groupRankedCandidates,
  isAchievement,
  isEmptyQuery,
  parseSearchParams,
  passesActiveFilters,
  primaryType,
  scoreCandidate,
} from "./search-core";

export { parseSearchParams };
export type { SearchQuery };

const GROUP_CAPS: Record<ResultKind, number> = { toovoit: 12, arvamus: 15, uudis: 12, kontekst: 10 };

/** Small bump so confirmed law content beats incidental text hits on tie dates. */
const LAW_MATCH_BOOST = 30;

/** A legal act recognized from the free-text query (drives law-aware search). */
export type RecognizedLaw = {
  slug: string;
  canonicalName: string;
  abbreviation: string | null;
  aliases: string[];
  relatedValdkond: string[];
  matchType: string;
  confidence: string;
};

// ---------------------------------------------------------------------------
// Candidate loading
// ---------------------------------------------------------------------------

export const candidateInclude = { tags: { include: { tag: true } } } satisfies Prisma.ContentItemInclude;
type ContentWithTags = Prisma.ContentItemGetPayload<{ include: typeof candidateInclude }>;

export function toCandidate(row: ContentWithTags): Candidate {
  const byType = (t: TagType) =>
    row.tags.filter((ct) => ct.tag.type === t).map((ct) => ({ slug: ct.tag.slug, name: ct.tag.name }));
  return {
    id: row.id,
    externalId: row.externalId,
    title: row.title,
    displayTitle: row.displayTitle,
    adminDisplayTitleOverride: row.adminDisplayTitleOverride,
    summary: row.summary,
    adminSummaryOverride: row.adminSummaryOverride,
    companyRelevance: row.companyRelevance,
    kodaPosition: row.kodaPosition,
    sourceEvidence: row.sourceEvidence,
    excerpt: row.excerpt,
    bodyText: row.bodyText,
    canonicalUrl: row.canonicalUrl,
    sourceUrl: row.sourceUrl,
    sourceDataset: row.sourceDataset,
    sourceLayer: row.sourceLayer,
    sourceTypeDetail: row.sourceTypeDetail,
    publicDisplayStatus: row.publicDisplayStatus,
    outcomeStatus: row.outcomeStatus,
    publicPriority: row.publicPriority,
    manualWeight: row.manualWeight,
    isEvergreen: row.isEvergreen,
    date: row.date,
    canonicalContentId: row.canonicalContentId,
    duplicateStatus: row.duplicateStatus,
    contentHash: row.contentHash,
    valdkonnad: byType(TagType.valdkond),
    tegevusalad: byType(TagType.tegevusala),
    tapsustused: byType(TagType.tapsustus),
    oigusaktid: byType(TagType.oigusakt),
    lawSearchAllowed: row.lawSearchAllowed,
    activityPrimarySlug: row.activityPrimary ? slugify(row.activityPrimary) : null,
  };
}

/** All rows that pass the public eligibility gate (defence-in-depth in TS). */
export async function fetchEligibleCandidates(): Promise<Candidate[]> {
  // Broad pre-filter; the TS gate makes the final decision. We do NOT add
  // `NOT: { adminVisibilityOverride: false }` here: on a nullable boolean that
  // SQL predicate also drops every row where the override IS NULL (almost all
  // rows). isPublicSearchEligible() excludes the explicit-false rows instead.
  const rows = await prisma.contentItem.findMany({
    where: { OR: [{ isPublic: true }, { adminVisibilityOverride: true }] },
    include: candidateInclude,
  });
  return rows.filter((r) => isPublicSearchEligible(r)).map(toCandidate);
}

// ---------------------------------------------------------------------------
// Filter options (built from imported DB tags, not the old constants)
// ---------------------------------------------------------------------------

export type FilterOption = { slug: string; name: string; count: number };
export type FilterOptions = {
  valdkonnad: FilterOption[];
  tegevusalad: FilterOption[];
  tapsustused: FilterOption[];
};

/** Tag filter options, restricted to tags with ≥1 public-eligible content item. */
export async function getFilterOptions(): Promise<FilterOptions> {
  const candidates = await fetchEligibleCandidates();
  const tally = (pick: (c: Candidate) => { slug: string; name: string }[]) => {
    const map = new Map<string, FilterOption>();
    for (const c of candidates)
      for (const t of pick(c)) {
        const e = map.get(t.slug) ?? { slug: t.slug, name: t.name, count: 0 };
        e.count++;
        map.set(t.slug, e);
      }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "et"));
  };
  return {
    valdkonnad: tally((c) => c.valdkonnad),
    tegevusalad: tally((c) => c.tegevusalad),
    tapsustused: tally((c) => c.tapsustused),
  };
}

/** Raw tag list for a type (admin/debug; not eligibility-filtered). */
export async function getTagsByType(type: TagType): Promise<{ slug: string; name: string }[]> {
  const tags = await prisma.tag.findMany({ where: { type }, orderBy: { name: "asc" } });
  return tags.map((t) => ({ slug: t.slug, name: t.name }));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type EvidenceHint = { annualContext: boolean; relatedOpinions: number };

export type ResultCard = {
  id: string;
  /** Stable identifier for the public detail route /sisu/[detailId]. */
  detailId: string;
  title: string;
  summary: string | null;
  url: string | null;
  sourceCtaLabel: string;
  date: string | null;
  kind: ResultKind;
  type: ResultType;
  isAchievement: boolean;
  outcomeStatus: string | null;
  badges: string[];
  valdkonnad: { slug: string; name: string }[];
  tegevusalad: { slug: string; name: string }[];
  /** Confirmed legal acts (õigusaktid) mentioned by this row; link to /seadused/[slug]. */
  laws: { slug: string; canonicalName: string }[];
  evidence: EvidenceHint;
  score: number;
};

export type SearchResults = {
  query: SearchQuery;
  achievements: ResultCard[];
  positions: ResultCard[];
  news: ResultCard[];
  context: ResultCard[];
  /** Compatibility alias for displayed rows after per-group caps. */
  total: number;
  totalMatchedBeforeCaps: number;
  totalDisplayed: number;
  groupCounts: ResultGroupCounts;
  includesRelatedSectorMatches: boolean;
  /** Set when the query was recognized as a legal act (law-aware, newest-first). */
  recognizedLaw: RecognizedLaw | null;
};

/** Drop duplicate/canonical rows so the same content is not shown twice. */
function dedupe(scored: { c: Candidate; total: number }[]): { c: Candidate; total: number }[] {
  const byExternal = new Map<string, boolean>();
  for (const s of scored) if (s.c.externalId) byExternal.set(s.c.externalId, true);

  // contentHash dedup: keep the highest-scoring copy (prefer canonical on ties).
  const bestByHash = new Map<string, { c: Candidate; total: number }>();
  const noHash: { c: Candidate; total: number }[] = [];
  for (const s of scored) {
    if (!s.c.contentHash) {
      noHash.push(s);
      continue;
    }
    const cur = bestByHash.get(s.c.contentHash);
    if (
      !cur ||
      s.total > cur.total ||
      (s.total === cur.total && s.c.duplicateStatus !== "possible_duplicate")
    ) {
      bestByHash.set(s.c.contentHash, s);
    }
  }
  const deduped = [...bestByHash.values(), ...noHash];

  // canonical linkage: drop a possible_duplicate when its canonical sibling is present.
  return deduped.filter((s) => {
    if (s.c.duplicateStatus === "possible_duplicate" && s.c.canonicalContentId) {
      return !byExternal.has(s.c.canonicalContentId);
    }
    return true;
  });
}

/** Newest-first ordering used for law-aware results (date wins, score breaks ties). */
function compareByDateThenScore(a: { c: Candidate; total: number }, b: { c: Candidate; total: number }): number {
  const ad = a.c.date?.getTime() ?? 0;
  const bd = b.c.date?.getTime() ?? 0;
  if (ad !== bd) return bd - ad;
  return b.total - a.total;
}

export async function search(query: SearchQuery): Promise<SearchResults> {
  const candidates = await fetchEligibleCandidates();
  const empty = isEmptyQuery(query);
  const recognized = detectLaw(query.q);

  // Score + filter. A confirmed law match satisfies the free-text requirement
  // (catching inflected mentions the literal scorer misses) and gets a small
  // bump; other active filters still apply.
  const scored: { c: Candidate; total: number }[] = [];
  for (const c of candidates) {
    const s = scoreCandidate(c, query);
    const lawMatch = recognized ? lawMentionForSlug(c, recognized.law.slug, "medium") !== null : false;
    if (!empty && !passesActiveFilters(query, s, c, { lawMatch })) continue;
    scored.push({ c, total: s.total + (lawMatch ? LAW_MATCH_BOOST : 0) });
  }

  // Law-aware searches surface the newest related content first.
  const deduped = dedupe(scored).sort(recognized ? compareByDateThenScore : compareRankedCandidates);

  const grouped = groupRankedCandidates(deduped, GROUP_CAPS);
  const groups = grouped.displayedGroups;
  const displayed = grouped.displayed;
  const evidence = await buildEvidence(displayed.map((s) => s.c));
  const includesRelatedSectorMatches =
    query.tegevusala.length > 0 &&
    displayed.some((s) => {
      const breakdown = scoreCandidate(s.c, query);
      return breakdown.tegevusalaMatches === 0 && breakdown.sectorFallbackMatches > 0;
    });

  const toCard = (s: { c: Candidate; total: number }): ResultCard => ({
    id: s.c.id,
    detailId: s.c.externalId ?? s.c.id,
    title: publicTitle(s.c),
    summary: compactText(getCleanPublicExcerpt(s.c), isAchievement(s.c) ? 180 : 260),
    url: publicSourceUrl(s.c),
    sourceCtaLabel: sourceCtaLabel(s.c),
    date: s.c.date ? s.c.date.toISOString() : null,
    kind: assignKind(s.c),
    type: primaryType(s.c),
    isAchievement: isAchievement(s.c),
    outcomeStatus: s.c.outcomeStatus,
    badges: buildBadges(s.c),
    valdkonnad: s.c.valdkonnad,
    tegevusalad: s.c.tegevusalad,
    laws: extractLawMentions(s.c)
      .filter((m) => m.confidence !== "low")
      .map((m) => ({ slug: m.slug, canonicalName: m.canonicalName })),
    evidence: evidence.get(s.c.id) ?? { annualContext: false, relatedOpinions: 0 },
    score: s.total,
  });

  return {
    query,
    achievements: groups.toovoit.map(toCard),
    positions: groups.arvamus.map(toCard),
    news: groups.uudis.map(toCard),
    context: groups.kontekst.map(toCard),
    total: grouped.totalDisplayed,
    totalMatchedBeforeCaps: grouped.totalMatchedBeforeCaps,
    totalDisplayed: grouped.totalDisplayed,
    groupCounts: grouped.groupCounts,
    includesRelatedSectorMatches,
    recognizedLaw: recognized
      ? {
          slug: recognized.law.slug,
          canonicalName: recognized.law.canonicalName,
          abbreviation: recognized.law.abbreviation ?? null,
          aliases: recognized.law.aliases ?? [],
          relatedValdkond: recognized.law.relatedValdkond ?? [],
          matchType: recognized.mention.matchType,
          confidence: recognized.mention.confidence,
        }
      : null,
  };
}

/**
 * Lightweight evidence hints for the displayed results (two batched queries):
 *  - annual-context flag from ContentEvidenceLink;
 *  - count of hidden/supporting opinion rows sharing a valdkond tag (capped 3).
 */
async function buildEvidence(cards: Candidate[]): Promise<Map<string, EvidenceHint>> {
  const out = new Map<string, EvidenceHint>();
  if (cards.length === 0) return out;
  const ids = cards.map((c) => c.id);

  // 1) Evidence links touching the displayed results.
  const links = await prisma.contentEvidenceLink.findMany({
    where: { OR: [{ fromContentId: { in: ids } }, { toContentId: { in: ids } }] },
    select: { fromContentId: true, toContentId: true, linkType: true },
  });
  const annualOf = new Set<string>();
  for (const l of links) {
    if (l.linkType === "annual_context") {
      annualOf.add(l.fromContentId);
      annualOf.add(l.toContentId);
    }
  }

  // 2) Hidden opinion rows per valdkond tag (one query, tallied in TS).
  const opinionTags = await prisma.contentTag.findMany({
    where: {
      tag: { type: TagType.valdkond },
      contentItem: { sourceDataset: "opinions", isPublic: false },
    },
    select: { tag: { select: { slug: true } } },
  });
  const opinionByValdkond = new Map<string, number>();
  for (const ct of opinionTags) {
    const slug = ct.tag.slug;
    opinionByValdkond.set(slug, (opinionByValdkond.get(slug) ?? 0) + 1);
  }

  for (const c of cards) {
    const related = Math.min(
      3,
      c.valdkonnad.reduce((max, t) => Math.max(max, opinionByValdkond.get(t.slug) ?? 0), 0)
    );
    out.set(c.id, { annualContext: annualOf.has(c.id), relatedOpinions: related });
  }
  return out;
}

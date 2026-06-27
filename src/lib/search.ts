/**
 * Merge-ready search/ranking (v1). Fetches public-eligible candidates with
 * Prisma, scores them in TypeScript (search-core), groups the results and
 * attaches lightweight evidence hints from ContentEvidenceLink + supporting
 * opinions. See docs/search-ranking-v1.md.
 */
import { Prisma, TagType } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import { isPublicSearchEligible } from "./eligibility";
import { buildLawChips, detectLaw, lawMentionForSlug, type LawChip } from "./law-match";
import { slugify } from "./slug";
import { firstTopic } from "./taxonomy-split";
import { PUBLIC_TOPIC_FILTERS, canonicalTopicId } from "./topics";
import { PUBLIC_ACTIVITY_FILTERS, canonicalPublicActivitySlug } from "./activities";
import { computePublicDate } from "./public-date";
import { normalizeTitle } from "./hash";
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
  isConservativeLawQuery,
  isEmptyQuery,
  parseSearchParams,
  passesActiveFilters,
  primaryType,
  scoreCandidate,
  shouldShowRecipientChip,
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

const CANDIDATE_CACHE_TTL_MS = 5 * 60 * 1000;
let candidateCache: { expiresAt: number; candidates: Candidate[] } | null = null;

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
    // Use the FIRST primary activity (repairing ";"-corruption / multi-value), so
    // its slug matches the imported tegevusala tag slug for the primary-tier boost.
    activityPrimarySlug: (() => {
      const first = firstTopic(row.activityPrimary);
      return first ? slugify(first) : null;
    })(),
    year: row.year,
    reportYear: row.reportYear,
    classificationConfidence: row.classificationConfidence,
    displayDatePrecision: row.displayDatePrecision,
    dateConfidence: row.dateConfidence,
    topicGroupCandidate: row.canonicalPolicyThreadId ?? row.topicGroupCandidate,
    recipientFilterGroup: row.recipientFilterGroup,
    recipientNormalized: row.recipientNormalized,
  };
}

/** All rows that pass the public eligibility gate (defence-in-depth in TS). */
export async function fetchEligibleCandidates(): Promise<Candidate[]> {
  const now = Date.now();
  if (candidateCache && candidateCache.expiresAt > now) return candidateCache.candidates;

  // Broad pre-filter; the TS gate makes the final decision. We do NOT add
  // `NOT: { adminVisibilityOverride: false }` here: on a nullable boolean that
  // SQL predicate also drops every row where the override IS NULL (almost all
  // rows). isPublicSearchEligible() excludes the explicit-false rows instead.
  const rows = await prisma.contentItem.findMany({
    where: { OR: [{ isPublic: true }, { adminVisibilityOverride: true }] },
    include: candidateInclude,
  });
  const candidates = rows.filter((r) => isPublicSearchEligible(r)).map(toCandidate);
  candidateCache = { expiresAt: now + CANDIDATE_CACHE_TTL_MS, candidates };
  return candidates;
}

// ---------------------------------------------------------------------------
// Filter options (built from imported DB tags, not the old constants)
// ---------------------------------------------------------------------------

export type FilterOption = { slug: string; name: string; count: number };
export type FilterOptions = {
  valdkonnad: FilterOption[];
  tegevusalad: FilterOption[];
  tapsustused: FilterOption[];
  /** Recipient/ministry advanced filter (metadata only). */
  recipients: FilterOption[];
};

/**
 * Filter options for the public UI.
 *
 *  - `valdkonnad` (Teema / valdkond) is built ONLY from the canonical public
 *    topic allowlist (PUBLIC_TOPIC_FILTERS, taxonomy v2.1.6), NOT from the
 *    distinct topic_primary/topic_secondary values on content rows. This keeps
 *    legacy aliases, short labels and the internal-only topic
 *    ("Õigusloome kvaliteet ja kaasamine") out of the public filter. The list is
 *    always the exact 26 canonical topics in canonical order; counts are tallied
 *    by normalizing each candidate's tags to canonical topic ids (so aliases
 *    fold into their canonical topic).
 *  - `tegevusalad` / `tapsustused` keep the dynamic behaviour (the activity /
 *    cross-sector filter logic must not change).
 */
async function buildFilterOptions(): Promise<FilterOptions> {
  const candidates = await fetchEligibleCandidates();

  // Topic counts per canonical id (aliases fold into their canonical topic).
  const topicCount = new Map<string, number>();
  for (const c of candidates) {
    const ids = new Set<string>();
    for (const t of c.valdkonnad) {
      const id = canonicalTopicId(t.slug) ?? canonicalTopicId(t.name);
      if (id) ids.add(id);
    }
    for (const id of ids) topicCount.set(id, (topicCount.get(id) ?? 0) + 1);
  }
  const valdkonnad: FilterOption[] = PUBLIC_TOPIC_FILTERS.map((o) => ({
    slug: o.slug,
    name: o.name,
    count: topicCount.get(o.slug) ?? 0,
  }));

  // Tegevusala (business sector): built ONLY from the canonical 12-sector
  // allowlist, in canonical order — never from distinct content values. This
  // excludes the cross-sector fallback label ("Kõik tegevusalad /
  // valdkondadeülene") and the energy-intensive company profile ("Energia ja
  // ressursimahukas tegevus") from the main filter. Cross-sector rows are still
  // included by search ranking (sector-relevance.ts), and the energy value is
  // still kept as an internal tag — neither is offered as a checkbox here.
  // Counts fold each candidate's sector tags into their canonical sector slug.
  const sectorCount = new Map<string, number>();
  for (const c of candidates) {
    const slugs = new Set<string>();
    for (const t of c.tegevusalad) {
      const slug = canonicalPublicActivitySlug(t);
      if (slug) slugs.add(slug);
    }
    for (const slug of slugs) sectorCount.set(slug, (sectorCount.get(slug) ?? 0) + 1);
  }
  const tegevusalad: FilterOption[] = PUBLIC_ACTIVITY_FILTERS.map((o) => ({
    slug: o.slug,
    name: o.name,
    count: sectorCount.get(o.slug) ?? 0,
  }));

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
  // Recipient/ministry advanced filter: distinct recipientFilterGroup buckets on
  // public-eligible rows (metadata only — independent of topic/sector). Rows with
  // no recipient simply don't appear under any recipient filter.
  const recipientMap = new Map<string, FilterOption>();
  for (const c of candidates) {
    const slug = c.recipientFilterGroup ?? null;
    if (!slug) continue;
    const e = recipientMap.get(slug) ?? { slug, name: c.recipientNormalized ?? slug, count: 0 };
    e.count++;
    recipientMap.set(slug, e);
  }
  const recipients = [...recipientMap.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "et")
  );

  return {
    valdkonnad,
    tegevusalad,
    tapsustused: tally((c) => c.tapsustused),
    recipients,
  };
}

export const getFilterOptions = unstable_cache(buildFilterOptions, ["koda-public-filter-options-v1"], {
  revalidate: 3600,
});

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
  /** Raw ISO of the stored date (may be a placeholder; prefer displayDate). */
  date: string | null;
  /** Safe, ready-to-render public date label, or null when suppressed. */
  displayDate: string | null;
  kind: ResultKind;
  type: ResultType;
  isAchievement: boolean;
  outcomeStatus: string | null;
  badges: string[];
  valdkonnad: { slug: string; name: string }[];
  tegevusalad: { slug: string; name: string }[];
  /**
   * Laws this row ties to: confirmed õigusakt tags (authoritative) merged with
   * dictionary text-mentions. `hasPage` ⇒ a /seadused/[slug] page exists; others
   * link to a filtered search. See buildLawChips.
   */
  laws: LawChip[];
  /**
   * Recipient/ministry chip (opinions / opinion-related news only): `name` is the
   * display label (e.g. "Rahandusministeerium"), `slug` is the recipient filter
   * group for the "same recipient" search link. Null when it must not be shown
   * (töövõidud, background, generic news, or no recipient).
   */
  recipient: { slug: string; name: string } | null;
  evidence: EvidenceHint;
  /**
   * Internal ranking total. Used by internal audit tooling (audit-freshness) and
   * server-side ordering only — it must NOT be exposed to public users. The
   * public /api/search route strips this field before responding.
   */
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

/** Verified ranking date (placeholder/import/future dates do not count). */
function verifiedDateMs(c: Candidate): number {
  return (
    computePublicDate({
      date: c.date,
      year: c.year ?? null,
      reportYear: c.reportYear ?? null,
      classificationConfidence: c.classificationConfidence ?? null,
      displayDatePrecision: c.displayDatePrecision ?? null,
      dateConfidence: c.dateConfidence ?? null,
    }).rankingDate?.getTime() ?? 0
  );
}

/** Newest-first ordering used for law-aware results (verified date wins, score breaks ties). */
function compareByDateThenScore(a: { c: Candidate; total: number }, b: { c: Candidate; total: number }): number {
  const ad = verifiedDateMs(a.c);
  const bd = verifiedDateMs(b.c);
  if (ad !== bd) return bd - ad;
  if (b.total !== a.total) return b.total - a.total;
  // Stable final tie-break so order does not depend on the unordered DB fetch.
  return (a.c.externalId ?? a.c.id).localeCompare(b.c.externalId ?? b.c.id);
}

export async function search(query: SearchQuery): Promise<SearchResults> {
  const candidates = await fetchEligibleCandidates();
  const empty = isEmptyQuery(query);
  const recognized = detectLaw(query.q);

  // Score + filter. A confirmed law match satisfies the free-text requirement
  // (catching inflected mentions the literal scorer misses) and gets a small
  // bump; other active filters still apply.
  const runFilter = (relaxLawGate: boolean): { c: Candidate; total: number }[] => {
    const out: { c: Candidate; total: number }[] = [];
    for (const c of candidates) {
      const s = scoreCandidate(c, query);
      const lawMatch = recognized ? lawMentionForSlug(c, recognized.law.slug, "medium") !== null : false;
      if (!empty && !passesActiveFilters(query, s, c, { lawMatch, relaxLawGate })) continue;
      out.push({ c, total: s.total + (lawMatch ? LAW_MATCH_BOOST : 0) });
    }
    return out;
  };

  let scored = runFilter(false);
  // A law-looking query (e.g. "uus seadus") with no confirmed law match anywhere
  // would otherwise return nothing; relax the law gate and fall back to normal
  // keyword search so the user still gets relevant text matches.
  if (scored.length === 0 && !empty && query.q && isConservativeLawQuery(normalizeTitle(query.q))) {
    scored = runFilter(true);
  }

  // Law-aware searches surface the newest related content first.
  const deduped = dedupe(scored).sort(recognized ? compareByDateThenScore : compareRankedCandidates);

  // News relevance threshold for activity-specific pages (trust/safety):
  // a "Koja uudised" row may appear under a selected Tegevusala only if it has a
  // real connection — exact/secondary sector, conservative sector-relevance,
  // a topic match, or a free-text match. A row that matches ONLY via the
  // cross-sector ("Kõik tegevusalad / valdkondadeülene") fallback and has no
  // other signal is dropped from news, so activity pages show fewer but relevant
  // news instead of being filled with unrelated cross-sector items. Töövõidud /
  // seisukohad keep their cross-sector fallback (handled by ranking).
  const sectorActive = query.tegevusala.length > 0;
  const newsRelevant = (c: Candidate): boolean => {
    const b = scoreCandidate(c, query);
    return (
      b.tegevusalaMatches > 0 ||
      b.sectorFallbackMatches > 0 ||
      b.valdkondMatches > 0 ||
      (query.q.length > 0 && b.text > 0)
    );
  };
  const ranked = sectorActive
    ? deduped.filter((s) => assignKind(s.c) !== "uudis" || newsRelevant(s.c))
    : deduped;

  const grouped = groupRankedCandidates(ranked, GROUP_CAPS);
  const groups = grouped.displayedGroups;
  const displayed = grouped.displayed;
  const evidence = await buildEvidence(displayed.map((s) => s.c));
  const includesRelatedSectorMatches =
    query.tegevusala.length > 0 &&
    displayed.some((s) => {
      const breakdown = scoreCandidate(s.c, query);
      return breakdown.tegevusalaMatches === 0 && breakdown.sectorFallbackMatches > 0;
    });

  const toCard = (s: { c: Candidate; total: number }): ResultCard => {
    const kind = assignKind(s.c);
    return {
    id: s.c.id,
    detailId: s.c.externalId ?? s.c.id,
    title: publicTitle(s.c),
    summary: compactText(getCleanPublicExcerpt(s.c), isAchievement(s.c) ? 180 : 260),
    url: publicSourceUrl(s.c),
    sourceCtaLabel: sourceCtaLabel(s.c),
    date: s.c.date ? s.c.date.toISOString() : null,
    // Public date safety gate: never render placeholder/import/future dates as
    // exact public dates (see public-date.ts).
    displayDate: computePublicDate({
      date: s.c.date,
      year: s.c.year ?? null,
      reportYear: s.c.reportYear ?? null,
      classificationConfidence: s.c.classificationConfidence ?? null,
      displayDatePrecision: s.c.displayDatePrecision ?? null,
      dateConfidence: s.c.dateConfidence ?? null,
    }).text,
    kind,
    type: primaryType(s.c),
    isAchievement: isAchievement(s.c),
    outcomeStatus: s.c.outcomeStatus,
    badges: buildBadges(s.c),
    valdkonnad: s.c.valdkonnad,
    tegevusalad: s.c.tegevusalad,
    laws: buildLawChips(s.c),
    recipient:
      shouldShowRecipientChip({ kind, hasRecipient: !!s.c.recipientNormalized }) && s.c.recipientNormalized
        ? { slug: s.c.recipientFilterGroup ?? slugify(s.c.recipientNormalized), name: s.c.recipientNormalized }
        : null,
    evidence: evidence.get(s.c.id) ?? { annualContext: false, relatedOpinions: 0 },
    score: s.total,
    };
  };

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

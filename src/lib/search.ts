/**
 * Merge-ready search/ranking (v1). Fetches public-eligible candidates with
 * Prisma, scores them in TypeScript (search-core), groups the results and
 * attaches lightweight evidence hints from ContentEvidenceLink + supporting
 * opinions. See docs/search-ranking-v1.md.
 */
import { EvidenceLinkType, Prisma, TagType } from "@prisma/client";
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
import {
  EMPTY_ALIAS_EXPANSION,
  expandSearchAliases,
  suggestRelatedSearches,
  type AliasExpansion,
  type RelatedSearchSuggestion,
  type SearchAliasRecord,
} from "./search-aliases";
import { compactText, getCleanPublicExcerpt, publicSourceUrl, publicTitle, sourceCtaLabel } from "./content-display";
import { pickPrimaryDoc } from "./source-documents";
import {
  resolveWorkWinNesting,
  timelineStageLabel,
  type WorkWinNesting,
  type WorkWinNestingInput,
  type WorkWinThread,
} from "./work-win-nesting";
import {
  type Candidate,
  type RankedCandidate,
  type ResultGroupCounts,
  type ResultKind,
  type ResultType,
  type SearchQuery,
  assignKind,
  compareRankedCandidatesForQuery,
  buildBadges,
  groupRankedCandidates,
  isAchievement,
  isConservativeLawQuery,
  isEmptyQuery,
  isFormalOpinion,
  isKodaNews,
  isMembershipValueIntent,
  parseSearchParams,
  passesActiveFilters,
  passesWorkWinDirectMatchGate,
  primaryType,
  resultCategoryRelevanceTier,
  scoreCandidate,
  shouldShowRecipientChip,
} from "./search-core";

export { parseSearchParams };
export type { SearchQuery };

// Display caps per group. Raised in v1.2 so the incremental "Näita rohkem"
// pagination (batches of ~10) has real content to reveal — the user pages
// through matches in batches instead of seeing everything (or only ~10) at once.
const GROUP_CAPS: Record<ResultKind, number> = { toovoit: 24, arvamus: 40, uudis: 24, kontekst: 20 };
const COMBINED_OPINION_NEWS_CAP = 64;

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
let aliasCache: { expiresAt: number; aliases: SearchAliasRecord[] } | null = null;

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
    adminTextOverride: row.adminTextOverride,
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
    publicDisplayRole: row.publicDisplayRole,
    outcomeStatus: row.outcomeStatus,
    publicPriority: row.publicPriority,
    contentRoleFinal: row.contentRoleFinal,
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
    rowOrigin: row.rowOrigin,
    displayType: row.displayType,
    parentToovoitId: row.parentToovoitId,
    parentCandidateId: row.parentCandidateId,
    policyThreadKey: row.policyThreadKey,
    policyThreadTitle: row.policyThreadTitle,
    timelineYear: row.timelineYear,
    timelineStage: row.timelineStage,
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

async function fetchSearchAliases(): Promise<SearchAliasRecord[]> {
  const now = Date.now();
  if (aliasCache && aliasCache.expiresAt > now) return aliasCache.aliases;

  try {
    const aliases = await prisma.searchAlias.findMany({
      orderBy: [{ weight: "desc" }, { id: "asc" }],
    });
    aliasCache = { expiresAt: now + CANDIDATE_CACHE_TTL_MS, aliases };
    return aliases;
  } catch (error) {
    console.error("Failed to load search aliases", error);
    aliasCache = { expiresAt: now + 30_000, aliases: [] };
    return [];
  }
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

/**
 * A nested/timeline töövõit item rendered inside a parent or policy-thread card
 * (v1.2). Never a standalone top-level card. Carries enough to render the compact
 * nested row: title, year/stage, short summary and a source link.
 */
export type NestedWorkWinCard = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  /** Safe public date label (placeholder/future suppressed). */
  displayDate: string | null;
  timelineYear: number | null;
  timelineStage: string | null;
  /** Estonian label for the stage (e.g. "Riigikogu vastuvõtmine"), or null. */
  timelineStageLabel: string | null;
  url: string | null;
  sourceCtaLabel: string;
  /** True when this nested item itself matched the active query/filters. */
  matched: boolean;
};

export type NestedRelatedCard = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  displayDate: string | null;
  url: string | null;
  sourceCtaLabel: string;
  badge: string;
};

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
  // --- v1.2 nesting / timeline ---
  /** True when this card represents a policy-thread timeline group, not one töövõit. */
  isThread?: boolean;
  /** Policy thread key (thread cards + parent cards that own thread children). */
  threadKey?: string | null;
  /** Nested/timeline children rendered in a compact section under this card. */
  nested?: NestedWorkWinCard[];
  /** Estonian heading for the nested section ("Seotud arengud" / "Sama teema ajajoon"). */
  nestedHeading?: string | null;
  /** Compact linked opinion/news rows folded under the public main card (v1.3). */
  relatedItems?: NestedRelatedCard[];
  /** Primary source PDF ("Vaata pöördumist") for opinion cards, or null. */
  sourcePdfUrl?: string | null;
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
  achievementsInitialVisible: number;
  opinionNews: ResultCard[];
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
  /** Public keyword chips related to the searched phrase, derived from SearchAlias. */
  relatedSearches: RelatedSearchSuggestion[];
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

// ---------------------------------------------------------------------------
// v1.2 töövõidud nesting: fold series/timeline rows under parent / thread cards
// ---------------------------------------------------------------------------

function toNestingInput(c: Candidate): WorkWinNestingInput {
  return {
    id: c.id,
    externalId: c.externalId,
    rowOrigin: c.rowOrigin ?? null,
    displayType: c.displayType ?? null,
    parentToovoitId: c.parentToovoitId ?? null,
    parentCandidateId: c.parentCandidateId ?? null,
    policyThreadKey: c.policyThreadKey ?? null,
    policyThreadTitle: c.policyThreadTitle ?? null,
    timelineYear: c.timelineYear ?? null,
    timelineStage: c.timelineStage ?? null,
  };
}

function toNestedWorkWinCard(c: Candidate, matched: boolean): NestedWorkWinCard {
  return {
    id: c.id,
    detailId: c.externalId ?? c.id,
    title: publicTitle(c),
    summary: compactText(getCleanPublicExcerpt(c), 200),
    displayDate: computePublicDate({
      date: c.date,
      year: c.year ?? null,
      reportYear: c.reportYear ?? null,
      classificationConfidence: c.classificationConfidence ?? null,
      displayDatePrecision: c.displayDatePrecision ?? null,
      dateConfidence: c.dateConfidence ?? null,
    }).text,
    timelineYear: c.timelineYear ?? null,
    timelineStage: c.timelineStage ?? null,
    timelineStageLabel: timelineStageLabel(c.timelineStage),
    url: publicSourceUrl(c),
    sourceCtaLabel: sourceCtaLabel(c),
    matched,
  };
}

/** A top-level public opinion/news display unit, with linked rows folded underneath. */
type OpinionNewsLink = {
  fromContentId: string;
  toContentId: string;
  linkType: EvidenceLinkType;
  relationRole: string | null;
  relationLabelEt: string | null;
  linkConfidence: string | null;
  sortPriority: number | null;
};

type OpinionNewsUnit = {
  main: RankedCandidate;
  related: { c: Candidate; sortPriority: number }[];
};

const OPINION_NEWS_LINK_TYPES = new Set<EvidenceLinkType>([
  EvidenceLinkType.supporting_opinion,
  EvidenceLinkType.same_policy_thread,
  EvidenceLinkType.public_explanation,
  EvidenceLinkType.source_evidence,
  EvidenceLinkType.related_opinion,
  EvidenceLinkType.related_news,
]);

function isOpinionNewsKind(c: Candidate): boolean {
  return isFormalOpinion(c) || isKodaNews(c) || c.sourceDataset === "opinions";
}

function isAllowedCombinedLink(link: OpinionNewsLink): boolean {
  if (!OPINION_NEWS_LINK_TYPES.has(link.linkType)) return false;
  if (!link.linkConfidence) return true;
  return ["high", "curated_medium"].includes(link.linkConfidence);
}

function policyThreadKey(c: Candidate): string | null {
  return c.topicGroupCandidate?.trim() || c.policyThreadKey?.trim() || null;
}

function verifiedDateText(c: Candidate): string | null {
  return computePublicDate({
    date: c.date,
    year: c.year ?? null,
    reportYear: c.reportYear ?? null,
    classificationConfidence: c.classificationConfidence ?? null,
    displayDatePrecision: c.displayDatePrecision ?? null,
    dateConfidence: c.dateConfidence ?? null,
  }).text;
}

function toNestedRelatedCard(c: Candidate): NestedRelatedCard {
  return {
    id: c.id,
    detailId: c.externalId ?? c.id,
    title: publicTitle(c),
    summary: compactText(getCleanPublicExcerpt(c), 180),
    displayDate: verifiedDateText(c),
    url: publicSourceUrl(c),
    sourceCtaLabel: sourceCtaLabel(c),
    badge: buildBadges(c)[0] ?? (isKodaNews(c) ? "Uudis" : "Arvamus"),
  };
}

function linkLooksLikeNewsExplainer(link: OpinionNewsLink): boolean {
  const text = [link.linkType, link.relationRole, link.relationLabelEt].filter(Boolean).join(" ").toLowerCase();
  return (
    link.linkType === EvidenceLinkType.public_explanation ||
    link.linkType === EvidenceLinkType.related_news ||
    text.includes("explanation") ||
    text.includes("explainer") ||
    text.includes("selgit")
  );
}

function sortNestedRelated(a: { c: Candidate; sortPriority: number }, b: { c: Candidate; sortPriority: number }): number {
  if (b.sortPriority !== a.sortPriority) return b.sortPriority - a.sortPriority;
  const byDate = verifiedDateMs(b.c) - verifiedDateMs(a.c);
  if (byDate !== 0) return byDate;
  return (a.c.externalId ?? a.c.id).localeCompare(b.c.externalId ?? b.c.id);
}

async function buildCombinedOpinionNewsUnits(ranked: RankedCandidate[], query: SearchQuery, aliases?: AliasExpansion): Promise<OpinionNewsUnit[]> {
  const rows = ranked.filter((s) => isOpinionNewsKind(s.c));
  if (rows.length === 0) return [];

  const byId = new Map(rows.map((s) => [s.c.id, s]));
  const ids = [...byId.keys()];
  const links = (await prisma.contentEvidenceLink.findMany({
    where: { OR: [{ fromContentId: { in: ids } }, { toContentId: { in: ids } }] },
    select: {
      fromContentId: true,
      toContentId: true,
      linkType: true,
      relationRole: true,
      relationLabelEt: true,
      linkConfidence: true,
      sortPriority: true,
    },
  })) as OpinionNewsLink[];

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ar = find(a);
    const br = find(b);
    if (ar !== br) parent.set(br, ar);
  };
  ids.forEach((id) => parent.set(id, id));

  const linkByPair = new Map<string, OpinionNewsLink>();
  const pairKey = (a: string, b: string) => [a, b].sort().join("::");
  for (const link of links) {
    if (!isAllowedCombinedLink(link)) continue;
    const a = byId.get(link.fromContentId)?.c;
    const b = byId.get(link.toContentId)?.c;
    if (!a || !b) continue;
    if (assignKind(a) === assignKind(b) && link.relationRole !== "manual_admin") continue;
    union(a.id, b.id);
    const key = pairKey(a.id, b.id);
    const current = linkByPair.get(key);
    if (!current || (link.sortPriority ?? 0) > (current.sortPriority ?? 0)) linkByPair.set(key, link);
  }

  const byThread = new Map<string, string[]>();
  for (const { c } of rows) {
    const key = policyThreadKey(c);
    if (!key) continue;
    const list = byThread.get(key) ?? [];
    list.push(c.id);
    byThread.set(key, list);
  }
  for (const threadIds of byThread.values()) {
    const kinds = new Set(threadIds.map((id) => assignKind(byId.get(id)!.c)));
    if (!kinds.has("arvamus") || !kinds.has("uudis")) continue;
    for (let i = 1; i < threadIds.length; i++) union(threadIds[0], threadIds[i]);
  }

  const components = new Map<string, RankedCandidate[]>();
  for (const row of rows) {
    const root = find(row.c.id);
    const list = components.get(root) ?? [];
    list.push(row);
    components.set(root, list);
  }

  const hasExplainerOpinionLink = (candidate: Candidate, group: RankedCandidate[]): boolean => {
    if (!isKodaNews(candidate)) return false;
    return group.some(({ c }) => {
      if (!(isFormalOpinion(c) || c.sourceDataset === "opinions")) return false;
      const link = linkByPair.get(pairKey(candidate.id, c.id));
      if (link) return linkLooksLikeNewsExplainer(link) || link.linkType === EvidenceLinkType.same_policy_thread;
      const sharedThread = policyThreadKey(candidate) && policyThreadKey(candidate) === policyThreadKey(c);
      return !!sharedThread;
    });
  };

  const chooseMain = (group: RankedCandidate[]): RankedCandidate => {
    const maxTier = Math.max(...group.map((s) => resultCategoryRelevanceTier(s.c, query)));
    const hasManualAdminLink = group.some((a, index) =>
      group
        .slice(index + 1)
        .some((b) => linkByPair.get(pairKey(a.c.id, b.c.id))?.relationRole === "manual_admin")
    );
    return [...group].sort((a, b) => {
      const aTier = resultCategoryRelevanceTier(a.c, query);
      const bTier = resultCategoryRelevanceTier(b.c, query);
      if (bTier !== aTier) return bTier - aTier;
      if (hasManualAdminLink) {
        const byDate = verifiedDateMs(b.c) - verifiedDateMs(a.c);
        if (byDate !== 0) return byDate;
        if (b.total !== a.total) return b.total - a.total;
        return (a.c.externalId ?? a.c.id).localeCompare(b.c.externalId ?? b.c.id);
      }
      const aExplainer = hasExplainerOpinionLink(a.c, group) ? 28 : 0;
      const bExplainer = hasExplainerOpinionLink(b.c, group) ? 28 : 0;
      const aAuthority = isFormalOpinion(a.c) || a.c.sourceDataset === "opinions" ? 14 : 0;
      const bAuthority = isFormalOpinion(b.c) || b.c.sourceDataset === "opinions" ? 14 : 0;
      const aDirectPenalty = aTier < maxTier ? -60 : 0;
      const bDirectPenalty = bTier < maxTier ? -60 : 0;
      const adjustedA = a.total + aExplainer + aAuthority + aDirectPenalty;
      const adjustedB = b.total + bExplainer + bAuthority + bDirectPenalty;
      if (adjustedB !== adjustedA) return adjustedB - adjustedA;
      const byDate = verifiedDateMs(b.c) - verifiedDateMs(a.c);
      if (byDate !== 0) return byDate;
      return (a.c.externalId ?? a.c.id).localeCompare(b.c.externalId ?? b.c.id);
    })[0];
  };

  const units: OpinionNewsUnit[] = [];
  for (const group of components.values()) {
    const kinds = new Set(group.map((s) => assignKind(s.c)));
    const hasManualAdminLink = group.some((a, index) =>
      group
        .slice(index + 1)
        .some((b) => linkByPair.get(pairKey(a.c.id, b.c.id))?.relationRole === "manual_admin")
    );
    if (group.length < 2 || (!hasManualAdminLink && (!kinds.has("arvamus") || !kinds.has("uudis")))) {
      for (const single of group) units.push({ main: single, related: [] });
      continue;
    }
    const main = chooseMain(group);
    const related = group
      .filter((s) => s.c.id !== main.c.id)
      .map((s) => {
        const link = linkByPair.get(pairKey(main.c.id, s.c.id));
        return {
          c: s.c,
          sortPriority: link?.sortPriority ?? 0,
        };
      })
      .sort(sortNestedRelated);
    units.push({ main, related });
  }

  return units.sort((a, b) => compareRankedCandidatesForQuery(query, aliases)(a.main, b.main));
}

/** A top-level töövõit display unit aggregated from matched rows. */
type WorkWinUnit =
  | { kind: "card"; parentId: string; score: number; relevanceTier: number; latestDateMs: number; matchedChildIds: Set<string> }
  | { kind: "thread"; threadKey: string; score: number; relevanceTier: number; latestDateMs: number; matchedChildIds: Set<string> };

/** Stable sort key for a unit (parent id / thread key), for deterministic ties. */
function unitKey(u: WorkWinUnit): string {
  return u.kind === "card" ? `card:${u.parentId}` : `thread:${u.threadKey}`;
}

/**
 * Aggregate matched töövõit rows into top-level units so series/timeline rows
 * never become duplicate flat cards:
 *  - a matched standalone row → its own card unit;
 *  - a matched nested row with a top-level parent → folds into the parent card
 *    unit (the parent surfaces even if it did not match itself);
 *  - a matched nested row in a policy thread → folds into that thread unit.
 * Unit score = best matching member score, so a unit ranks by its strongest hit.
 * Unit date = newest verified date among its matched members, used as the
 * recency tie-break so equally-relevant töövõidud show the latest one first.
 */
function aggregateWorkWinUnits(matched: RankedCandidate[], nesting: WorkWinNesting, query: SearchQuery): WorkWinUnit[] {
  const units = new Map<string, WorkWinUnit>();
  const bump = (
    key: string,
    make: () => WorkWinUnit,
    score: number,
    relevanceTier: number,
    dateMs: number,
    matchedChild?: string
  ) => {
    let u = units.get(key);
    if (!u) {
      u = make();
      units.set(key, u);
    }
    u.score = Math.max(u.score, score);
    u.relevanceTier = Math.max(u.relevanceTier, relevanceTier);
    u.latestDateMs = Math.max(u.latestDateMs, dateMs);
    if (matchedChild) u.matchedChildIds.add(matchedChild);
  };

  for (const { c, total } of matched) {
    const dateMs = verifiedDateMs(c);
    const relevanceTier = resultCategoryRelevanceTier(c, query);
    if (nesting.topLevelIds.has(c.id)) {
      bump(
        `card:${c.id}`,
        () => ({ kind: "card", parentId: c.id, score: total, relevanceTier, latestDateMs: dateMs, matchedChildIds: new Set() }),
        total,
        relevanceTier,
        dateMs
      );
      continue;
    }
    const parentId = nesting.parentIdByMemberId.get(c.id);
    if (parentId) {
      bump(
        `card:${parentId}`,
        () => ({ kind: "card", parentId, score: total, relevanceTier, latestDateMs: dateMs, matchedChildIds: new Set() }),
        total,
        relevanceTier,
        dateMs,
        c.id
      );
      continue;
    }
    const threadKey = nesting.threadKeyByMemberId.get(c.id);
    if (threadKey) {
      bump(
        `thread:${threadKey}`,
        () => ({ kind: "thread", threadKey, score: total, relevanceTier, latestDateMs: dateMs, matchedChildIds: new Set() }),
        total,
        relevanceTier,
        dateMs,
        c.id
      );
    }
    // A nested row with no parent and no thread was rejected at import; skip here.
  }

  // Relevance first, recency second: direct category units beat fallback units;
  // similarly relevant töövõidud show the newest one first.
  return [...units.values()].sort(
    (a, b) =>
      b.relevanceTier - a.relevanceTier ||
      b.latestDateMs - a.latestDateMs ||
      b.score - a.score ||
      unitKey(a).localeCompare(unitKey(b))
  );
}

/** Build a synthetic policy-thread timeline card from its member candidates. */
function buildThreadResultCard(
  thread: WorkWinThread,
  members: Candidate[],
  score: number,
  matchedChildIds: Set<string>
): ResultCard {
  // Members arrive latest-first (compareTimelineDesc), so the newest stage is the
  // representative the thread card summarises and links to.
  const latest = members[0];
  return {
    id: `thread:${thread.key}`,
    detailId: latest.externalId ?? latest.id,
    title: thread.title ?? publicTitle(latest),
    summary: compactText(getCleanPublicExcerpt(latest), 220),
    url: null,
    sourceCtaLabel: sourceCtaLabel(latest),
    date: null,
    displayDate: null,
    kind: "toovoit",
    type: "toovoit",
    isAchievement: true,
    outcomeStatus: null,
    badges: [],
    valdkonnad: latest.valdkonnad,
    tegevusalad: latest.tegevusalad,
    laws: buildLawChips(latest),
    recipient: null,
    evidence: { annualContext: false, relatedOpinions: 0 },
    isThread: true,
    threadKey: thread.key,
    nested: members.map((m) => toNestedWorkWinCard(m, matchedChildIds.has(m.id))),
    nestedHeading: "Sama teema ajajoon",
    score,
  };
}

function toResultCard(s: { c: Candidate; total: number }, evidence: Map<string, EvidenceHint>): ResultCard {
  const kind = assignKind(s.c);
  return {
    id: s.c.id,
    detailId: s.c.externalId ?? s.c.id,
    title: publicTitle(s.c),
    summary: compactText(getCleanPublicExcerpt(s.c), isAchievement(s.c) ? 180 : 260),
    url: publicSourceUrl(s.c),
    sourceCtaLabel: sourceCtaLabel(s.c),
    date: s.c.date ? s.c.date.toISOString() : null,
    displayDate: isAchievement(s.c) ? null : computePublicDate({
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
}

function buildWorkWinResultCards(
  candidates: Candidate[],
  units: WorkWinUnit[],
  nesting: WorkWinNesting,
  evidence: Map<string, EvidenceHint>
): ResultCard[] {
  const candById = new Map(candidates.map((c) => [c.id, c]));
  const threadByKey = new Map(nesting.threads.map((t) => [t.key, t]));
  const cards: ResultCard[] = [];

  for (const u of units) {
    if (u.kind === "card") {
      const parent = candById.get(u.parentId);
      if (!parent) continue;
      const card = toResultCard({ c: parent, total: u.score }, evidence);
      const childIds = nesting.childrenByParentId.get(u.parentId) ?? [];
      const children = childIds.map((id) => candById.get(id)).filter((c): c is Candidate => !!c);
      if (children.length) {
        card.nested = children.map((c) => toNestedWorkWinCard(c, u.matchedChildIds.has(c.id)));
        card.nestedHeading = "Seotud arengud";
        card.threadKey = parent.policyThreadKey ?? null;
      }
      cards.push(card);
      continue;
    }

    const thread = threadByKey.get(u.threadKey);
    if (!thread) continue;
    const members = thread.memberIds.map((id) => candById.get(id)).filter((c): c is Candidate => !!c);
    if (!members.length) continue;
    cards.push(buildThreadResultCard(thread, members, u.score, u.matchedChildIds));
  }

  return cards;
}

export async function getAllWorkWinCards(): Promise<ResultCard[]> {
  const candidates = await fetchEligibleCandidates();
  const workWins = candidates.filter((c) => isAchievement(c));
  const nesting = resolveWorkWinNesting(workWins.map(toNestingInput));
  const query: SearchQuery = { q: "", valdkond: [], tegevusala: [], tapsustus: [], recipient: [], type: [] };
  const matched = workWins.map((c) => ({ c, total: scoreCandidate(c, query).total }));
  const units = aggregateWorkWinUnits(matched, nesting, query).sort(
    (a, b) => b.latestDateMs - a.latestDateMs || unitKey(a).localeCompare(unitKey(b))
  );
  const parentCandidates = units
    .filter((u): u is Extract<WorkWinUnit, { kind: "card" }> => u.kind === "card")
    .map((u) => candidates.find((c) => c.id === u.parentId))
    .filter((c): c is Candidate => !!c);
  const evidence = await buildEvidence(parentCandidates);
  return buildWorkWinResultCards(candidates, units, nesting, evidence);
}

export async function search(query: SearchQuery): Promise<SearchResults> {
  const [candidates, aliases] = await Promise.all([
    fetchEligibleCandidates(),
    query.q ? fetchSearchAliases() : Promise.resolve([]),
  ]);
  const aliasExpansion = query.q ? expandSearchAliases(query.q, aliases) : EMPTY_ALIAS_EXPANSION;
  const relatedSearches = query.q ? suggestRelatedSearches(query.q, aliases, aliasExpansion) : [];
  const empty = isEmptyQuery(query);
  const recognized = detectLaw(query.q);

  // Free-text work-win precision gate context. The stricter töövõit gate applies
  // ONLY when the user typed something (normalized q non-empty); pure filter
  // browsing (empty q) keeps the existing filter-match behavior for work wins.
  const qn = normalizeTitle(query.q || "");
  const gateTokens = qn ? qn.split(" ").filter(Boolean) : [];
  const membershipIntent = isMembershipValueIntent(qn);
  const categoryActive = query.valdkond.length > 0 || query.tegevusala.length > 0 || query.tapsustus.length > 0;

  // Score + filter. A confirmed law match satisfies the free-text requirement
  // (catching inflected mentions the literal scorer misses) and gets a small
  // bump; other active filters still apply.
  const runFilter = (relaxLawGate: boolean): { c: Candidate; total: number }[] => {
    const out: { c: Candidate; total: number }[] = [];
    for (const c of candidates) {
      const s = scoreCandidate(c, query, aliasExpansion);
      const lawMatch = recognized ? lawMentionForSlug(c, recognized.law.slug, "medium") !== null : false;
      if (!empty && !passesActiveFilters(query, s, c, { lawMatch, relaxLawGate })) continue;
      // Work wins must clear the stricter direct-match gate on free-text queries,
      // so the +90 type boost can no longer rescue a weak/broad-topic match. The
      // boost still applies AFTER this gate (score is unchanged) for wins that pass.
      if (qn.length > 0 && isAchievement(c) &&
        !passesWorkWinDirectMatchGate(c, {
          qn,
          tokens: gateTokens,
          aliases: aliasExpansion,
          membershipIntent,
          categoryActive,
          lawMatch,
          score: s,
        })
      ) {
        continue;
      }
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
  const deduped = dedupe(scored).sort(recognized ? compareByDateThenScore : compareRankedCandidatesForQuery(query, aliasExpansion));

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
    const b = scoreCandidate(c, query, aliasExpansion);
    return (
      b.tegevusalaMatches > 0 ||
      b.sectorFallbackMatches > 0 ||
      b.valdkondMatches > 0 ||
      (query.q.length > 0 && (b.text > 0 || b.alias > 0))
    );
  };
  const ranked = sectorActive
    ? deduped.filter((s) => assignKind(s.c) !== "uudis" || newsRelevant(s.c))
    : deduped;

  // v1.2: töövõidud are grouped into top-level UNITS (standalone cards + policy-
  // thread cards) so the 14 series/nested rows never appear as duplicate flat
  // cards. The other three groups keep the existing pure grouping. Nesting is
  // resolved over ALL eligible töövõidud (not just matches) so a parent/thread
  // surfaces even when only a child matched the query.
  const candById = new Map(candidates.map((c) => [c.id, c]));
  const nesting = resolveWorkWinNesting(candidates.filter((c) => isAchievement(c)).map(toNestingInput));

  const rankedOther = ranked.filter((s) => !isAchievement(s.c));
  const grouped = groupRankedCandidates(rankedOther, GROUP_CAPS);
  const groups = grouped.displayedGroups;
  const opinionNewsUnits = await buildCombinedOpinionNewsUnits(rankedOther, query, aliasExpansion);
  const displayedOpinionNewsUnits = opinionNewsUnits.slice(0, COMBINED_OPINION_NEWS_CAP);

  const toovoitUnits = aggregateWorkWinUnits(
    ranked.filter((s) => isAchievement(s.c)),
    nesting,
    query
  );
  const displayedToovoitUnits = toovoitUnits.slice(0, GROUP_CAPS.toovoit);
  // categoryActive is declared once near the top of search() (used by the gate).
  const directToovoitUnits = categoryActive ? toovoitUnits.filter((u) => u.relevanceTier >= 4).length : 0;
  const achievementsInitialVisible =
    categoryActive && directToovoitUnits > 0
      ? Math.min(3, directToovoitUnits, displayedToovoitUnits.length)
      : Math.min(3, displayedToovoitUnits.length);

  // Candidates whose evidence hints we need: displayed non-töövõit + the parent
  // representative of each displayed töövõit card unit.
  const toovoitParentCandidates = displayedToovoitUnits
    .filter((u): u is Extract<WorkWinUnit, { kind: "card" }> => u.kind === "card")
    .map((u) => candById.get(u.parentId))
    .filter((c): c is Candidate => !!c);
  const displayedCandidates = [
    ...displayedOpinionNewsUnits.map((u) => u.main.c),
    ...groups.kontekst.map((s) => s.c),
    ...toovoitParentCandidates,
  ];

  const evidence = await buildEvidence(displayedCandidates);
  const includesRelatedSectorMatches =
    query.tegevusala.length > 0 &&
    displayedCandidates.some((c) => {
      const breakdown = scoreCandidate(c, query);
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
    displayDate: isAchievement(s.c) ? null : computePublicDate({
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

  // Build the töövõit cards from the aggregated units: standalone/parent cards
  // (with their nested children folded in) + synthetic policy-thread cards.
  const threadByKey = new Map(nesting.threads.map((t) => [t.key, t]));
  const achievements: ResultCard[] = [];
  for (const u of displayedToovoitUnits) {
    if (u.kind === "card") {
      const parent = candById.get(u.parentId);
      if (!parent) continue;
      const card = toCard({ c: parent, total: u.score });
      const childIds = nesting.childrenByParentId.get(u.parentId) ?? [];
      const children = childIds.map((id) => candById.get(id)).filter((c): c is Candidate => !!c);
      if (children.length) {
        card.nested = children.map((c) => toNestedWorkWinCard(c, u.matchedChildIds.has(c.id)));
        card.nestedHeading = "Seotud arengud";
        card.threadKey = parent.policyThreadKey ?? null;
      }
      achievements.push(card);
    } else {
      const thread = threadByKey.get(u.threadKey);
      if (!thread) continue;
      const members = thread.memberIds.map((id) => candById.get(id)).filter((c): c is Candidate => !!c);
      if (!members.length) continue;
      achievements.push(buildThreadResultCard(thread, members, u.score, u.matchedChildIds));
    }
  }

  // Merge counts: töövõit unit counts replace the (empty) toovoit group from the
  // other-grouping; the other three groups keep their pure counts.
  const opinionNews = displayedOpinionNewsUnits.map((unit) => {
    const card = toCard(unit.main);
    if (unit.related.length > 0) {
      card.relatedItems = unit.related.map((item) => toNestedRelatedCard(item.c));
    }
    return card;
  });

  // Attach the primary source PDF ("Vaata pöördumist") to displayed opinion cards.
  const positions = groups.arvamus.map(toCard);
  await attachOpinionSourcePdfs([opinionNews, positions]);

  const groupCounts: typeof grouped.groupCounts = {
    ...grouped.groupCounts,
    toovoit: {
      matched: toovoitUnits.length,
      displayed: achievements.length,
      cap: GROUP_CAPS.toovoit,
    },
  };
  const totalDisplayed = achievements.length + opinionNews.length + groups.kontekst.length;
  const totalMatchedBeforeCaps =
    toovoitUnits.length +
    opinionNewsUnits.length +
    grouped.allGroups.kontekst.length;

  return {
    query,
    achievements,
    achievementsInitialVisible,
    opinionNews,
    positions,
    news: groups.uudis.map(toCard),
    context: groups.kontekst.map(toCard),
    total: totalDisplayed,
    totalMatchedBeforeCaps,
    totalDisplayed,
    groupCounts,
    includesRelatedSectorMatches,
    relatedSearches,
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
 * Set `sourcePdfUrl` ("Vaata pöördumist") on displayed opinion cards from their
 * primary VERIFIED SourceDocument (one batched query). Non-opinion cards and
 * opinions without a verified PDF are left untouched — never a broken link.
 */
async function attachOpinionSourcePdfs(cardGroups: ResultCard[][]): Promise<void> {
  const opinionCards = cardGroups.flat().filter((c) => c.type === "arvamus");
  const externalIds = [...new Set(opinionCards.map((c) => c.detailId))];
  if (externalIds.length === 0) return;
  const docs = await prisma.sourceDocument.findMany({
    where: { contentExternalId: { in: externalIds }, kind: "opinion_pdf", fileVerified: true },
  });
  const byExternalId = new Map<string, typeof docs>();
  for (const d of docs) {
    if (!d.contentExternalId) continue;
    const list = byExternalId.get(d.contentExternalId) ?? [];
    list.push(d);
    byExternalId.set(d.contentExternalId, list);
  }
  for (const card of opinionCards) {
    const primary = pickPrimaryDoc(byExternalId.get(card.detailId) ?? []);
    if (primary) card.sourcePdfUrl = primary.pdfUrl;
  }
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

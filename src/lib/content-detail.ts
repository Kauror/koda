/**
 * Public detail page data. Public pages render a clean reader-facing summary;
 * backend evidence/source metadata remains available in this layer for future
 * admin use, but is not exposed by the public route.
 */
import { TagType } from "@prisma/client";
import { prisma } from "./db";
import { isEvidenceEligible, isPublicSearchEligible } from "./eligibility";
import {
  firstCleanPublicParagraph,
  getCleanPublicExcerpt,
  getPublicDetailSummary,
  publicSourceUrl,
  publicTitle,
  sourceCtaLabel,
} from "./content-display";
import { datasetLabel, outcomeLabel, sourceLabel } from "./labels";
import {
  type Candidate,
  assignKind,
  buildBadges,
  isAchievement,
  isFormalOpinion,
  isKodaNews,
  shouldShowRecipientChip,
} from "./search-core";
import { candidateInclude, toCandidate } from "./search";
import { canonicalPublicValdkonnad } from "./topics";
import { displayablePublicActivities } from "./activities";
import { buildLawChips, type LawChip } from "./law-match";
import { slugify } from "./slug";
import { computePublicDate } from "./public-date";
import { qualifiesAsLawTopicRelation } from "./related";
import { compareTimelineDesc, isNestedDisplay, timelineStageLabel, type WorkWinNestingInput } from "./work-win-nesting";
import {
  filterPublicThreadMembers,
  resolveThreadMembers,
  roleLabel,
  toThreadItemMeta,
} from "./content-threads";
import { pickPrimaryDoc } from "./source-documents";

const TOPIC_HISTORY_CAP = 4;
const DUPLICATE_CAP = 4;

export type EvidenceRow = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  date: string | null;
  /** Safe public date label (placeholder/import/future dates suppressed). */
  displayDate: string | null;
  year: number | null;
  sourceLabel: string;
  sourceUrl: string | null;
  sourceCtaLabel: string;
  isPublic: boolean;
  timelineYear?: number | null;
  timelineStage?: string | null;
};

/** A nested/timeline töövõit row shown under a parent or in a policy thread (v1.2). */
export type NestedDetailRow = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  displayDate: string | null;
  timelineYear: number | null;
  timelineStage: string | null;
  timelineStageLabel: string | null;
  sourceUrl: string | null;
  sourceCtaLabel: string;
  /** True when this row is the page currently being viewed. */
  isCurrent: boolean;
};

/** v1.2 nesting context for a töövõit detail page. */
export type WorkWinNestingDetail = {
  /** This work win's parent card (when this row is nested under an existing one). */
  parent: { detailId: string; title: string } | null;
  /** Child timeline/series rows folded under this (top-level) work win. */
  children: NestedDetailRow[];
  /** Policy thread this row belongs to, with its full timeline (incl. this row). */
  thread: { key: string; title: string | null; items: NestedDetailRow[] } | null;
};

/** One item in a public admin-managed topic thread timeline. */
export type ThreadTimelineItem = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  displayDate: string | null;
  year: number | null;
  role: string | null;
  roleLabel: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  sourceCtaLabel: string;
  isCurrent: boolean;
  isAnchor: boolean;
};

/** A public (status=public) admin thread the viewed item belongs to. */
export type ThreadTimelineDetail = {
  slug: string;
  title: string;
  description: string | null;
  items: ThreadTimelineItem[];
};

export type AchievementEnrichmentView = {
  outcome: string | null;
  regulatoryArea: string | null;
  valueType: string | null;
  kodaRole: string | null;
  numericImpactStatement: string | null;
  sourceEvidence: string | null;
};

export type ContentDetail = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  companyRelevance: string | null;
  kodaPosition: string | null;
  sourceEvidence: string | null;
  excerpt: string | null;
  bodySnippet: string | null;
  date: string | null;
  /** Safe public date label (placeholder/import/future dates suppressed). */
  displayDate: string | null;
  year: number | null;
  reportYear: number | null;
  isAchievement: boolean;
  isNews: boolean;
  // Töövõit value fields (v1). Rendered on the achievement detail page.
  whatChanged: string | null;
  kodaRole: string | null;
  businessValue: string | null;
  beforeAfter: string | null;
  badges: string[];
  sourceLabel: string;
  datasetLabel: string;
  outcomeLabel: string | null;
  sourceUrl: string | null;
  sourceCtaLabel: string;
  canonicalUrl: string | null;
  sourceFileName: string | null;
  sourceSection: string | null;
  valdkonnad: { slug: string; name: string }[];
  tegevusalad: { slug: string; name: string }[];
  tapsustused: { slug: string; name: string }[];
  /** Laws this row ties to (confirmed õigusakt tags + dictionary mentions). */
  laws: LawChip[];
  /** Recipient/ministry chip (opinions / opinion-related news only), or null. */
  recipient: { slug: string; name: string } | null;
  enrichment: AchievementEnrichmentView | null;
  /** v1.2 nesting/timeline context (töövõidud only; null otherwise). */
  workWinNesting: WorkWinNestingDetail | null;
  /** Public admin-managed topic thread timeline this item belongs to, or null. */
  thread: ThreadTimelineDetail | null;
  /** Primary source PDF ("Vaata pöördumist") for opinions, or null. */
  sourcePdf: { url: string; filename: string } | null;
  evidence: {
    annualContext: EvidenceRow[];
    duplicates: EvidenceRow[];
    relatedOpinions: EvidenceRow[];
    topicHistory: EvidenceRow[];
    timeline: EvidenceRow[];
  };
};

function detailIdOf(c: { externalId: string | null; id: string }): string {
  return c.externalId ?? c.id;
}

function toEvidenceRow(c: Candidate, isPublic: boolean): EvidenceRow {
  const pd = computePublicDate({
    date: c.date,
    year: c.year ?? null,
    reportYear: c.reportYear ?? null,
    classificationConfidence: c.classificationConfidence ?? null,
    displayDatePrecision: c.displayDatePrecision ?? null,
    dateConfidence: c.dateConfidence ?? null,
  });
  return {
    id: c.id,
    detailId: detailIdOf(c),
    title: publicTitle(c),
    summary: getCleanPublicExcerpt(c),
    date: c.date ? c.date.toISOString() : null,
    displayDate: pd.text,
    year: pd.year,
    sourceLabel: sourceLabel(c.sourceLayer, c.sourceTypeDetail),
    sourceUrl: publicSourceUrl(c),
    sourceCtaLabel: sourceCtaLabel(c),
    isPublic,
    timelineYear: c.timelineYear ?? null,
    timelineStage: c.timelineStage ?? null,
  };
}

export async function getContentDetail(id: string): Promise<ContentDetail | null> {
  const item = await prisma.contentItem.findFirst({
    where: { OR: [{ externalId: id }, { id }] },
    include: { ...candidateInclude, achievementEnrichment: true },
  });
  if (!item) return null;
  if (!isPublicSearchEligible(item)) return null;

  const c = toCandidate(item);
  const enr = item.achievementEnrichment;
  const evidence = await getEvidenceForContent(c);
  const workWinNesting = await getWorkWinNesting(c);
  const thread = await getPublicThreadTimeline(item);
  const sourcePdf = await getOpinionSourcePdf(c);

  return {
    id: c.id,
    detailId: detailIdOf(c),
    title: publicTitle(c),
    summary: getPublicDetailSummary(c),
    companyRelevance: c.companyRelevance,
    kodaPosition: c.kodaPosition,
    sourceEvidence: c.sourceEvidence,
    excerpt: c.excerpt,
    bodySnippet: pickBodySnippet(c),
    date: c.date ? c.date.toISOString() : null,
    displayDate: computePublicDate({
      date: c.date,
      year: item.year,
      reportYear: item.reportYear,
      classificationConfidence: item.classificationConfidence,
      displayDatePrecision: item.displayDatePrecision,
      dateConfidence: item.dateConfidence,
    }).text,
    year: item.year,
    reportYear: item.reportYear,
    isAchievement: isAchievement(c),
    isNews: isKodaNews(c),
    whatChanged: item.whatChangedEt,
    kodaRole: item.kodaRoleEt ?? c.kodaPosition,
    businessValue: item.businessValueEt ?? c.companyRelevance,
    beforeAfter: item.beforeAfterEt,
    badges: buildBadges(c),
    sourceLabel: sourceLabel(c.sourceLayer, c.sourceTypeDetail),
    datasetLabel: datasetLabel(c.sourceDataset),
    outcomeLabel: outcomeLabel(c.outcomeStatus),
    sourceUrl: publicSourceUrl(c),
    sourceCtaLabel: sourceCtaLabel(c),
    canonicalUrl: c.canonicalUrl,
    sourceFileName: item.sourceFileName,
    sourceSection: item.sourceSection,
    // Public display: canonical public topic labels only (no legacy aliases /
    // internal-only). The raw c.valdkonnad slugs are still used for the
    // related-content query below.
    valdkonnad: canonicalPublicValdkonnad(c.valdkonnad),
    // Never expose the internal cross-sector fallback activity as a public chip.
    tegevusalad: displayablePublicActivities(c.tegevusalad),
    tapsustused: c.tapsustused,
    laws: buildLawChips(c),
    recipient:
      shouldShowRecipientChip({ kind: assignKind(c), hasRecipient: !!c.recipientNormalized }) && c.recipientNormalized
        ? { slug: c.recipientFilterGroup ?? slugify(c.recipientNormalized), name: c.recipientNormalized }
        : null,
    enrichment: enr
      ? {
          outcome: outcomeLabel(enr.outcomeStatus) ?? enr.outcomeStatus,
          regulatoryArea: enr.regulatoryArea,
          valueType: enr.valueType,
          kodaRole: enr.kodaRole,
          numericImpactStatement: enr.numericImpactStatement,
          sourceEvidence: enr.sourceEvidence,
        }
      : null,
    workWinNesting,
    thread,
    sourcePdf,
    evidence,
  };
}

/**
 * The primary source PDF ("Vaata pöördumist") for an opinion. Only VERIFIED files
 * (confirmed on disk at import) are returned, so the link is never broken. Non-
 * opinion rows and unmatched opinions return null.
 */
async function getOpinionSourcePdf(
  c: Candidate
): Promise<{ url: string; filename: string } | null> {
  if (!c.externalId || !(isFormalOpinion(c) || c.sourceDataset === "opinions")) return null;
  const docs = await prisma.sourceDocument.findMany({
    where: { contentExternalId: c.externalId, kind: "opinion_pdf", fileVerified: true },
  });
  const primary = pickPrimaryDoc(docs);
  return primary ? { url: primary.pdfUrl, filename: primary.pdfFilename } : null;
}

/**
 * Public timeline for an admin-managed topic thread the viewed item belongs to.
 *
 * Safety: only threads with status=public are considered, and every member is
 * re-resolved (by stable externalId) and re-filtered through the same
 * `isPublicSearchEligible` gate (`filterPublicThreadMembers`) — draft/internal
 * threads and non-eligible members never leak. Returns null unless there are at
 * least two eligible members (a single item is not a timeline). This does not
 * affect search or ranking.
 */
async function getPublicThreadTimeline(
  item: { id: string; externalId: string | null }
): Promise<ThreadTimelineDetail | null> {
  if (!item.externalId) return null;

  // The highest-priority PUBLIC thread this item belongs to, with all its
  // members — one query (the DB does the status filter + priority ordering).
  const thread = await prisma.contentThread.findFirst({
    where: { status: "public", items: { some: { contentExternalId: item.externalId } } },
    orderBy: [{ sortPriority: "desc" }, { createdAt: "asc" }],
    include: { items: true },
  });
  if (!thread) return null;

  const externalIds = thread.items.map((i) => i.contentExternalId);
  const rows = externalIds.length
    ? await prisma.contentItem.findMany({
        where: { externalId: { in: externalIds } },
        include: candidateInclude,
      })
    : [];

  const { members } = resolveThreadMembers(thread.items.map(toThreadItemMeta), rows);
  const publicMembers = filterPublicThreadMembers(thread.status, members);
  if (publicMembers.length < 2) return null;

  const items: ThreadTimelineItem[] = publicMembers.map((m) => {
    const cand = toCandidate(m.content);
    const pd = computePublicDate({
      date: cand.date,
      year: cand.year ?? null,
      reportYear: cand.reportYear ?? null,
      classificationConfidence: cand.classificationConfidence ?? null,
      displayDatePrecision: cand.displayDatePrecision ?? null,
      dateConfidence: cand.dateConfidence ?? null,
    });
    return {
      id: cand.id,
      detailId: detailIdOf(cand),
      title: publicTitle(cand),
      summary: getCleanPublicExcerpt(cand),
      displayDate: pd.text,
      year: pd.year,
      role: m.meta.role,
      roleLabel: m.meta.role ? roleLabel(m.meta.role) : null,
      sourceLabel: sourceLabel(cand.sourceLayer, cand.sourceTypeDetail),
      sourceUrl: publicSourceUrl(cand),
      sourceCtaLabel: sourceCtaLabel(cand),
      isCurrent: cand.id === item.id,
      isAnchor: m.meta.isAnchor,
    };
  });

  return { slug: thread.slug, title: thread.title, description: thread.description, items };
}

/**
 * v1.2 nesting/timeline context for a töövõit detail page:
 *  - `parent`: the existing card this row is nested under (parent_toovoit_id);
 *  - `children`: series/timeline rows folded under this (top-level) work win;
 *  - `thread`: the policy thread this row belongs to, with its full timeline.
 * Returns null for non-töövõidud and for standalone work wins with no relations.
 */
async function getWorkWinNesting(c: Candidate): Promise<WorkWinNestingDetail | null> {
  if (!isAchievement(c)) return null;

  const toInput = (cand: Candidate): WorkWinNestingInput => ({
    id: cand.id,
    externalId: cand.externalId,
    rowOrigin: cand.rowOrigin ?? null,
    displayType: cand.displayType ?? null,
    parentToovoitId: cand.parentToovoitId ?? null,
    parentCandidateId: cand.parentCandidateId ?? null,
    policyThreadKey: cand.policyThreadKey ?? null,
    policyThreadTitle: cand.policyThreadTitle ?? null,
    timelineYear: cand.timelineYear ?? null,
    timelineStage: cand.timelineStage ?? null,
  });
  const toRow = (cand: Candidate, isCurrent: boolean): NestedDetailRow => ({
    id: cand.id,
    detailId: detailIdOf(cand),
    title: publicTitle(cand),
    summary: getCleanPublicExcerpt(cand),
    displayDate: computePublicDate({
      date: cand.date,
      year: cand.year ?? null,
      reportYear: cand.reportYear ?? null,
      classificationConfidence: cand.classificationConfidence ?? null,
      displayDatePrecision: cand.displayDatePrecision ?? null,
      dateConfidence: cand.dateConfidence ?? null,
    }).text,
    timelineYear: cand.timelineYear ?? null,
    timelineStage: cand.timelineStage ?? null,
    timelineStageLabel: timelineStageLabel(cand.timelineStage),
    sourceUrl: publicSourceUrl(cand),
    sourceCtaLabel: sourceCtaLabel(cand),
    isCurrent,
  });

  // Parent card (when this row is nested under an existing töövõit).
  let parent: WorkWinNestingDetail["parent"] = null;
  if (c.parentToovoitId) {
    const p = await prisma.contentItem.findFirst({
      where: { externalId: c.parentToovoitId, isPublic: true },
      include: candidateInclude,
    });
    if (p && isPublicSearchEligible(p)) {
      const pc = toCandidate(p);
      parent = { detailId: detailIdOf(pc), title: publicTitle(pc) };
    }
  }

  // Children folded under this (top-level) work win (parent_toovoit_id === me).
  let children: NestedDetailRow[] = [];
  if (c.externalId) {
    const rows = await prisma.contentItem.findMany({
      where: { parentToovoitId: c.externalId, isPublic: true },
      include: candidateInclude,
    });
    const cands = rows.filter(isEvidenceEligible).map(toCandidate);
    cands.sort((a, b) => compareTimelineDesc(toInput(a), toInput(b)));
    children = cands.map((cc) => toRow(cc, false));
  }

  // Policy thread (rows sharing the same policy_thread_key) — only a real thread
  // when there is at least one sibling beyond this row.
  let thread: WorkWinNestingDetail["thread"] = null;
  if (c.policyThreadKey && isNestedDisplay(c.displayType)) {
    const rows = await prisma.contentItem.findMany({
      where: { policyThreadKey: c.policyThreadKey, isPublic: true },
      include: candidateInclude,
    });
    const cands = rows.filter(isEvidenceEligible).map(toCandidate);
    if (cands.length > 1) {
      cands.sort((a, b) => compareTimelineDesc(toInput(a), toInput(b)));
      const title = cands.map((x) => x.policyThreadTitle).find((t): t is string => !!t) ?? null;
      thread = { key: c.policyThreadKey, title, items: cands.map((cc) => toRow(cc, cc.id === c.id)) };
    }
  }

  if (!parent && children.length === 0 && !thread) return null;
  return { parent, children, thread };
}

function pickBodySnippet(c: Candidate): string | null {
  return firstCleanPublicParagraph(c.bodyText);
}

function candidateText(c: Candidate): string {
  return [publicTitle(c), getCleanPublicExcerpt(c)].filter(Boolean).join(" ");
}

/**
 * "Veel samal teemal" (related content). Trust/safety: related items must have a
 * concrete justified relation, NOT just a shared broad topic/activity/type/year
 * (which previously surfaced unrelated rows — youth work, foreign labour, court
 * proceedings, fuel excise — on an unrelated work win). Allowed sources, in
 * priority order:
 *   1. explicit curated/cluster evidence links (approved web↔opinion,
 *      achievement↔matched article, duplicate↔canonical);
 *   2. same policy thread (canonical_policy_thread_id / topicGroupCandidate);
 *   3. same confirmed law tag AND a shared narrow topic AND strong title/body
 *      text overlap.
 * Fewer or zero related items is acceptable and preferred over loose matches.
 */
export async function getEvidenceForContent(parent: Candidate): Promise<ContentDetail["evidence"]> {
  const empty = { annualContext: [], duplicates: [], relatedOpinions: [], topicHistory: [], timeline: [] };

  // (1) Explicit evidence links touching this item (both directions). All of
  // these link types are curated/cluster relations created at import time, so
  // they are trustworthy related content (unlike a broad topic query).
  const links = await prisma.contentEvidenceLink.findMany({
    where: { OR: [{ fromContentId: parent.id }, { toContentId: parent.id }] },
    select: { fromContentId: true, toContentId: true, linkType: true, sortPriority: true },
  });
  const annualIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const linkedRelatedIds = new Set<string>();
  // Order related ids by the v1 link sort_priority (higher first), falling back
  // to DB order. public_related_links carries a curated sort_priority (10–40).
  const priorityOf = new Map<string, number>();
  for (const link of links) {
    const other = link.fromContentId === parent.id ? link.toContentId : link.fromContentId;
    if (other === parent.id) continue;
    if (link.linkType === "annual_context") annualIds.add(other);
    else if (link.linkType === "duplicate_canonical") duplicateIds.add(other);
    // supporting_opinion / topic_history / annual_context / duplicate_canonical and
    // the v1 cross-layer relation types (related_opinion/related_news/
    // related_work_win/...) are all explicit curated relations worth surfacing.
    linkedRelatedIds.add(other);
    priorityOf.set(other, Math.max(priorityOf.get(other) ?? -1, link.sortPriority ?? 0));
  }
  const linkedRelatedOrdered = [...linkedRelatedIds].sort((a, b) => (priorityOf.get(b) ?? 0) - (priorityOf.get(a) ?? 0));

  // (2) Same policy thread (canonical_policy_thread_id) — a deliberate cluster.
  const threadId = parent.topicGroupCandidate?.trim() || null;
  const threadIds = new Set<string>();
  if (threadId) {
    const threadRows = await prisma.contentItem.findMany({
      where: { id: { not: parent.id }, isPublic: true, topicGroupCandidate: threadId },
      include: candidateInclude,
      take: TOPIC_HISTORY_CAP * 3,
    });
    for (const row of threadRows) if (isEvidenceEligible(row)) threadIds.add(row.id);
  }

  const parentKeys = [parent.externalId, parent.id].filter((value): value is string => !!value);
  const timelineRows = await prisma.contentItem.findMany({
    where: {
      id: { not: parent.id },
      OR: [
        { parentToovoitId: { in: parentKeys } },
        { parentCandidateId: { in: parentKeys } },
        ...(parent.policyThreadKey ? [{ policyThreadKey: parent.policyThreadKey }] : []),
      ],
      displayType: { in: ["nested_under_existing_card", "nested_under_new_series_card", "timeline_item_in_policy_thread"] },
    },
    include: candidateInclude,
    take: 12,
  });
  const timeline = timelineRows
    .filter((row) => isEvidenceEligible(row) && isPublicSearchEligible(row))
    .map((row) => toEvidenceRow(toCandidate(row), true))
    .sort((a, b) => (a.timelineYear ?? a.year ?? 0) - (b.timelineYear ?? b.year ?? 0));

  // (3) Same confirmed law tag + shared narrow topic + strong text overlap.
  const lawSlugs = parent.oigusaktid.map((t) => t.slug);
  const valdkondSlugs = parent.valdkonnad.map((t) => t.slug);
  const lawTopicMatches: { c: Candidate; eligible: boolean }[] = [];
  if (lawSlugs.length && valdkondSlugs.length) {
    const lawRows = await prisma.contentItem.findMany({
      where: {
        id: { not: parent.id },
        isPublic: true,
        AND: [
          { tags: { some: { tag: { type: TagType.oigusakt, slug: { in: lawSlugs } } } } },
          { tags: { some: { tag: { type: TagType.valdkond, slug: { in: valdkondSlugs } } } } },
        ],
      },
      include: candidateInclude,
      take: TOPIC_HISTORY_CAP * 4,
    });
    const parentRel = { lawSlugs: lawSlugs, topicSlugs: valdkondSlugs, text: candidateText(parent) };
    for (const row of lawRows) {
      if (!isEvidenceEligible(row)) continue;
      const cand = toCandidate(row);
      // Law tag + topic alone is not enough: require strong title/body overlap so
      // two unrelated documents that merely cite the same big law are not linked.
      const ok = qualifiesAsLawTopicRelation(parentRel, {
        lawSlugs: cand.oigusaktid.map((t) => t.slug),
        topicSlugs: cand.valdkonnad.map((t) => t.slug),
        text: candidateText(cand),
      });
      if (ok) lawTopicMatches.push({ c: cand, eligible: isPublicSearchEligible(row) });
    }
  }

  // Fetch the candidate rows for the link-based ids we still need.
  const needRows = [...new Set([...linkedRelatedIds, ...threadIds])];
  const rowById = new Map<string, { c: Candidate; eligible: boolean }>();
  if (needRows.length) {
    const rows = await prisma.contentItem.findMany({
      where: { id: { in: needRows } },
      include: candidateInclude,
    });
    for (const row of rows) {
      if (!isEvidenceEligible(row)) continue;
      rowById.set(row.id, { c: toCandidate(row), eligible: isPublicSearchEligible(row) });
    }
  }

  const annualContext = [...annualIds]
    .map((id) => rowById.get(id))
    .filter((x): x is { c: Candidate; eligible: boolean } => !!x)
    .map((x) => toEvidenceRow(x.c, x.eligible));
  const duplicates = [...duplicateIds]
    .map((id) => rowById.get(id))
    .filter((x): x is { c: Candidate; eligible: boolean } => !!x)
    .slice(0, DUPLICATE_CAP)
    .map((x) => toEvidenceRow(x.c, x.eligible));

  // Compose "Veel samal teemal" in priority order, de-duplicated, capped. No
  // broad-topic-only fallback: if nothing qualifies, we simply show nothing.
  const ordered: { c: Candidate; eligible: boolean }[] = [];
  const seen = new Set<string>([parent.id]);
  const pushUnique = (entry: { c: Candidate; eligible: boolean } | undefined) => {
    if (!entry || seen.has(entry.c.id)) return;
    seen.add(entry.c.id);
    ordered.push(entry);
  };
  for (const id of linkedRelatedOrdered) pushUnique(rowById.get(id)); // (1) curated/cluster (sort_priority)
  for (const id of threadIds) pushUnique(rowById.get(id)); // (2) policy thread
  for (const entry of lawTopicMatches) pushUnique(entry); // (3) law + topic + text
  const topicHistory = ordered.slice(0, TOPIC_HISTORY_CAP).map((x) => toEvidenceRow(x.c, x.eligible));

  if (!annualContext.length && !duplicates.length && !topicHistory.length && !timeline.length) {
    return empty;
  }
  // relatedOpinions kept empty: opinions now only surface via explicit curated
  // (supporting_opinion) links, which already flow through topicHistory above.
  return { annualContext, duplicates, relatedOpinions: [], topicHistory, timeline };
}

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
  evidence: {
    annualContext: EvidenceRow[];
    duplicates: EvidenceRow[];
    relatedOpinions: EvidenceRow[];
    topicHistory: EvidenceRow[];
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
    }).text,
    year: item.year,
    reportYear: item.reportYear,
    isAchievement: isAchievement(c),
    isNews: isKodaNews(c),
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
    evidence,
  };
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
  const empty = { annualContext: [], duplicates: [], relatedOpinions: [], topicHistory: [] };

  // (1) Explicit evidence links touching this item (both directions). All of
  // these link types are curated/cluster relations created at import time, so
  // they are trustworthy related content (unlike a broad topic query).
  const links = await prisma.contentEvidenceLink.findMany({
    where: { OR: [{ fromContentId: parent.id }, { toContentId: parent.id }] },
    select: { fromContentId: true, toContentId: true, linkType: true },
  });
  const annualIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const linkedRelatedIds = new Set<string>();
  for (const link of links) {
    const other = link.fromContentId === parent.id ? link.toContentId : link.fromContentId;
    if (other === parent.id) continue;
    if (link.linkType === "annual_context") annualIds.add(other);
    else if (link.linkType === "duplicate_canonical") duplicateIds.add(other);
    // supporting_opinion / topic_history / annual_context / duplicate_canonical
    // are all explicit relations worth surfacing as "same theme".
    linkedRelatedIds.add(other);
  }

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
  for (const id of linkedRelatedIds) pushUnique(rowById.get(id)); // (1) curated/cluster
  for (const id of threadIds) pushUnique(rowById.get(id)); // (2) policy thread
  for (const entry of lawTopicMatches) pushUnique(entry); // (3) law + topic + text
  const topicHistory = ordered.slice(0, TOPIC_HISTORY_CAP).map((x) => toEvidenceRow(x.c, x.eligible));

  if (!annualContext.length && !duplicates.length && !topicHistory.length) {
    return empty;
  }
  // relatedOpinions kept empty: opinions now only surface via explicit curated
  // (supporting_opinion) links, which already flow through topicHistory above.
  return { annualContext, duplicates, relatedOpinions: [], topicHistory };
}

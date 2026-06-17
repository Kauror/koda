/**
 * Public detail page data: loads one ContentItem, enforces public eligibility,
 * and gathers source-based evidence/context. Hidden/supporting rows are only
 * ever returned as evidence under an eligible public parent — never as a
 * standalone public detail. See docs/public-detail-evidence-v1.md.
 */
import { TagType } from "@prisma/client";
import { prisma } from "./db";
import { isPublicSearchEligible, isEvidenceEligible } from "./eligibility";
import { publicTitle, publicSummary, publicUrl } from "./content-display";
import { datasetLabel, outcomeLabel, sourceLabel } from "./labels";
import {
  type Candidate,
  buildBadges,
  isAchievement,
  rankRelatedOpinions,
} from "./search-core";
import { candidateInclude, toCandidate } from "./search";

const RELATED_OPINION_CAP = 5;
const TOPIC_HISTORY_CAP = 4;
const DUPLICATE_CAP = 4;

export type EvidenceRow = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  date: string | null;
  year: number | null;
  sourceLabel: string;
  sourceUrl: string | null;
  isPublic: boolean; // whether this evidence row has its own public detail page
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
  year: number | null;
  reportYear: number | null;
  isAchievement: boolean;
  badges: string[];
  sourceLabel: string;
  datasetLabel: string;
  outcomeLabel: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  sourceFileName: string | null;
  sourceSection: string | null;
  valdkonnad: { slug: string; name: string }[];
  tegevusalad: { slug: string; name: string }[];
  tapsustused: { slug: string; name: string }[];
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
  return {
    id: c.id,
    detailId: detailIdOf(c),
    title: publicTitle(c),
    summary: publicSummary(c),
    date: c.date ? c.date.toISOString() : null,
    year: null,
    sourceLabel: sourceLabel(c.sourceLayer, c.sourceTypeDetail),
    sourceUrl: publicUrl(c),
    isPublic,
  };
}

/**
 * Load a public detail by externalId (preferred) or DB id. Returns null when
 * the row does not exist or is not public-eligible (→ the route renders 404).
 */
export async function getContentDetail(id: string): Promise<ContentDetail | null> {
  const item = await prisma.contentItem.findFirst({
    where: { OR: [{ externalId: id }, { id }] },
    include: { ...candidateInclude, achievementEnrichment: true },
  });
  if (!item) return null;
  // Direct access is gated: hidden/supporting/opinion/review rows 404.
  if (!isPublicSearchEligible(item)) return null;

  const c = toCandidate(item);
  const enr = item.achievementEnrichment;

  const evidence = await getEvidenceForContent(c);

  return {
    id: c.id,
    detailId: detailIdOf(c),
    title: publicTitle(c),
    summary: publicSummary(c),
    companyRelevance: c.companyRelevance,
    kodaPosition: c.kodaPosition,
    sourceEvidence: c.sourceEvidence,
    excerpt: c.excerpt,
    bodySnippet: pickBodySnippet(c),
    date: c.date ? c.date.toISOString() : null,
    year: item.year,
    reportYear: item.reportYear,
    isAchievement: isAchievement(c),
    badges: buildBadges(c),
    sourceLabel: sourceLabel(c.sourceLayer, c.sourceTypeDetail),
    datasetLabel: datasetLabel(c.sourceDataset),
    outcomeLabel: outcomeLabel(c.outcomeStatus),
    sourceUrl: c.sourceUrl,
    canonicalUrl: c.canonicalUrl,
    sourceFileName: item.sourceFileName,
    sourceSection: item.sourceSection,
    valdkonnad: c.valdkonnad,
    tegevusalad: c.tegevusalad,
    tapsustused: c.tapsustused,
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

/** Only show a body snippet when there is no better summary-like field. */
function pickBodySnippet(c: Candidate): string | null {
  if (publicSummary(c) || c.kodaPosition || c.companyRelevance) return null;
  if (!c.bodyText) return null;
  const t = c.bodyText.trim();
  return t.length > 600 ? t.slice(0, 600) + "…" : t;
}

/**
 * Source-based evidence for a public parent. Four batched queries (no N+1):
 *  1. linked rows via ContentEvidenceLink (annual_context, duplicate_canonical);
 *  2. supporting opinion rows by shared valdkond (hidden, review-safe);
 *  3. topic-history web rows by shared valdkond.
 */
export async function getEvidenceForContent(parent: Candidate): Promise<ContentDetail["evidence"]> {
  const empty = { annualContext: [], duplicates: [], relatedOpinions: [], topicHistory: [] };

  // 1) Explicit links.
  const links = await prisma.contentEvidenceLink.findMany({
    where: { OR: [{ fromContentId: parent.id }, { toContentId: parent.id }] },
    select: { fromContentId: true, toContentId: true, linkType: true },
  });
  const annualIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const l of links) {
    const other = l.fromContentId === parent.id ? l.toContentId : l.fromContentId;
    if (other === parent.id) continue;
    if (l.linkType === "annual_context") annualIds.add(other);
    else if (l.linkType === "duplicate_canonical") duplicateIds.add(other);
  }

  const linkedIds = [...new Set([...annualIds, ...duplicateIds])];
  // candidate + whether it has its own public detail page (full eligibility).
  const linkedById = new Map<string, { c: Candidate; eligible: boolean }>();
  if (linkedIds.length) {
    const rows = await prisma.contentItem.findMany({
      where: { id: { in: linkedIds } },
      include: candidateInclude,
    });
    for (const r of rows) {
      if (!isEvidenceEligible(r)) continue;
      linkedById.set(r.id, { c: toCandidate(r), eligible: isPublicSearchEligible(r) });
    }
  }

  const annualContext = [...annualIds]
    .map((id) => linkedById.get(id))
    .filter((x): x is { c: Candidate; eligible: boolean } => !!x)
    .map((x) => toEvidenceRow(x.c, x.eligible));
  const duplicates = [...duplicateIds]
    .map((id) => linkedById.get(id))
    .filter((x): x is { c: Candidate; eligible: boolean } => !!x)
    .slice(0, DUPLICATE_CAP)
    .map((x) => toEvidenceRow(x.c, x.eligible));

  const valdkondSlugs = parent.valdkonnad.map((t) => t.slug);

  // 2) Supporting opinions (hidden, review-safe), ranked + capped.
  let relatedOpinions: EvidenceRow[] = [];
  if (valdkondSlugs.length) {
    const opinionRows = await prisma.contentItem.findMany({
      where: {
        sourceDataset: "opinions",
        isPublic: false,
        needsHumanReview: false,
        extractionQuality: { notIn: ["failed", "weak"] },
        tags: { some: { tag: { type: TagType.valdkond, slug: { in: valdkondSlugs } } } },
      },
      include: candidateInclude,
      take: 40,
    });
    const opinions = opinionRows.filter((r) => isEvidenceEligible(r)).map(toCandidate);
    relatedOpinions = rankRelatedOpinions(parent, opinions, RELATED_OPINION_CAP).map((c) =>
      toEvidenceRow(c, false)
    );
  }

  // 3) Topic-history: other eligible non-achievement rows on the same topic.
  let topicHistory: EvidenceRow[] = [];
  if (valdkondSlugs.length) {
    const histRows = await prisma.contentItem.findMany({
      where: {
        id: { not: parent.id },
        isPublic: true,
        sourceTypeDetail: { not: "toovoit" },
        tags: { some: { tag: { type: TagType.valdkond, slug: { in: valdkondSlugs } } } },
      },
      include: candidateInclude,
      orderBy: [{ date: { sort: "asc", nulls: "last" } }],
      take: TOPIC_HISTORY_CAP * 3,
    });
    const seen = new Set<string>([...annualIds, ...duplicateIds, parent.id]);
    topicHistory = histRows
      .filter((r) => isEvidenceEligible(r) && !seen.has(r.id))
      .slice(0, TOPIC_HISTORY_CAP)
      .map((r) => toEvidenceRow(toCandidate(r), isPublicSearchEligible(r)));
  }

  if (
    !annualContext.length &&
    !duplicates.length &&
    !relatedOpinions.length &&
    !topicHistory.length
  ) {
    return empty;
  }
  return { annualContext, duplicates, relatedOpinions, topicHistory };
}

/**
 * Public detail page data. Public pages render a clean reader-facing summary;
 * backend evidence/source metadata remains available in this layer for future
 * admin use, but is not exposed by the public route.
 */
import { TagType } from "@prisma/client";
import { prisma } from "./db";
import { isEvidenceEligible, isPublicSearchEligible } from "./eligibility";
import {
  getCleanPublicExcerpt,
  publicSourceUrl,
  publicSummary,
  publicTitle,
  sourceCtaLabel,
} from "./content-display";
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
  year: number | null;
  reportYear: number | null;
  isAchievement: boolean;
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
    summary: getCleanPublicExcerpt(c),
    date: c.date ? c.date.toISOString() : null,
    year: null,
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
    sourceUrl: publicSourceUrl(c),
    sourceCtaLabel: sourceCtaLabel(c),
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

function pickBodySnippet(c: Candidate): string | null {
  if (publicSummary(c) || c.kodaPosition || c.companyRelevance) return null;
  return getCleanPublicExcerpt({ bodyText: c.bodyText });
}

export async function getEvidenceForContent(parent: Candidate): Promise<ContentDetail["evidence"]> {
  const empty = { annualContext: [], duplicates: [], relatedOpinions: [], topicHistory: [] };

  const links = await prisma.contentEvidenceLink.findMany({
    where: { OR: [{ fromContentId: parent.id }, { toContentId: parent.id }] },
    select: { fromContentId: true, toContentId: true, linkType: true },
  });
  const annualIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const link of links) {
    const other = link.fromContentId === parent.id ? link.toContentId : link.fromContentId;
    if (other === parent.id) continue;
    if (link.linkType === "annual_context") annualIds.add(other);
    else if (link.linkType === "duplicate_canonical") duplicateIds.add(other);
  }

  const linkedIds = [...new Set([...annualIds, ...duplicateIds])];
  const linkedById = new Map<string, { c: Candidate; eligible: boolean }>();
  if (linkedIds.length) {
    const rows = await prisma.contentItem.findMany({
      where: { id: { in: linkedIds } },
      include: candidateInclude,
    });
    for (const row of rows) {
      if (!isEvidenceEligible(row)) continue;
      linkedById.set(row.id, { c: toCandidate(row), eligible: isPublicSearchEligible(row) });
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

  const valdkondSlugs = parent.valdkonnad.map((tag) => tag.slug);

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
    const opinions = opinionRows.filter((row) => isEvidenceEligible(row)).map(toCandidate);
    relatedOpinions = rankRelatedOpinions(parent, opinions, RELATED_OPINION_CAP).map((candidate) =>
      toEvidenceRow(candidate, false)
    );
  }

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
      orderBy: [{ date: { sort: "desc", nulls: "last" } }],
      take: TOPIC_HISTORY_CAP * 3,
    });
    const seen = new Set<string>([...annualIds, ...duplicateIds, parent.id]);
    topicHistory = histRows
      .filter((row) => isEvidenceEligible(row) && !seen.has(row.id))
      .slice(0, TOPIC_HISTORY_CAP)
      .map((row) => toEvidenceRow(toCandidate(row), isPublicSearchEligible(row)));
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

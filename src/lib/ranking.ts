import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Internal ranking system. Scores are never shown to users – they only decide
 * what is displayed and in which order.
 *
 * Signals (per spec): sector match, interest match, activity match, size match,
 * manual admin weight, recency, evergreen bonus, general business relevance.
 */

export type SearchFilters = {
  sectors: string[];
  size: string | null;
  interests: string[];
  activities: string[];
};

const W = {
  sectorMatch: 40,
  generalNoSector: 12, // items with no sector tag are considered generally relevant
  interestMatch: 18,
  activityMatch: 14,
  sizeMatch: 8,
  generalNoSize: 3,
  manualWeight: 12, // multiplier for admin manualWeight (-2..+2 typical)
  evergreenItem: 14,
  evergreenGroup: 10,
  groupTagSector: 30,
  groupTagInterest: 15,
  groupTagActivity: 12,
  groupTagSize: 6,
} as const;

const ITEM_SCORE_THRESHOLD = 25;
const GROUP_SCORE_THRESHOLD = 25;
const SERVICE_SCORE_THRESHOLD = 20;
const ACHIEVEMENT_SCORE_THRESHOLD = 20;
const MAX_GROUPS = 8;
const MAX_OTHER_ITEMS = 6;
const MAX_HISTORY_PER_GROUP = 4;
const MAX_SERVICES = 4;
const MAX_ACHIEVEMENTS = 6;

function recencyScore(date: Date | null, isEvergreen: boolean): number {
  if (!date) return isEvergreen ? 6 : 2;
  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  let score = 0;
  if (ageDays <= 30) score = 25;
  else if (ageDays <= 90) score = 18;
  else if (ageDays <= 180) score = 12;
  else if (ageDays <= 365) score = 8;
  else if (ageDays <= 730) score = 4;
  else score = 0;
  // Evergreen content should not die of old age.
  if (isEvergreen && score < 8) score = 8;
  return score;
}

type ItemWithTags = Prisma.ContentItemGetPayload<{ include: { tags: { include: { tag: true } } } }>;

function scoreItem(item: ItemWithTags, f: SearchFilters): number {
  let score = 0;

  const tagsByType = new Map<string, { slug: string; weight: number }[]>();
  for (const ct of item.tags) {
    const list = tagsByType.get(ct.tag.type) ?? [];
    list.push({ slug: ct.tag.slug, weight: ct.weight });
    tagsByType.set(ct.tag.type, list);
  }

  // Sector match / general business relevance.
  const sectorTags = tagsByType.get("sector") ?? [];
  if (f.sectors.length > 0) {
    const matches = sectorTags.filter((t) => f.sectors.includes(t.slug));
    if (matches.length > 0) score += W.sectorMatch * Math.max(...matches.map((m) => m.weight));
    else if (sectorTags.length === 0) score += W.generalNoSector;
    // Items tagged with very many sectors are effectively general business content.
    else if (sectorTags.length >= 6) score += W.generalNoSector;
  } else {
    score += sectorTags.length === 0 ? W.generalNoSector : 6;
  }

  // Interest match.
  const interestTags = tagsByType.get("interest") ?? [];
  for (const slug of f.interests) {
    const match = interestTags.find((t) => t.slug === slug);
    if (match) score += W.interestMatch * match.weight;
  }

  // Activity / profile match.
  const activityTags = tagsByType.get("activity") ?? [];
  for (const slug of f.activities) {
    const match = activityTags.find((t) => t.slug === slug);
    if (match) score += W.activityMatch * match.weight;
  }

  // Company size match.
  const sizeTags = tagsByType.get("size") ?? [];
  if (f.size) {
    const match = sizeTags.find((t) => t.slug === f.size);
    if (match) score += W.sizeMatch * match.weight;
    else if (sizeTags.length === 0) score += W.generalNoSize;
  }

  // Manual admin weight, recency, evergreen.
  score += item.manualWeight * W.manualWeight;
  score += recencyScore(item.date, item.isEvergreen);
  if (item.isEvergreen) score += W.evergreenItem;

  return score;
}

export type ResultItem = {
  id: string;
  title: string;
  url: string;
  date: string | null;
  excerpt: string | null;
  summary: string | null;
  sourceType: string;
  tags: { type: string; name: string; slug: string }[];
};

export type ResultGroup = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  whyItMatters: string | null;
  tags: { type: string; name: string; slug: string }[];
  mainItem: ResultItem | null;
  /** Second-most relevant item, shown as a full box next to the main one. */
  secondItem: ResultItem | null;
  history: ResultItem[];
};

export type SearchResults = {
  groups: ResultGroup[];
  otherItems: ResultItem[];
  /** Koda services matching the profile – displayed separately at the end. */
  services: ResultItem[];
  /** Töövõidud (concrete wins) not already shown inside a topic group. */
  achievements: ResultItem[];
};

function toResultItem(item: ItemWithTags): ResultItem {
  return {
    id: item.id,
    title: item.displayTitle || item.title,
    url: item.canonicalUrl || item.sourceUrl,
    date: item.date ? item.date.toISOString() : null,
    excerpt: item.excerpt,
    summary: item.summary,
    sourceType: item.sourceType,
    tags: item.tags.map((ct) => ({ type: ct.tag.type, name: ct.tag.name, slug: ct.tag.slug })),
  };
}

export async function search(filters: SearchFilters): Promise<SearchResults> {
  const [items, groups] = await Promise.all([
    prisma.contentItem.findMany({
      where: { isHidden: false },
      include: { tags: { include: { tag: true } } },
    }),
    prisma.topicGroup.findMany({
      where: { isHidden: false },
      include: {
        tags: { include: { tag: true } },
        contentItems: true,
      },
    }),
  ]);

  // Score all visible items.
  const itemScores = new Map<string, number>();
  const itemById = new Map<string, ItemWithTags>();
  for (const item of items) {
    itemScores.set(item.id, scoreItem(item, filters));
    itemById.set(item.id, item);
  }

  // Services are never mixed into topic cards – they get their own
  // "Teenused, mis võivad sulle kasulikud olla" section at the end.
  const serviceIds = new Set(items.filter((i) => i.sourceType === "service").map((i) => i.id));

  // Deduplicate by content hash: keep only the highest-scoring (then newest) copy.
  const byHash = new Map<string, ItemWithTags>();
  const deduped: ItemWithTags[] = [];
  for (const item of items) {
    if (!item.contentHash) {
      deduped.push(item);
      continue;
    }
    const existing = byHash.get(item.contentHash);
    if (!existing) {
      byHash.set(item.contentHash, item);
      continue;
    }
    const better =
      (itemScores.get(item.id) ?? 0) > (itemScores.get(existing.id) ?? 0) ||
      ((itemScores.get(item.id) ?? 0) === (itemScores.get(existing.id) ?? 0) &&
        (item.date?.getTime() ?? 0) > (existing.date?.getTime() ?? 0));
    if (better) byHash.set(item.contentHash, item);
  }
  for (const item of byHash.values()) deduped.push(item);
  const dedupedIds = new Set(deduped.map((i) => i.id));

  // Score topic groups.
  const scoredGroups = groups
    .map((group) => {
      let score = 0;
      for (const gt of group.tags) {
        if (gt.tag.type === "sector" && filters.sectors.includes(gt.tag.slug))
          score += W.groupTagSector * gt.weight;
        if (gt.tag.type === "interest" && filters.interests.includes(gt.tag.slug))
          score += W.groupTagInterest * gt.weight;
        if (gt.tag.type === "activity" && filters.activities.includes(gt.tag.slug))
          score += W.groupTagActivity * gt.weight;
        if (gt.tag.type === "size" && filters.size && gt.tag.slug === filters.size)
          score += W.groupTagSize * gt.weight;
      }

      const memberScores = group.contentItems
        .filter((c) => dedupedIds.has(c.contentItemId) && !serviceIds.has(c.contentItemId))
        .map((c) => itemScores.get(c.contentItemId) ?? 0)
        .sort((a, b) => b - a);

      if (memberScores.length > 0) {
        score += 0.8 * memberScores[0];
        if (memberScores.length > 1) score += 0.2 * memberScores[1];
      }

      score += group.manualWeight * W.manualWeight;
      if (group.isEvergreen) score += W.evergreenGroup;

      return { group, score, memberCount: memberScores.length };
    })
    // Groups whose only members were services have nothing left to show.
    .filter((g) => g.score >= GROUP_SCORE_THRESHOLD && g.memberCount > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_GROUPS);

  const usedItemIds = new Set<string>();
  const resultGroups: ResultGroup[] = [];

  for (const { group } of scoredGroups) {
    const memberIds = group.contentItems
      .map((c) => c.contentItemId)
      .filter((id) => dedupedIds.has(id) && !serviceIds.has(id));
    const members = memberIds
      .map((id) => itemById.get(id))
      .filter((i): i is ItemWithTags => !!i);
    if (members.length === 0) continue;

    // Main item: admin-selected if visible, otherwise highest-scoring member.
    let main =
      (group.mainContentItemId && members.find((m) => m.id === group.mainContentItemId)) || null;
    if (!main) {
      main = [...members].sort(
        (a, b) => (itemScores.get(b.id) ?? 0) - (itemScores.get(a.id) ?? 0)
      )[0];
    }

    // Second box: the next most relevant member after the main one.
    const second =
      members
        .filter((m) => m.id !== main!.id)
        .sort((a, b) => (itemScores.get(b.id) ?? 0) - (itemScores.get(a.id) ?? 0))[0] ?? null;

    const history = members
      .filter((m) => m.id !== main!.id && m.id !== second?.id)
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
      .slice(0, MAX_HISTORY_PER_GROUP);

    for (const m of [main, ...(second ? [second] : []), ...history]) usedItemIds.add(m.id);

    resultGroups.push({
      id: group.id,
      title: group.title,
      slug: group.slug,
      summary: group.summary,
      whyItMatters: group.whyItMattersText,
      tags: group.tags.map((gt) => ({ type: gt.tag.type, name: gt.tag.name, slug: gt.tag.slug })),
      mainItem: toResultItem(main),
      secondItem: second ? toResultItem(second) : null,
      history: history.map(toResultItem),
    });
  }

  // Standalone items that scored well but are not in any displayed group.
  // Achievements (töövõidud) have their own section, like services.
  const otherItems = deduped
    .filter(
      (i) => !usedItemIds.has(i.id) && !serviceIds.has(i.id) && i.sourceType !== "achievement"
    )
    .map((i) => ({ item: i, score: itemScores.get(i.id) ?? 0 }))
    .filter((s) => s.score >= ITEM_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OTHER_ITEMS)
    .map((s) => toResultItem(s.item));

  // Töövõidud are shown first on the results page, so they must be a
  // *specific* match: at least one tag has to match the selected sector,
  // interest or activity. General business relevance is not enough here –
  // e.g. a tax win must not lead the results of a labour-force search.
  const matchesProfile = (item: ItemWithTags) =>
    item.tags.some(
      (ct) =>
        (ct.tag.type === "sector" && filters.sectors.includes(ct.tag.slug)) ||
        (ct.tag.type === "interest" && filters.interests.includes(ct.tag.slug)) ||
        (ct.tag.type === "activity" && filters.activities.includes(ct.tag.slug))
    );

  const achievements = deduped
    .filter((i) => i.sourceType === "achievement" && !usedItemIds.has(i.id) && matchesProfile(i))
    .map((i) => ({ item: i, score: itemScores.get(i.id) ?? 0 }))
    .filter((s) => s.score >= ACHIEVEMENT_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ACHIEVEMENTS)
    .map((s) => toResultItem(s.item));

  // Matching services, ranked the same way but shown in their own section.
  const services = deduped
    .filter((i) => serviceIds.has(i.id))
    .map((i) => ({ item: i, score: itemScores.get(i.id) ?? 0 }))
    .filter((s) => s.score >= SERVICE_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SERVICES)
    .map((s) => toResultItem(s.item));

  return { groups: resultGroups, otherItems, services, achievements };
}

export function parseFilters(params: {
  sektor?: string | string[];
  suurus?: string | string[];
  huvid?: string | string[];
  tegevused?: string | string[];
}): SearchFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;
  const list = (v: string | string[] | undefined) => {
    const raw = Array.isArray(v) ? v.join(",") : v || "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };
  return {
    sectors: list(params.sektor),
    size: first(params.suurus),
    interests: list(params.huvid),
    activities: list(params.tegevused),
  };
}

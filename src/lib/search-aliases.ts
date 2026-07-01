import { slugify } from "./slug";
import { canonicalTopicId } from "./topics";
import { PUBLIC_ACTIVITY_SLUGS } from "./activities";

export type SearchAliasRecord = {
  id: string;
  alias: string;
  normalizedAlias?: string | null;
  canonicalLabel: string;
  type: string;
  targetSlug?: string | null;
  targetKind: string;
  weight: number;
  language?: string | null;
  sourceBasis?: unknown;
  notes?: string | null;
  isPublic?: boolean | null;
  intent?: string | null;
  expandedTerms?: unknown;
};

export type AliasMatch = {
  id: string;
  alias: string;
  normalizedAlias: string;
  canonicalLabel: string;
  type: string;
  targetKind: string;
  targetSlug: string | null;
  weight: number;
  intent: string | null;
};

export type WeightedSignal = {
  value: string;
  weight: number;
  sourceAliasIds: string[];
};

export type AliasExpansion = {
  matchedAliases: AliasMatch[];
  reviewAliases: AliasMatch[];
  topicBoosts: WeightedSignal[];
  sectorBoosts: WeightedSignal[];
  lawBoostTerms: WeightedSignal[];
  textBoostTerms: WeightedSignal[];
};

export type RelatedSearchSuggestion = {
  q: string;
  label: string;
  targetKind: string;
  targetSlug: string | null;
};

export const EMPTY_ALIAS_EXPANSION: AliasExpansion = {
  matchedAliases: [],
  reviewAliases: [],
  topicBoosts: [],
  sectorBoosts: [],
  lawBoostTerms: [],
  textBoostTerms: [],
};

const ESTONIAN_FOLD: Record<string, string> = {
  "\u00e4": "a",
  "\u00f6": "o",
  "\u00f5": "o",
  "\u00fc": "u",
  "\u0161": "s",
  "\u017e": "z",
};

export function normalizeAliasText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLocaleLowerCase("et-EE")
    .replace(/[\u00e4\u00f6\u00f5\u00fc\u0161\u017e]/g, (ch) => ESTONIAN_FOLD[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function aliasTokens(input: string): string[] {
  return normalizeAliasText(input).split(" ").filter(Boolean);
}

export function aliasMatchesQuery(alias: string, query: string): boolean {
  const normalizedAlias = normalizeAliasText(alias);
  if (!normalizedAlias) return false;
  const normalizedQuery = normalizeAliasText(query);
  if (!normalizedQuery) return false;
  if (normalizedAlias === normalizedQuery) return true;

  const aliasParts = normalizedAlias.split(" ");
  const queryParts = normalizedQuery.split(" ");

  const containsWindow = (haystack: string[], needle: string[]) => {
    if (needle.length > haystack.length) return false;
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };

  if (containsWindow(queryParts, aliasParts)) return true;
  if (queryParts.length > 1 && containsWindow(aliasParts, queryParts)) return true;
  return false;
}

function addSignal(map: Map<string, WeightedSignal>, rawValue: string | null | undefined, weight: number, aliasId: string) {
  const value = normalizeAliasText(rawValue);
  if (!value) return;
  const current = map.get(value);
  if (!current) {
    map.set(value, { value, weight, sourceAliasIds: [aliasId] });
    return;
  }
  current.weight = Math.max(current.weight, weight);
  if (!current.sourceAliasIds.includes(aliasId)) current.sourceAliasIds.push(aliasId);
}

function expandedTerms(alias: SearchAliasRecord): string[] {
  if (!Array.isArray(alias.expandedTerms)) return [];
  return alias.expandedTerms.filter((term): term is string => typeof term === "string" && term.trim().length > 0);
}

function addTextTerms(map: Map<string, WeightedSignal>, alias: SearchAliasRecord, weight: number) {
  addSignal(map, alias.alias, weight, alias.id);
  addSignal(map, alias.canonicalLabel, Math.max(1, weight - 1), alias.id);
  addSignal(map, alias.targetSlug?.replace(/[_-]/g, " "), Math.max(1, weight - 2), alias.id);
  for (const term of expandedTerms(alias)) addSignal(map, term, Math.max(1, weight - 1), alias.id);
}

function toMatch(alias: SearchAliasRecord): AliasMatch {
  return {
    id: alias.id,
    alias: alias.alias,
    normalizedAlias: normalizeAliasText(alias.normalizedAlias || alias.alias),
    canonicalLabel: alias.canonicalLabel,
    type: alias.type,
    targetKind: alias.targetKind,
    targetSlug: alias.targetSlug || null,
    weight: alias.weight,
    intent: alias.intent || null,
  };
}

export function expandSearchAliases(query: string, aliases: SearchAliasRecord[]): AliasExpansion {
  const topicBoosts = new Map<string, WeightedSignal>();
  const sectorBoosts = new Map<string, WeightedSignal>();
  const lawBoostTerms = new Map<string, WeightedSignal>();
  const textBoostTerms = new Map<string, WeightedSignal>();
  const matchedAliases: AliasMatch[] = [];
  const reviewAliases: AliasMatch[] = [];

  for (const alias of aliases) {
    if (!aliasMatchesQuery(alias.normalizedAlias || alias.alias, query)) continue;
    const match = toMatch(alias);
    if (alias.targetKind === "unknown_review") {
      reviewAliases.push(match);
      continue;
    }

    matchedAliases.push(match);
    const weight = Math.max(1, alias.weight || 1);
    if (alias.targetKind === "valdkond") {
      const topicId = canonicalTopicId(alias.targetSlug) ?? canonicalTopicId(alias.canonicalLabel);
      if (topicId && topicId !== "oigusloome_kvaliteet_kaasamine") {
        addSignal(topicBoosts, topicId, weight, alias.id);
      }
      addTextTerms(textBoostTerms, alias, Math.max(1, weight - 2));
      continue;
    }

    if (alias.targetKind === "tegevusala") {
      const sectorSlug = alias.targetSlug && PUBLIC_ACTIVITY_SLUGS.has(alias.targetSlug)
        ? alias.targetSlug
        : slugify(alias.targetSlug || alias.canonicalLabel);
      if (PUBLIC_ACTIVITY_SLUGS.has(sectorSlug)) addSignal(sectorBoosts, sectorSlug, weight, alias.id);
      addTextTerms(textBoostTerms, alias, Math.max(1, weight - 2));
      continue;
    }

    if (alias.targetKind === "law") {
      addTextTerms(lawBoostTerms, alias, weight);
      continue;
    }

    addTextTerms(textBoostTerms, alias, alias.targetKind === "free_text_boost" ? Math.max(1, weight - 1) : weight);
  }

  const byWeight = (a: WeightedSignal, b: WeightedSignal) => b.weight - a.weight || a.value.localeCompare(b.value);
  return {
    matchedAliases: matchedAliases.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
    reviewAliases: reviewAliases.sort((a, b) => a.id.localeCompare(b.id)),
    topicBoosts: [...topicBoosts.values()].sort(byWeight),
    sectorBoosts: [...sectorBoosts.values()].sort(byWeight),
    lawBoostTerms: [...lawBoostTerms.values()].sort(byWeight),
    textBoostTerms: [...textBoostTerms.values()].sort(byWeight),
  };
}

export function hasAliasSignals(expansion: AliasExpansion | null | undefined): boolean {
  return !!expansion && (
    expansion.topicBoosts.length > 0 ||
    expansion.sectorBoosts.length > 0 ||
    expansion.lawBoostTerms.length > 0 ||
    expansion.textBoostTerms.length > 0
  );
}

function targetKey(alias: SearchAliasRecord | AliasMatch): string {
  return `${alias.targetKind}:${alias.targetSlug || ""}:${normalizeAliasText(alias.canonicalLabel)}`;
}

function safePublicSuggestion(alias: SearchAliasRecord): boolean {
  if (alias.isPublic === false) return false;
  if (alias.targetKind === "unknown_review") return false;
  if (alias.targetSlug === "oigusloome_kvaliteet_kaasamine") return false;
  return true;
}

function tokenOverlap(a: string[], b: string[]): number {
  const bSet = new Set(b);
  return a.filter((token) => token.length > 1 && bSet.has(token)).length;
}

export function suggestRelatedSearches(
  query: string,
  aliases: SearchAliasRecord[],
  expansion: AliasExpansion = expandSearchAliases(query, aliases),
  limit = 8
): RelatedSearchSuggestion[] {
  const normalizedQuery = normalizeAliasText(query);
  if (!normalizedQuery) return [];

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const activeTargets = new Set(expansion.matchedAliases.map(targetKey));
  const candidates: { alias: SearchAliasRecord; score: number }[] = [];

  for (const alias of aliases) {
    if (!safePublicSuggestion(alias)) continue;
    const normalizedAlias = normalizeAliasText(alias.alias);
    if (!normalizedAlias || normalizedAlias === normalizedQuery) continue;

    let score = 0;
    if (activeTargets.has(targetKey(alias))) score += 100 + alias.weight;
    if (aliasMatchesQuery(alias.alias, query)) score += 30 + alias.weight;
    const overlap = tokenOverlap(queryTokens, normalizedAlias.split(" "));
    score += overlap * 12;
    if (expandedTerms(alias).some((term) => tokenOverlap(queryTokens, normalizeAliasText(term).split(" ")) > 0)) {
      score += 10;
    }
    if (score <= 0) continue;
    candidates.push({ alias, score });
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score || b.alias.weight - a.alias.weight || a.alias.id.localeCompare(b.alias.id))
    .filter(({ alias }) => {
      const key = normalizeAliasText(alias.alias);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ alias }) => ({
      q: alias.alias,
      label: alias.alias,
      targetKind: alias.targetKind,
      targetSlug: alias.targetSlug || null,
    }));
}

/**
 * Conservative sector fallback rules for imported Koda taxonomy.
 *
 * Exact sector tags are always preferred. Fallback is deliberately narrow:
 * only generic/no-sector rows with high-signal topic/title/summary evidence
 * can pass, and known broad/off-topic themes are excluded.
 */
import { normalizeTitle } from "./hash";
import { publicSummary, publicTitle, type DisplayFields } from "./content-display";

export type TagRef = { slug: string; name: string };

export type SectorRelevanceCandidate = DisplayFields & {
  sourceEvidence: string | null;
  valdkonnad: TagRef[];
  tegevusalad: TagRef[];
  tapsustused: TagRef[];
};

export type SectorRelevanceRule = {
  topicNeedles: string[];
  keywordNeedles: string[];
  singleKeywordNeedles?: string[];
  exclusionNeedles?: string[];
  requiredAnchorNeedles?: string[];
  aliases?: string[];
  keywordMatchThreshold?: number;
};

const SECTOR_RELEVANCE: Record<string, SectorRelevanceRule> = {
  "info-side-ja-it": {
    aliases: ["info-ja-side-it"],
    topicNeedles: [
      "digi",
      "digitaal",
      "tehnoloogia",
      "andmed",
      "andmekaitse",
      "kuber",
      "kyber",
      "tehisintellekt",
      "ai",
      "infoturve",
      "side",
      "telekommunikatsioon",
      "tarkvara",
    ],
    keywordNeedles: [
      "digi",
      "digitaliseerimine",
      "digitaalne",
      "digitaalne identiteet",
      "digiriik",
      "e riik",
      "e teenus",
      "e teenused",
      "andmekaitse",
      "andmed",
      "kuberturvalisus",
      "kyberturvalisus",
      "kuberturve",
      "kyberturve",
      "e arve",
      "e arved",
      "tehisintellekt",
      "infotehnoloogia",
      "info ja side",
      "elektrooniline side",
      "infoyhiskond",
      "info uhiskond",
      "it",
      "tehnoloogiaplatvorm",
      "digiplatvorm",
      "tarkvara",
      "digiteenus",
      "digiteenused",
      "automatiseerimine",
      "algoritm",
      "automaatotsus",
      "automaatotsused",
      "infoturve",
      "telekommunikatsioon",
    ],
    singleKeywordNeedles: [
      "tehisintellekt",
      "infotehnoloogia",
      "kuberturvalisus",
      "kyberturvalisus",
      "kuberturve",
      "kyberturve",
      "digitaalne identiteet",
      "elektrooniline side",
      "tarkvara",
      "telekommunikatsioon",
      "infoturve",
    ],
    exclusionNeedles: [
      "e kaubandus",
      "e pood",
      "tarbijakaitse",
      "tarbija",
      "kaubandus",
      "jaekaubandus",
      "pakend",
      "pakendid",
      "j\u00e4\u00e4tmed",
      "jaatmed",
      "j\u00e4\u00e4tmeseadus",
      "jaatmeseadus",
      "keskkonnav\u00e4ited",
      "keskkonnavaited",
      "rohev\u00e4ited",
      "rohevaited",
      "m\u00e4rgistus",
      "margistus",
      "kaupade h\u00e4vitamine",
      "kaupade havitamine",
      "taganemisnupp",
      "ringmajandus",
    ],
  },
  "pollumajandus-metsandus-ja-kalandus": {
    topicNeedles: [
      "pollu",
      "p\u00f5llu",
      "pollumajandus",
      "p\u00f5llumajandus",
      "p\u00f5llumajandustootja",
      "metsandus",
      "mets",
      "kalandus",
      "kalur",
    ],
    keywordNeedles: [
      "pollumajandus",
      "p\u00f5llumajandus",
      "p\u00f5llumajandustootja",
      "metsandus",
      "kalandus",
      "mets",
      "kalur",
      "p\u00f5ld",
      "p\u00f5llu",
      "pollu",
      "toidu tootmine",
      "toidutootmine",
      "veterinaar",
      "maakasutus",
    ],
    singleKeywordNeedles: [
      "pollumajandus",
      "p\u00f5llumajandus",
      "p\u00f5llumajandustootja",
      "metsandus",
      "kalandus",
    ],
    requiredAnchorNeedles: [
      "pollumajandus",
      "p\u00f5llumajandus",
      "p\u00f5llumajandustootja",
      "pollu",
      "p\u00f5llu",
      "metsandus",
      "kalandus",
      "kalur",
    ],
    exclusionNeedles: [
      "keskkond",
      "planeering",
      "luba",
      "load",
      "lubade",
      "maa",
      "toit",
      "pakend",
      "j\u00e4\u00e4tmed",
      "jaatmed",
      "ehitus",
      "ehitamine",
    ],
  },
};

export function getRelatedTopicsForSector(tegevusalaSlug: string): SectorRelevanceRule | null {
  const key = sectorRuleKey(tegevusalaSlug);
  if (key) return SECTOR_RELEVANCE[key];
  return null;
}

function sectorRuleKey(tegevusalaSlug: string): string | null {
  const slug = normalizeTitle(tegevusalaSlug);
  if (SECTOR_RELEVANCE[tegevusalaSlug]) return tegevusalaSlug;
  for (const [key, rule] of Object.entries(SECTOR_RELEVANCE)) {
    if (normalizeTitle(key) === slug) return key;
    if (rule.aliases?.some((alias) => normalizeTitle(alias) === slug)) return key;
  }
  if ((slug.includes("info") && slug.includes("side")) || slug === "it") {
    return "info-side-ja-it";
  }
  if (
    slug.includes("pollumajandus") ||
    slug.includes("p\u00f5llumajandus") ||
    slug.includes("metsandus") ||
    slug.includes("kalandus")
  ) {
    return "pollumajandus-metsandus-ja-kalandus";
  }
  return null;
}

function includesNeedle(haystack: string, needle: string): boolean {
  const n = normalizeTitle(needle);
  if (!n) return false;
  if (n.length <= 3) return haystack.split(" ").includes(n);
  return haystack.includes(n);
}

function matchedNeedles(haystack: string, needles: string[] | undefined): string[] {
  if (!needles?.length) return [];
  return [...new Set(needles.filter((needle) => includesNeedle(haystack, needle)))];
}

function sectorTagHaystack(c: SectorRelevanceCandidate): string {
  return normalizeTitle([...c.valdkonnad, ...c.tapsustused].flatMap((t) => [t.slug, t.name]).join(" "));
}

function sectorHighSignalHaystack(c: SectorRelevanceCandidate): string {
  return normalizeTitle(
    [publicTitle(c), c.title, c.displayTitle, c.adminDisplayTitleOverride, publicSummary(c), c.summary, c.adminSummaryOverride]
      .filter(Boolean)
      .join(" ")
  );
}

function sectorLowerSignalHaystack(c: SectorRelevanceCandidate): string {
  return normalizeTitle([c.companyRelevance, c.kodaPosition, c.sourceEvidence].filter(Boolean).join(" "));
}

export type SectorRelevanceScore = {
  matches: number;
  topicMatches: number;
  keywordMatches: number;
};

export type SectorRelevanceExplanation = {
  sectorSlug: string;
  ruleKey: string | null;
  exactSectorMatch: boolean;
  sectorTags: string[];
  hasGenericSectorTag: boolean;
  hasNoSectorTags: boolean;
  hasSpecificNonMatchingSector: boolean;
  topicMatchedTerms: string[];
  keywordMatchedTerms: string[];
  lowerSignalKeywordMatchedTerms: string[];
  singleKeywordMatchedTerms: string[];
  anchorMatchedTerms: string[];
  exclusionMatchedTerms: string[];
  fallbackAllowed: boolean;
  fallbackBlockedReason: string | null;
  finalInclude: boolean;
};

function isGenericSectorRef(t: TagRef): boolean {
  const slug = normalizeTitle(t.slug);
  const name = normalizeTitle(t.name);
  return (
    slug.includes("koik-tegevusalad") ||
    slug.includes("valdkondadeulene") ||
    name.includes("koik tegevusalad") ||
    name.includes("valdkondadeulene")
  );
}

export function sectorMatchesSlug(tagSlug: string, selectedSectorSlugs: string[]): boolean {
  const tagNorm = normalizeTitle(tagSlug);
  const tagRule = sectorRuleKey(tagSlug);
  return selectedSectorSlugs.some((selected) => {
    if (normalizeTitle(selected) === tagNorm) return true;
    const selectedRule = sectorRuleKey(selected);
    return Boolean(tagRule && selectedRule && tagRule === selectedRule);
  });
}

export function hasGenericSectorTag(c: Pick<SectorRelevanceCandidate, "tegevusalad">): boolean {
  return c.tegevusalad.some(isGenericSectorRef);
}

export function hasExactSectorMatch(
  c: Pick<SectorRelevanceCandidate, "tegevusalad">,
  selectedSectorSlugs: string[]
): boolean {
  return c.tegevusalad.some((t) => sectorMatchesSlug(t.slug, selectedSectorSlugs));
}

export function hasOnlyGenericOrNoSector(c: Pick<SectorRelevanceCandidate, "tegevusalad">): boolean {
  return c.tegevusalad.length === 0 || c.tegevusalad.every(isGenericSectorRef);
}

export function hasSpecificNonMatchingSector(
  c: Pick<SectorRelevanceCandidate, "tegevusalad">,
  selectedSectorSlugs: string[]
): boolean {
  return c.tegevusalad.some((t) => !isGenericSectorRef(t) && !sectorMatchesSlug(t.slug, selectedSectorSlugs));
}

export function getSectorRelevanceExplanation(
  c: SectorRelevanceCandidate,
  sectorSlug: string
): SectorRelevanceExplanation {
  const ruleKey = sectorRuleKey(sectorSlug);
  const rule = ruleKey ? SECTOR_RELEVANCE[ruleKey] : null;
  const selectedSectorSlugs = [sectorSlug];
  const exactSectorMatch = hasExactSectorMatch(c, selectedSectorSlugs);
  const genericSectorTag = hasGenericSectorTag(c);
  const hasNoSectorTags = c.tegevusalad.length === 0;
  const specificNonMatching = hasSpecificNonMatchingSector(c, selectedSectorSlugs);
  const sectorTags = c.tegevusalad.map((t) => t.slug);

  if (!rule) {
    return {
      sectorSlug,
      ruleKey,
      exactSectorMatch,
      sectorTags,
      hasGenericSectorTag: genericSectorTag,
      hasNoSectorTags,
      hasSpecificNonMatchingSector: specificNonMatching,
      topicMatchedTerms: [],
      keywordMatchedTerms: [],
      lowerSignalKeywordMatchedTerms: [],
      singleKeywordMatchedTerms: [],
      anchorMatchedTerms: [],
      exclusionMatchedTerms: [],
      fallbackAllowed: false,
      fallbackBlockedReason: "no-sector-fallback-mapping",
      finalInclude: exactSectorMatch,
    };
  }

  if (exactSectorMatch || !hasOnlyGenericOrNoSector(c)) {
    return {
      sectorSlug,
      ruleKey,
      exactSectorMatch,
      sectorTags,
      hasGenericSectorTag: genericSectorTag,
      hasNoSectorTags,
      hasSpecificNonMatchingSector: specificNonMatching,
      topicMatchedTerms: [],
      keywordMatchedTerms: [],
      lowerSignalKeywordMatchedTerms: [],
      singleKeywordMatchedTerms: [],
      anchorMatchedTerms: [],
      exclusionMatchedTerms: [],
      fallbackAllowed: false,
      fallbackBlockedReason: exactSectorMatch
        ? "exact-sector-match"
        : specificNonMatching
          ? "specific-nonmatching-sector-tag"
          : "non-generic-sector-tag",
      finalInclude: exactSectorMatch,
    };
  }

  const tagHay = sectorTagHaystack(c);
  const highHay = sectorHighSignalHaystack(c);
  const lowerHay = sectorLowerSignalHaystack(c);
  const fallbackHay = normalizeTitle([tagHay, highHay, lowerHay].filter(Boolean).join(" "));
  const topicMatchedTerms = matchedNeedles(tagHay, rule.topicNeedles);
  const keywordMatchedTerms = matchedNeedles(highHay, rule.keywordNeedles);
  const lowerSignalKeywordMatchedTerms = matchedNeedles(lowerHay, rule.keywordNeedles);
  const singleKeywordMatchedTerms = matchedNeedles(highHay, rule.singleKeywordNeedles);
  const anchorMatchedTerms = matchedNeedles(fallbackHay, rule.requiredAnchorNeedles);
  const exclusionMatchedTerms = matchedNeedles(fallbackHay, rule.exclusionNeedles);

  const keywordThreshold = rule.keywordMatchThreshold ?? 2;
  const hasStrongTopic = topicMatchedTerms.length > 0;
  const hasStrongKeyword = keywordMatchedTerms.length >= keywordThreshold || singleKeywordMatchedTerms.length > 0;
  const hasRequiredAnchor = !rule.requiredAnchorNeedles?.length || anchorMatchedTerms.length > 0;
  const exclusionBlocks = exclusionMatchedTerms.length > 0 && !anchorMatchedTerms.length;

  let fallbackAllowed = false;
  let fallbackBlockedReason: string | null = null;
  if (exclusionBlocks) {
    fallbackBlockedReason = "sector-fallback-exclusion";
  } else if (!hasRequiredAnchor) {
    fallbackBlockedReason = "missing-required-sector-anchor";
  } else if (!hasStrongTopic && !hasStrongKeyword) {
    fallbackBlockedReason = "no-strong-sector-signal";
  } else {
    fallbackAllowed = true;
  }

  return {
    sectorSlug,
    ruleKey,
    exactSectorMatch,
    sectorTags,
    hasGenericSectorTag: genericSectorTag,
    hasNoSectorTags,
    hasSpecificNonMatchingSector: specificNonMatching,
    topicMatchedTerms,
    keywordMatchedTerms,
    lowerSignalKeywordMatchedTerms,
    singleKeywordMatchedTerms,
    anchorMatchedTerms,
    exclusionMatchedTerms,
    fallbackAllowed,
    fallbackBlockedReason,
    finalInclude: exactSectorMatch || fallbackAllowed,
  };
}

export function getSectorRelevance(c: SectorRelevanceCandidate, sectorSlugs: string[]): SectorRelevanceScore {
  let strictMatches = 0;
  let strictTopicMatches = 0;
  let strictKeywordMatches = 0;
  if (sectorSlugs.length === 0) {
    return { matches: strictMatches, topicMatches: strictTopicMatches, keywordMatches: strictKeywordMatches };
  }

  for (const sector of sectorSlugs) {
    const explanation = getSectorRelevanceExplanation(c, sector);
    if (!explanation.fallbackAllowed) continue;
    strictMatches++;
    strictTopicMatches += explanation.topicMatchedTerms.length;
    strictKeywordMatches += explanation.keywordMatchedTerms.length + explanation.singleKeywordMatchedTerms.length;
  }

  return { matches: strictMatches, topicMatches: strictTopicMatches, keywordMatches: strictKeywordMatches };
}

/**
 * Public display helpers. Admin override fields are preferred over the imported
 * (source-owned) values, but the import never writes the override fields, so
 * admin edits survive re-imports. Prisma-free for easy reuse/testing.
 */

export type DisplayFields = {
  title: string;
  displayTitle: string | null;
  adminDisplayTitleOverride: string | null;
  summary: string | null;
  adminSummaryOverride: string | null;
  companyRelevance: string | null;
  kodaPosition: string | null;
  excerpt: string | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
};

export type SourceLabelFields = {
  sourceLayer: string | null;
  sourceTypeDetail: string | null;
  sourceDataset?: string | null;
};

export function publicTitle(i: DisplayFields): string {
  return i.adminDisplayTitleOverride || i.displayTitle || i.title || "";
}

export function publicSummary(i: DisplayFields): string | null {
  return (
    i.adminSummaryOverride ||
    i.summary ||
    i.companyRelevance ||
    i.kodaPosition ||
    i.excerpt ||
    null
  );
}

export function publicUrl(i: DisplayFields): string | null {
  return i.canonicalUrl || i.sourceUrl || null;
}

export function isLikelyPublicSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function publicSourceUrl(i: Pick<DisplayFields, "sourceUrl" | "canonicalUrl">): string | null {
  if (isLikelyPublicSourceUrl(i.sourceUrl)) return i.sourceUrl;
  if (isLikelyPublicSourceUrl(i.canonicalUrl)) return i.canonicalUrl;
  return null;
}

export function sourceCtaLabel(i: SourceLabelFields): string {
  if (i.sourceTypeDetail === "toovoit" || i.sourceLayer === "koda_achievement") {
    return "Vaata töövõitu";
  }
  if (i.sourceTypeDetail === "meie_uudis" || i.sourceLayer === "koda_news") {
    return "Loe uudist";
  }
  if (i.sourceTypeDetail === "meie_arvamus_article" || i.sourceLayer === "koda_public_opinion") {
    return "Loe koja arvamust";
  }
  if (
    i.sourceDataset === "annual_reports" ||
    i.sourceLayer === "annual_report" ||
    (i.sourceTypeDetail && i.sourceTypeDetail.startsWith("annual_report"))
  ) {
    return "Loe konteksti";
  }
  return "Ava koda.ee allikas";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function isDuplicateText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  return na === nb || (Math.min(na.length, nb.length) > 60 && (na.includes(nb) || nb.includes(na)));
}

export function uniquePublicTexts(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (out.some((existing) => isDuplicateText(existing, trimmed))) continue;
    out.push(trimmed);
  }
  return out;
}

export function isNoisyPublicExcerpt(value: string | null | undefined): boolean {
  if (!value) return true;
  const text = normalizeText(value);
  if (!text) return true;
  const noisy = [
    "liigu edasi pohisisu juurde",
    "liigu edasi põhisisu juurde",
    "avaleht",
    "otsing",
    "menu",
    "menüü",
    "javascript",
    "cookie",
    "csv",
    "xlsx",
    "import",
  ];
  const noisyHits = noisy.filter((needle) => text.includes(needle)).length;
  return noisyHits >= 2 || text.length < 24;
}

export function getCleanPublicExcerpt(i: {
  summary?: string | null;
  adminSummaryOverride?: string | null;
  kodaPosition?: string | null;
  companyRelevance?: string | null;
  sourceEvidence?: string | null;
  excerpt?: string | null;
  bodyText?: string | null;
}): string | null {
  const candidates = [
    i.adminSummaryOverride,
    i.summary,
    i.kodaPosition,
    i.companyRelevance,
    i.sourceEvidence,
    i.excerpt,
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed && !isNoisyPublicExcerpt(trimmed)) return trimmed;
  }
  const body = i.bodyText?.trim();
  if (!body || isNoisyPublicExcerpt(body)) return null;
  return body.length > 360 ? `${body.slice(0, 360).trim()}...` : body;
}

export function compactText(value: string | null | undefined, maxLength = 220): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 120 ? lastSpace : maxLength).trim()}...`;
}

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

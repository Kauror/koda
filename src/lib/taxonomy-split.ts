/**
 * Topic/activity cell splitting, shared by the importer (scripts/lib/merge-ready)
 * and the runtime (src/lib/search). Prisma-free and pure.
 *
 * The v0.9.4 package separates multiple topics with "; ". But a subset of source
 * rows have a compound canonical name's internal comma corrupted into a semicolon
 * — e.g. "Eksport; rahvusvahelistumine ja toll" instead of
 * "Eksport, rahvusvahelistumine ja toll". Splitting naively on ";" fragments that
 * one topic into two bogus entries (the doubled "Teema" filter).
 *
 * Canonical Koda topic names are always Capitalised, so a ";" followed by a
 * lowercase word is an intra-name corruption: restore it to ", " before
 * splitting. A ";" before a Capitalised word is a genuine multi-topic separator
 * and is left intact.
 */
export function splitTopics(s: string): string[] {
  const repaired = s.replace(/;\s*(?=\p{Ll})/gu, ", ");
  return repaired
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The first (primary) topic/activity from a possibly multi-value cell, or null. */
export function firstTopic(s: string | null | undefined): string | null {
  if (!s) return null;
  return splitTopics(s)[0] ?? null;
}

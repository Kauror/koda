/**
 * Pure relation logic for "Veel samal teemal" (related content) — trust/safety.
 *
 * Related items must have a concrete, justified relation. A shared BROAD topic
 * (or activity, or content type, or year) is explicitly NOT enough on its own —
 * that previously surfaced unrelated rows (youth work, foreign labour, court
 * proceedings, fuel excise) on an unrelated work win. The DB orchestration in
 * content-detail.ts composes related items in this priority order:
 *   1. explicit curated/cluster evidence links;
 *   2. same policy thread (canonical_policy_thread_id);
 *   3. same confirmed law tag AND a shared narrow topic AND strong text overlap
 *      (this module's `qualifiesAsLawTopicRelation`).
 *
 * Pure (no Prisma / no I/O) so the relation rules can be unit-tested directly.
 */
import { normalizeTitle } from "./hash";

/** Default minimum shared title/summary tokens for a law+topic relation. */
export const RELATED_TEXT_OVERLAP_MIN = 2;

/** Significant tokens (length > 3) of a piece of text, normalized. */
function tokens(text: string): Set<string> {
  return new Set(
    normalizeTitle(text)
      .split(" ")
      .filter((t) => t.length > 3)
  );
}

/** True when two texts share at least `min` significant tokens. */
export function strongTextOverlap(parentText: string, otherText: string, min: number = RELATED_TEXT_OVERLAP_MIN): boolean {
  const parentTokens = tokens(parentText);
  if (parentTokens.size === 0) return false;
  const otherHay = normalizeTitle(otherText);
  let shared = 0;
  for (const t of parentTokens) {
    if (otherHay.includes(t)) {
      shared++;
      if (shared >= min) return true;
    }
  }
  return false;
}

function shareAny(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

/**
 * Does `other` qualify as related to `parent` via the law+topic+text rule?
 * Requires a shared confirmed law tag AND a shared narrow topic AND strong
 * title/summary overlap. Sharing only a broad topic, or only a law, or only an
 * activity/type/year, is never enough.
 */
export function qualifiesAsLawTopicRelation(
  parent: { lawSlugs: string[]; topicSlugs: string[]; text: string },
  other: { lawSlugs: string[]; topicSlugs: string[]; text: string },
  min: number = RELATED_TEXT_OVERLAP_MIN
): boolean {
  if (!shareAny(parent.lawSlugs, other.lawSlugs)) return false;
  if (!shareAny(parent.topicSlugs, other.topicSlugs)) return false;
  return strongTextOverlap(parent.text, other.text, min);
}

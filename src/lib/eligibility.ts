/**
 * Central public-eligibility gate for the merge-ready Koda data model.
 *
 * A ContentItem may appear as a *normal top-level public search result* only
 * when this returns true. The gate is deliberately conservative and redundant
 * with the import-time `isPublic` flag (defence in depth): even if `isPublic`
 * were ever computed differently, the explicit rules below still hold.
 *
 * Supporting rows (opinions, hidden/review/context rows) are still fetched as
 * evidence/context for a public result — they are just never primary cards.
 *
 * This module is intentionally Prisma-free so it can be unit-tested with plain
 * objects.
 */

export type EligibilityFields = {
  isPublic: boolean;
  isHidden: boolean;
  needsHumanReview: boolean;
  numericClaimNeedsReview?: boolean;
  importStatus: string | null;
  importAction?: string | null;
  publicDisplayAllowed?: boolean | null;
  publicDisplayStatus: string | null;
  adminVisibilityOverride: boolean | null;
  sourceDataset: string | null;
};

/**
 * Is this row allowed as a normal public top-level search result?
 *
 * Admin override is authoritative:
 *  - `adminVisibilityOverride === false` → always hidden.
 *  - `adminVisibilityOverride === true`  → admin has explicitly approved it
 *    (this is the human review), so it is eligible even if it would otherwise
 *    be supporting (e.g. an opinion an admin chose to surface).
 *
 * Otherwise the conservative default gates apply.
 */
export function isPublicSearchEligible(item: EligibilityFields): boolean {
  // Admin override wins both directions.
  if (item.adminVisibilityOverride === false) return false;
  if (item.adminVisibilityOverride === true) return true;

  // Default conservative gates.
  if (!item.isPublic) return false;
  if (item.isHidden) return false; // hidden / supporting-only
  if (item.needsHumanReview) return false;
  // numeric_claim_needs_review is NOT a v1 publish blocker: it is a producer-side
  // diagnostic that the layer import flag already cleared (see merge-ready
  // computeVisibility). isPublic is authoritative for the numeric dimension.
  if (item.publicDisplayAllowed === false) return false;
  if (item.importStatus === "do_not_import_yet") return false;
  if (item.importAction === "import_support_only") return false;
  if (item.importAction === "import_staging_only") return false;
  if (item.importAction === "do_not_import_public") return false;
  if (item.importAction === "enrichment_hold") return false;
  if (item.publicDisplayStatus === "admin_only") return false;
  if (item.publicDisplayStatus === "hide_or_review") return false;
  if (item.publicDisplayStatus === "review_required") return false;
  if (item.publicDisplayStatus === "numeric_review_hold") return false;
  if (item.publicDisplayStatus === "source_quality_hold") return false;
  if (item.publicDisplayStatus === "blocked") return false;

  return true;
}

export type EvidenceFields = {
  extractionQuality: string | null;
  needsHumanReview: boolean;
  numericClaimNeedsReview?: boolean;
  adminVisibilityOverride: boolean | null;
};

/**
 * May a row be shown as *supporting evidence/context* under a public parent?
 *
 * Conservative on purpose: a row that is unsafe to surface (failed/weak
 * extraction, flagged for review, or admin-forced-hidden) is never shown as
 * evidence, even when it is linked. Note this is a weaker bar than
 * isPublicSearchEligible (an opinion can be evidence but never a top-level
 * result), but it is never weaker on the safety dimensions.
 */
export function isEvidenceEligible(item: EvidenceFields): boolean {
  if (item.adminVisibilityOverride === false) return false;
  if (item.needsHumanReview) return false;
  // numeric_claim_needs_review is a producer diagnostic, not a v1 evidence gate.
  if (item.extractionQuality === "failed" || item.extractionQuality === "weak") return false;
  return true;
}

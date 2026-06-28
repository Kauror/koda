/**
 * Töövõidud nesting / timeline model (taxonomy v1.2, section 28).
 *
 * The v1.5 töövõidud import (`koda_toovoidud_v1_5_APP_IMPORT_SLIM.xlsx`) mixes
 * three kinds of row (`row_origin`):
 *   - original_90_locked    — the curated baseline (standalone cards);
 *   - phase2_new_standalone — new, verified standalone work wins (standalone cards);
 *   - phase2_series_nested  — series / timeline / sub-step rows that must NOT be
 *                             shown as duplicate flat cards.
 *
 * Each row carries a `display_type` telling the app how to render it:
 *   - standalone_card                 — a normal top-level töövõit card;
 *   - nested_under_existing_card      — render under an original-90 parent card
 *                                       (via parent_toovoit_id);
 *   - nested_under_new_series_card    — render under a new Phase 2 parent card
 *                                       (via parent_candidate_id / thread);
 *   - timeline_item_in_policy_thread  — render in a policy-thread timeline.
 *
 * This module is intentionally **pure** (no Prisma, no Candidate dependency) so
 * it can be reused by the importer's validation and the runtime search/UI. It
 * works on the minimal `WorkWinNestingInput` shape; callers adapt their own row
 * type (StagedContent / Candidate) into it.
 */

export const ROW_ORIGINS = [
  "original_90_locked",
  "phase2_new_standalone",
  "phase2_series_nested",
] as const;
export type RowOrigin = (typeof ROW_ORIGINS)[number];

export const DISPLAY_TYPES = [
  "standalone_card",
  "nested_under_existing_card",
  "nested_under_new_series_card",
  "timeline_item_in_policy_thread",
] as const;
export type DisplayType = (typeof DISPLAY_TYPES)[number];

/** Display types that must NOT become independent top-level flat cards. */
export const NESTED_DISPLAY_TYPES: DisplayType[] = [
  "nested_under_existing_card",
  "nested_under_new_series_card",
  "timeline_item_in_policy_thread",
];

/** Defaults applied to a töövõit row whose nesting columns are absent (legacy v1 files). */
export const DEFAULT_ROW_ORIGIN: RowOrigin = "original_90_locked";
export const DEFAULT_DISPLAY_TYPE: DisplayType = "standalone_card";

export function isValidRowOrigin(v: string | null | undefined): v is RowOrigin {
  return !!v && (ROW_ORIGINS as readonly string[]).includes(v);
}

export function isValidDisplayType(v: string | null | undefined): v is DisplayType {
  return !!v && (DISPLAY_TYPES as readonly string[]).includes(v);
}

/** A standalone card is the only top-level display type (null defaults to standalone). */
export function isStandaloneDisplay(displayType: string | null | undefined): boolean {
  return !displayType || displayType === "standalone_card";
}

/** Is this a nested/timeline row (must be folded under a parent or thread)? */
export function isNestedDisplay(displayType: string | null | undefined): boolean {
  return !!displayType && (NESTED_DISPLAY_TYPES as string[]).includes(displayType);
}

// ---------------------------------------------------------------------------
// Timeline stage labels + ordering (Estonian, public-facing)
// ---------------------------------------------------------------------------

/** Chronological rank of a policy-thread stage (lower = earlier). */
const STAGE_ORDER: Record<string, number> = {
  proposal: 10,
  partial_acceptance: 20,
  delay: 30,
  government_approval: 40,
  riigikogu_adoption: 50,
  final_entry_into_force: 60,
  cancellation: 70,
  simplification: 75,
  follow_up_update: 80,
  source_update: 90,
  achieved: 95,
  unclear: 999,
};

const STAGE_LABEL_ET: Record<string, string> = {
  proposal: "Ettepanek",
  partial_acceptance: "Osaline arvestamine",
  delay: "Edasilükkamine",
  government_approval: "Valitsuse heakskiit",
  riigikogu_adoption: "Riigikogu vastuvõtmine",
  final_entry_into_force: "Jõustumine",
  cancellation: "Tühistamine",
  simplification: "Lihtsustamine",
  follow_up_update: "Edasine areng",
  source_update: "Allika täiendus",
  achieved: "Saavutatud",
};

/** Public Estonian label for a timeline stage, or null for unknown/unclear. */
export function timelineStageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return STAGE_LABEL_ET[stage] ?? null;
}

function stageRank(stage: string | null | undefined): number {
  if (!stage) return 500;
  return STAGE_ORDER[stage] ?? 500;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type WorkWinNestingInput = {
  /** Stable row identity used as a map key (DB id at runtime, externalId at import). */
  id: string;
  /** External id (e.g. TOOVOIT-0001) — what parent_toovoit_id references. */
  externalId: string | null;
  rowOrigin: string | null;
  displayType: string | null;
  parentToovoitId: string | null;
  parentCandidateId: string | null;
  policyThreadKey: string | null;
  policyThreadTitle: string | null;
  timelineYear: number | null;
  timelineStage: string | null;
};

export type WorkWinThread = {
  key: string;
  title: string | null;
  /** Member row ids, sorted into timeline order (year asc, then stage). */
  memberIds: string[];
  /** Most recent timeline_year among members, for ranking/sorting the thread. */
  latestYear: number | null;
};

export type WorkWinNesting = {
  /** Row ids of standalone (top-level) töövõidud. */
  topLevelIds: Set<string>;
  /** Row ids of nested/timeline töövõidud (never independent flat cards). */
  nestedIds: Set<string>;
  /** Nested children keyed by the PARENT row id (parent is a top-level row). */
  childrenByParentId: Map<string, string[]>;
  /** Synthetic policy-thread groups (nested rows with no top-level parent card). */
  threads: WorkWinThread[];
  /** Member row id → its thread key (for search surfacing / detail context). */
  threadKeyByMemberId: Map<string, string>;
  /** Member row id → its top-level parent row id (for search surfacing). */
  parentIdByMemberId: Map<string, string>;
  /**
   * Nested rows that resolve to neither a parent card nor a policy thread.
   * Surfaced loudly by the importer; should always be empty for a valid import.
   */
  unresolved: WorkWinNestingInput[];
};

/** Order timeline rows: year ascending, then chronological stage, then id. */
export function compareTimeline(a: WorkWinNestingInput, b: WorkWinNestingInput): number {
  const ay = a.timelineYear ?? Number.POSITIVE_INFINITY;
  const by = b.timelineYear ?? Number.POSITIVE_INFINITY;
  if (ay !== by) return ay - by;
  const as = stageRank(a.timelineStage);
  const bs = stageRank(b.timelineStage);
  if (as !== bs) return as - bs;
  return (a.externalId ?? a.id).localeCompare(b.externalId ?? b.id);
}

/**
 * Resolve nesting structure for a set of töövõit rows.
 *
 * Attachment rules (in order), so a nested row never silently disappears:
 *   1. nested_under_existing_card with a parent_toovoit_id that points at a
 *      top-level row → child of that parent card.
 *   2. a parent_candidate_id that happens to resolve to a top-level row → child
 *      of that parent card.
 *   3. otherwise, if it has a policy_thread_key → member of that thread group.
 *   4. otherwise → unresolved (import error / review).
 */
export function resolveWorkWinNesting(rows: WorkWinNestingInput[]): WorkWinNesting {
  const byExternalId = new Map<string, WorkWinNestingInput>();
  for (const r of rows) if (r.externalId) byExternalId.set(r.externalId, r);

  const topLevelIds = new Set<string>();
  const topLevelByExternalId = new Map<string, WorkWinNestingInput>();
  for (const r of rows) {
    if (isStandaloneDisplay(r.displayType)) {
      topLevelIds.add(r.id);
      if (r.externalId) topLevelByExternalId.set(r.externalId, r);
    }
  }

  const nestedIds = new Set<string>();
  const childrenByParentId = new Map<string, string[]>();
  const threadKeyByMemberId = new Map<string, string>();
  const parentIdByMemberId = new Map<string, string>();
  const threadMembers = new Map<string, WorkWinNestingInput[]>();
  const unresolved: WorkWinNestingInput[] = [];

  const addChild = (parent: WorkWinNestingInput, child: WorkWinNestingInput) => {
    const list = childrenByParentId.get(parent.id) ?? [];
    list.push(child.id);
    childrenByParentId.set(parent.id, list);
    parentIdByMemberId.set(child.id, parent.id);
    // A child still records its thread key (if any) for cross-linking context.
    if (child.policyThreadKey) threadKeyByMemberId.set(child.id, child.policyThreadKey);
  };

  for (const r of rows) {
    if (!isNestedDisplay(r.displayType)) continue;
    nestedIds.add(r.id);

    const parentByToovoit =
      r.parentToovoitId && topLevelByExternalId.get(r.parentToovoitId);
    const parentByCandidate =
      r.parentCandidateId && topLevelByExternalId.get(r.parentCandidateId);
    const parent = parentByToovoit || parentByCandidate || null;

    if (parent) {
      addChild(parent, r);
      continue;
    }
    if (r.policyThreadKey) {
      const list = threadMembers.get(r.policyThreadKey) ?? [];
      list.push(r);
      threadMembers.set(r.policyThreadKey, list);
      threadKeyByMemberId.set(r.id, r.policyThreadKey);
      continue;
    }
    unresolved.push(r);
  }

  // Sort children into timeline order.
  for (const [parentId, ids] of childrenByParentId) {
    const sorted = ids
      .map((id) => rows.find((x) => x.id === id)!)
      .sort(compareTimeline)
      .map((x) => x.id);
    childrenByParentId.set(parentId, sorted);
  }

  // Build thread groups (sorted members + readable title).
  const threads: WorkWinThread[] = [];
  for (const [key, members] of threadMembers) {
    const sorted = [...members].sort(compareTimeline);
    const title = sorted.map((m) => m.policyThreadTitle).find((t) => !!t) ?? null;
    const years = sorted.map((m) => m.timelineYear).filter((y): y is number => y != null);
    threads.push({
      key,
      title,
      memberIds: sorted.map((m) => m.id),
      latestYear: years.length ? Math.max(...years) : null,
    });
  }
  threads.sort((a, b) => (b.latestYear ?? 0) - (a.latestYear ?? 0) || a.key.localeCompare(b.key));

  void byExternalId; // reserved for future cross-row lookups
  return {
    topLevelIds,
    nestedIds,
    childrenByParentId,
    threads,
    threadKeyByMemberId,
    parentIdByMemberId,
    unresolved,
  };
}

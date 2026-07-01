/**
 * Admin-managed topic threads / timeline groups.
 *
 * A ContentThread groups related content items (opinions, work wins, news,
 * context, annual-report items) that recur across time under one broader topic
 * so they can be shown as a chronological timeline.
 *
 * Import safety: thread membership references the stable ContentItem.externalId
 * (never the cuid, which churns on every destructive re-import). Content is
 * resolved at read time; rows whose externalId no longer resolves are surfaced
 * as `unresolved` so the admin UI can flag them and the public render can skip
 * them.
 *
 * This module is deliberately Prisma-free so the ordering / gating logic can be
 * unit-tested with plain objects.
 */
import { isPublicSearchEligible, type EligibilityFields } from "./eligibility";

// --- Roles ------------------------------------------------------------------

/** The role a member plays inside a thread. Order is the canonical option order. */
export const THREAD_ROLES = [
  "background",
  "opinion",
  "work_win",
  "news_update",
  "evidence",
  "milestone",
] as const;

export type ThreadRole = (typeof THREAD_ROLES)[number];

const ROLE_LABELS: Record<ThreadRole, string> = {
  background: "Taust",
  opinion: "Seisukoht",
  work_win: "Töövõit",
  news_update: "Uudis",
  evidence: "Tõend",
  milestone: "Verstapost",
};

export function isValidRole(value: string | null | undefined): value is ThreadRole {
  return !!value && (THREAD_ROLES as readonly string[]).includes(value);
}

/** Human (ET) label for a role, or a neutral dash when unset/unknown. */
export function roleLabel(value: string | null | undefined): string {
  return isValidRole(value) ? ROLE_LABELS[value] : "—";
}

// --- Status -----------------------------------------------------------------

export const THREAD_STATUSES = ["draft", "internal", "public"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

const STATUS_LABELS: Record<ThreadStatus, string> = {
  draft: "Mustand",
  internal: "Sisemine",
  public: "Avalik",
};

export function isValidStatus(value: string | null | undefined): value is ThreadStatus {
  return !!value && (THREAD_STATUSES as readonly string[]).includes(value);
}

export function statusLabel(value: string | null | undefined): string {
  return isValidStatus(value) ? STATUS_LABELS[value] : String(value ?? "—");
}

/** Only `public` threads may ever render on public pages. Draft/internal never. */
export function isThreadPublic(status: string | null | undefined): boolean {
  return status === "public";
}

// --- Ordering ---------------------------------------------------------------

/** Metadata for one ContentThreadItem (independent of the resolved content). */
export type ThreadItemMeta = {
  contentExternalId: string;
  role: string | null;
  note: string | null;
  sortOrder: number;
  isAnchor: boolean;
};

/** A thread member whose content row has been resolved by externalId. */
export type ResolvedThreadMember<T> = {
  meta: ThreadItemMeta;
  content: T;
};

/**
 * Ordering: manual `sortOrder` ascending first (default 0 for every item, so an
 * untouched thread is purely chronological), then content date ascending
 * (oldest → newest, undated last), then a stable id tie-break.
 */
export function compareThreadItems<T extends { id: string; date: Date | null }>(
  a: ResolvedThreadMember<T>,
  b: ResolvedThreadMember<T>
): number {
  if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;

  const at = a.content.date ? a.content.date.getTime() : null;
  const bt = b.content.date ? b.content.date.getTime() : null;
  if (at !== bt) {
    if (at === null) return 1; // undated last
    if (bt === null) return -1;
    return at - bt; // oldest first
  }
  return a.content.id.localeCompare(b.content.id);
}

// --- Resolution -------------------------------------------------------------

/**
 * Join thread-item metadata to fetched content rows by externalId and order the
 * result. Returns the ordered members plus the externalIds that did not resolve
 * (e.g. removed by a later import) so callers can flag or skip them.
 */
export function resolveThreadMembers<T extends { id: string; externalId: string | null; date: Date | null }>(
  items: ThreadItemMeta[],
  content: readonly T[]
): { members: ResolvedThreadMember<T>[]; unresolved: string[] } {
  const byExternalId = new Map<string, T>();
  for (const c of content) {
    if (c.externalId) byExternalId.set(c.externalId, c);
  }

  const members: ResolvedThreadMember<T>[] = [];
  const unresolved: string[] = [];
  for (const meta of items) {
    const resolved = byExternalId.get(meta.contentExternalId);
    if (resolved) members.push({ meta, content: resolved });
    else unresolved.push(meta.contentExternalId);
  }

  members.sort(compareThreadItems);
  return { members, unresolved };
}

/**
 * Public gate for a whole thread render: the thread must be `public` AND each
 * member re-checked against `isPublicSearchEligible` (defence in depth — a
 * member that is hidden / under review / admin-forced-hidden never leaks through
 * a public thread). Non-eligible members are dropped, not the whole thread.
 */
export function filterPublicThreadMembers<
  T extends { id: string; date: Date | null } & EligibilityFields
>(status: string | null | undefined, members: ResolvedThreadMember<T>[]): ResolvedThreadMember<T>[] {
  if (!isThreadPublic(status)) return [];
  return members.filter((m) => isPublicSearchEligible(m.content));
}

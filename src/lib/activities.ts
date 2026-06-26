/**
 * Canonical public business-sector (`Tegevusala`) allowlist.
 *
 * The public `Tegevusala` filter must show only real business/economic sectors,
 * not cross-sector fallback labels, company profiles or technical taxonomy
 * values. It was previously built from the distinct `activity_primary` /
 * `activity_secondary` values on content rows (getFilterOptions in search.ts),
 * which surfaced:
 *   - "Kõik tegevusalad / valdkondadeülene" — cross-sector FALLBACK logic, not a
 *     user-facing sector (it's included by search ranking, never selected); and
 *   - "Energia ja ressursimahukas tegevus" — a company profile / situation /
 *     refinement, not a standard business sector.
 *
 * This module is the single source of truth for the public sector checkboxes.
 * Sector MATCHING (incl. cross-sector fallback) still happens in
 * sector-relevance.ts / search-core.ts by slug — this only controls which
 * options are OFFERED to the user. Slugs here are `slugify(label)`, i.e. the
 * same slug the importer assigns to the DB tag, so matching is unaffected.
 *
 * Pure (no Prisma / no I/O).
 */
import { slugify } from "./slug";

export type PublicActivity = {
  /** Public sector slug = slugify(label); matches the imported DB tag slug. */
  slug: string;
  /** Canonical sector label shown in the public UI. */
  label: string;
  /** Canonical sort order (1-based). */
  order: number;
};

const LABELS: string[] = [
  "Tööstus ja tootmine",
  "Kaubandus",
  "Ehitus ja kinnisvara",
  "Transport ja logistika",
  "Majutus, toitlustus ja turism",
  "Info, side ja IT",
  "Põllumajandus, metsandus ja kalandus",
  "Finants, kindlustus ja krediit",
  "Haridus ja koolitus",
  "Tervishoid, farmaatsia ja meditsiiniseadmed",
  "Äriteenused ja kutseteenused",
  "Meedia, loome- ja kultuurisektor",
];

/** The 12 canonical public business sectors, in canonical order. */
export const PUBLIC_ACTIVITIES: PublicActivity[] = LABELS.map((label, i) => ({
  slug: slugify(label),
  label,
  order: i + 1,
}));

export type ActivityOption = { slug: string; name: string };

/**
 * The public `Tegevusala` filter options: exactly the 12 canonical business
 * sectors, in canonical order. This is the ONLY source of public sector
 * checkboxes — never build them from distinct content values.
 */
export const PUBLIC_ACTIVITY_FILTERS: ActivityOption[] = PUBLIC_ACTIVITIES.map((a) => ({
  slug: a.slug,
  name: a.label,
}));

/** Set of canonical public sector slugs. */
export const PUBLIC_ACTIVITY_SLUGS = new Set(PUBLIC_ACTIVITIES.map((a) => a.slug));

// ---------------------------------------------------------------------------
// Non-sector activity values that must NOT appear in the main public filter
// ---------------------------------------------------------------------------

/** Cross-sector fallback label — handled by search ranking, never a checkbox. */
export const CROSS_SECTOR_ACTIVITY = "Kõik tegevusalad / valdkondadeülene";
/**
 * Energy-intensive company profile — NOT a business sector. It is intentionally
 * excluded from the main `Tegevusala` filter and kept only as an internal
 * tag/ranking signal.
 *
 * TODO (refinement UI): when a "Täpsemad valikud / Ettevõtte profiil / Olukord"
 * situation section is added, expose this as a refinement labelled
 * "Oleme energiamahukas ettevõte", mapped to situation_tags `energiamahukas`
 * (and/or this activity value / the `Energia, elektrihind ja varustuskindlus`
 * topic as a secondary relevance signal). It must narrow results, never be a
 * main sector checkbox.
 */
export const ENERGY_INTENSIVE_ACTIVITY = "Energia ja ressursimahukas tegevus";

const EXCLUDED_SLUGS = new Set([slugify(CROSS_SECTOR_ACTIVITY), slugify(ENERGY_INTENSIVE_ACTIVITY)]);

/** True if the given activity slug/name is a real public business sector. */
export function isPublicActivityFilterVisible(slugOrName: string | null | undefined): boolean {
  if (!slugOrName) return false;
  const slug = slugify(slugOrName);
  if (EXCLUDED_SLUGS.has(slug)) return false;
  return PUBLIC_ACTIVITY_SLUGS.has(slug);
}

/** Resolve an activity tag (slug or name) to its canonical public sector slug, or null. */
export function canonicalPublicActivitySlug(tag: { slug: string; name: string }): string | null {
  if (PUBLIC_ACTIVITY_SLUGS.has(tag.slug)) return tag.slug;
  const fromName = slugify(tag.name);
  return PUBLIC_ACTIVITY_SLUGS.has(fromName) ? fromName : null;
}

/**
 * True when an activity tag is the internal cross-sector fallback
 * ("Kõik tegevusalad / valdkondadeülene", its slug `koik-tegevusalad-…`, or a
 * bare "valdkondadeülene" / "Kõik tegevusalad" label). This value is ranking
 * metadata only and must NEVER be shown as a public chip (cards, detail pages,
 * filters, breadcrumbs, metadata rows). It stays usable for search/ranking.
 */
export function isInternalFallbackActivity(tag: { slug?: string | null; name?: string | null }): boolean {
  const text = `${tag.slug ?? ""} ${tag.name ?? ""}`.toLocaleLowerCase("et-EE");
  return (
    text.includes("kõik tegevusalad") ||
    text.includes("koik tegevusalad") ||
    text.includes("koik-tegevusalad") ||
    text.includes("valdkondadeülene") ||
    text.includes("valdkondadeulene")
  );
}

/** Drop the internal cross-sector fallback activity from a list before public display. */
export function displayablePublicActivities<T extends { slug?: string | null; name?: string | null }>(
  tags: T[]
): T[] {
  return tags.filter((t) => !isInternalFallbackActivity(t));
}

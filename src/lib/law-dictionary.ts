/**
 * Law / õigusakt dictionary for the Koda search app (v1).
 *
 * Conservative on purpose: only canonical legal-act names, specific aliases,
 * official abbreviations and (optionally) narrow topical "weak keywords" are
 * listed. Broad everyday words like "jäätmed", "pakend", "maks" or "töö" are
 * deliberately NOT registered as matches — see law-match.ts for why.
 *
 * This module is Prisma-free so it can be unit-tested and reused on the client.
 */

export type LawEntry = {
  /** ASCII slug for routing (/seadused/[slug]). */
  slug: string;
  /** Canonical Estonian law name. */
  canonicalName: string;
  /** Official abbreviation, e.g. "KMS". Optional. */
  abbreviation?: string;
  /**
   * Alternative full names / spellings (e.g. no-space compound spellings).
   * Matched like the canonical name (inflection-aware) but reported as "alias".
   */
  aliases?: string[];
  /**
   * Narrow topical phrases that hint at the law but never confirm it. Matched
   * only as low-confidence suggestions; never used for public recognition or
   * confirmed tagging. Broad single words must NOT be added here.
   */
  weakKeywords?: string[];
  /** Related public valdkond tag slugs (informational). */
  relatedValdkond?: string[];
};

export const LAWS: LawEntry[] = [
  {
    slug: "jaatmeseadus",
    canonicalName: "Jäätmeseadus",
    abbreviation: "JäätS",
    weakKeywords: ["jäätmekäitlus", "jäätmemajandus"],
    relatedValdkond: ["keskkond-kliima-ja-jaatmed"],
  },
  {
    slug: "pakendiseadus",
    canonicalName: "Pakendiseadus",
    abbreviation: "PakS",
    weakKeywords: ["pakendijäätmed"],
    relatedValdkond: ["pakendid", "keskkond-kliima-ja-jaatmed"],
  },
  {
    slug: "toolepingu-seadus",
    canonicalName: "Töölepingu seadus",
    abbreviation: "TLS",
    aliases: ["töölepinguseadus"],
    relatedValdkond: ["too-ja-sotsiaalpoliitika"],
  },
  {
    slug: "tootervishoiu-ja-tooohutuse-seadus",
    canonicalName: "Töötervishoiu ja tööohutuse seadus",
    abbreviation: "TTOS",
    aliases: ["töötervishoiu ja tööohutuse seadus"],
    relatedValdkond: ["too-ja-sotsiaalpoliitika"],
  },
  {
    slug: "maksukorralduse-seadus",
    canonicalName: "Maksukorralduse seadus",
    abbreviation: "MKS",
    relatedValdkond: ["maksud-tasud-ja-aruandlus"],
  },
  {
    slug: "tulumaksuseadus",
    canonicalName: "Tulumaksuseadus",
    abbreviation: "TuMS",
    relatedValdkond: ["maksud-tasud-ja-aruandlus"],
  },
  {
    slug: "kaibemaksuseadus",
    canonicalName: "Käibemaksuseadus",
    abbreviation: "KMS",
    relatedValdkond: ["maksud-tasud-ja-aruandlus"],
  },
  {
    slug: "sotsiaalmaksuseadus",
    canonicalName: "Sotsiaalmaksuseadus",
    abbreviation: "SMS",
    relatedValdkond: ["maksud-tasud-ja-aruandlus", "too-ja-sotsiaalpoliitika"],
  },
  {
    slug: "ariseadustik",
    canonicalName: "Äriseadustik",
    abbreviation: "ÄS",
    relatedValdkond: ["ettevotluskeskkond-ja-konkurentsivoime"],
  },
  {
    slug: "volaoigusseadus",
    canonicalName: "Võlaõigusseadus",
    abbreviation: "VÕS",
    relatedValdkond: ["ettevotluskeskkond-ja-konkurentsivoime"],
  },
  {
    slug: "ehitusseadustik",
    canonicalName: "Ehitusseadustik",
    abbreviation: "EhS",
    relatedValdkond: ["kinnisvara-planeerimine-ja-ehitus"],
  },
  {
    slug: "planeerimisseadus",
    canonicalName: "Planeerimisseadus",
    abbreviation: "PlanS",
    relatedValdkond: ["kinnisvara-planeerimine-ja-ehitus"],
  },
  {
    slug: "riigihangete-seadus",
    canonicalName: "Riigihangete seadus",
    abbreviation: "RHS",
    relatedValdkond: ["riigihanked"],
  },
  {
    slug: "konkurentsiseadus",
    canonicalName: "Konkurentsiseadus",
    abbreviation: "KonkS",
    relatedValdkond: ["ettevotluskeskkond-ja-konkurentsivoime"],
  },
  {
    slug: "valismaalaste-seadus",
    canonicalName: "Välismaalaste seadus",
    abbreviation: "VMS",
    aliases: ["välismaalaste seadus"],
    relatedValdkond: ["valistoojoud-ja-ranne"],
  },
  {
    slug: "isikuandmete-kaitse-seadus",
    canonicalName: "Isikuandmete kaitse seadus",
    abbreviation: "IKS",
    aliases: ["andmekaitseseadus"],
    relatedValdkond: ["andmekaitse-kuberturvalisus-ja-ai"],
  },
  {
    slug: "tarbijakaitseseadus",
    canonicalName: "Tarbijakaitseseadus",
    abbreviation: "TKS",
    weakKeywords: ["tarbijakaitse"],
    relatedValdkond: ["tarbijakaitse-ja-muugireeglid"],
  },
  {
    slug: "reklaamiseadus",
    canonicalName: "Reklaamiseadus",
    abbreviation: "ReklS",
    relatedValdkond: ["tarbijakaitse-ja-muugireeglid"],
  },
  {
    slug: "elektroonilise-side-seadus",
    canonicalName: "Elektroonilise side seadus",
    abbreviation: "ESS",
    aliases: ["elektroonilise side seadus"],
    relatedValdkond: ["e-kaubandus-ja-digiteenused", "andmekaitse-kuberturvalisus-ja-ai"],
  },
  {
    slug: "liiklusseadus",
    canonicalName: "Liiklusseadus",
    abbreviation: "LS",
    relatedValdkond: ["transport-ja-logistika"],
  },
];

const LAW_BY_SLUG = new Map(LAWS.map((law) => [law.slug, law]));

export function getLawBySlug(slug: string): LawEntry | null {
  return LAW_BY_SLUG.get(slug) ?? null;
}

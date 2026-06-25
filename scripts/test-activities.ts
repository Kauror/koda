/**
 * DB-free tests for the canonical public business-sector (`Tegevusala`) filter
 * and the preserved cross-sector fallback behaviour. Pure functions only.
 *
 *   npm run activities:test
 */
import assert from "node:assert";
import {
  PUBLIC_ACTIVITY_FILTERS,
  PUBLIC_ACTIVITIES,
  CROSS_SECTOR_ACTIVITY,
  ENERGY_INTENSIVE_ACTIVITY,
  isPublicActivityFilterVisible,
  canonicalPublicActivitySlug,
} from "../src/lib/activities";
import { isPublicSearchEligible, type EligibilityFields } from "../src/lib/eligibility";
import {
  type Candidate,
  type SearchQuery,
  passesActiveFilters,
  scoreCandidate,
} from "../src/lib/search-core";
import { slugify } from "../src/lib/slug";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL- ${name}`);
    console.log("        " + (e as Error).message);
  }
}

const EXPECTED_SECTORS = [
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

const TOOSTUS = slugify("Tööstus ja tootmine");
const KAUBANDUS = slugify("Kaubandus");
const IT = slugify("Info, side ja IT");
const GENERIC = slugify(CROSS_SECTOR_ACTIVITY);
const ENERGY = slugify(ENERGY_INTENSIVE_ACTIVITY);

const EMPTY: SearchQuery = { q: "", valdkond: [], tegevusala: [], tapsustus: [], recipient: [], type: [] };

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: "x", externalId: "WEB1", title: "Test", displayTitle: null,
    adminDisplayTitleOverride: null, summary: null, adminSummaryOverride: null,
    companyRelevance: null, kodaPosition: null, sourceEvidence: null, excerpt: null,
    bodyText: null, canonicalUrl: "https://www.koda.ee/x", sourceUrl: null,
    sourceDataset: "web", sourceLayer: "koda_news", sourceTypeDetail: "meie_uudis",
    publicDisplayStatus: "main_result_candidate", outcomeStatus: null,
    publicPriority: "medium", manualWeight: 0, isEvergreen: false, date: null,
    canonicalContentId: null, duplicateStatus: "unique", contentHash: "h",
    valdkonnad: [], tegevusalad: [], tapsustused: [], oigusaktid: [],
    lawSearchAllowed: false, activityPrimarySlug: null, ...over,
  };
}
const generic = { slug: GENERIC, name: CROSS_SECTOR_ACTIVITY };
const passes = (q: SearchQuery, c: Candidate) => passesActiveFilters(q, scoreCandidate(c, q), c);
const total = (q: SearchQuery, c: Candidate) => scoreCandidate(c, q).total;

console.log("[test] public activity (Tegevusala) filter checks:");

// ---- A: exactly the 12 canonical sectors, in canonical order ----
check("A1: public Tegevusala filter has exactly 12 sectors", () =>
  assert.equal(PUBLIC_ACTIVITY_FILTERS.length, 12));
check("A2: sector labels match canonical list in canonical order", () =>
  assert.deepEqual(PUBLIC_ACTIVITY_FILTERS.map((o) => o.name), EXPECTED_SECTORS));
check("A3: sector slugs are unique", () =>
  assert.equal(new Set(PUBLIC_ACTIVITY_FILTERS.map((o) => o.slug)).size, 12));
check("A4: order is 1..12", () =>
  assert.deepEqual(PUBLIC_ACTIVITIES.map((a) => a.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));

// ---- B: must NOT include energy profile or cross-sector fallback ----
check("B1: 'Energia ja ressursimahukas tegevus' is not a public sector", () =>
  assert.ok(!PUBLIC_ACTIVITY_FILTERS.some((o) => o.name === ENERGY_INTENSIVE_ACTIVITY)));
check("B2: 'Kõik tegevusalad / valdkondadeülene' is not a public sector", () =>
  assert.ok(!PUBLIC_ACTIVITY_FILTERS.some((o) => o.name === CROSS_SECTOR_ACTIVITY)));
check("B3: isPublicActivityFilterVisible true for all 12 sectors", () =>
  assert.ok(EXPECTED_SECTORS.every((s) => isPublicActivityFilterVisible(s))));
check("B4: isPublicActivityFilterVisible false for energy + cross-sector", () => {
  assert.equal(isPublicActivityFilterVisible(ENERGY_INTENSIVE_ACTIVITY), false);
  assert.equal(isPublicActivityFilterVisible(CROSS_SECTOR_ACTIVITY), false);
  assert.equal(isPublicActivityFilterVisible(GENERIC), false);
  assert.equal(isPublicActivityFilterVisible(ENERGY), false);
});
check("B5: canonicalPublicActivitySlug folds a sector by name, drops non-sectors", () => {
  assert.equal(canonicalPublicActivitySlug({ slug: "whatever", name: "Kaubandus" }), KAUBANDUS);
  assert.equal(canonicalPublicActivitySlug({ slug: ENERGY, name: ENERGY_INTENSIVE_ACTIVITY }), null);
  assert.equal(canonicalPublicActivitySlug({ slug: GENERIC, name: CROSS_SECTOR_ACTIVITY }), null);
});

// ---- Cross-sector fallback preserved ----
check("selecting Tööstus includes cross-sector (valdkondadeülene) rows", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [TOOSTUS] };
  assert.equal(passes(q, cand({ tegevusalad: [generic] })), true);
});
check("selecting Kaubandus includes cross-sector rows", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [KAUBANDUS] };
  assert.equal(passes(q, cand({ tegevusalad: [generic] })), true);
});
check("selecting Info, side ja IT includes cross-sector rows", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [IT] };
  assert.equal(passes(q, cand({ tegevusalad: [generic] })), true);
});

// ---- Ranking: primary > secondary/other exact > cross-sector fallback ----
check("ranking: primary activity > exact (secondary) > cross-sector fallback", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [TOOSTUS] };
  const primary = cand({ tegevusalad: [{ slug: TOOSTUS, name: "Tööstus ja tootmine" }], activityPrimarySlug: TOOSTUS });
  const exactSecondary = cand({ tegevusalad: [{ slug: TOOSTUS, name: "Tööstus ja tootmine" }], activityPrimarySlug: KAUBANDUS });
  const cross = cand({ tegevusalad: [generic] });
  assert.ok(total(q, primary) > total(q, exactSecondary), "primary should beat secondary");
  assert.ok(total(q, exactSecondary) > total(q, cross), "exact should beat cross-sector");
});

// ---- Info filter must not over-rank unrelated industry/energy-only rows ----
check("Info filter excludes an industry-only row with no IT signal", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [IT] };
  const industryOnly = cand({ tegevusalad: [{ slug: TOOSTUS, name: "Tööstus ja tootmine" }], title: "Tööstuse uudis" });
  assert.equal(passes(q, industryOnly), false);
});
check("Info filter excludes an energy-only row with no IT signal", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [IT] };
  const energyOnly = cand({ tegevusalad: [{ slug: ENERGY, name: ENERGY_INTENSIVE_ACTIVITY }], title: "Energiahind tõuseb" });
  assert.equal(passes(q, energyOnly), false);
});
check("cross-sector fallback ranks an IT row no higher than an exact IT row", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [IT] };
  const exact = cand({ tegevusalad: [{ slug: IT, name: "Info, side ja IT" }], activityPrimarySlug: IT });
  const cross = cand({ tegevusalad: [generic] });
  assert.ok(total(q, exact) > total(q, cross));
});

// ---- Töövõidud enrichment cards still appear under a sector via cross-sector ----
check("a cross-sector töövõit is included under a specific sector filter", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: [TOOSTUS] };
  const toovoit = cand({
    sourceTypeDetail: "toovoit",
    sourceLayer: "koda_achievement",
    tegevusalad: [generic],
    outcomeStatus: "achieved",
  });
  assert.equal(passes(q, toovoit), true);
});

// ---- Eligibility unchanged: support-only/staging/held rows stay hidden ----
function elig(over: Partial<EligibilityFields> = {}): EligibilityFields {
  return {
    isPublic: true, isHidden: false, needsHumanReview: false, importStatus: "import_public",
    importAction: "import_public", publicDisplayAllowed: true, publicDisplayStatus: "public_ready",
    adminVisibilityOverride: null, sourceDataset: "web", ...over,
  };
}
check("eligibility: support-only rows stay hidden", () =>
  assert.equal(isPublicSearchEligible(elig({ importAction: "import_support_only" })), false));
check("eligibility: staging-only rows stay hidden", () =>
  assert.equal(isPublicSearchEligible(elig({ importAction: "import_staging_only" })), false));
check("eligibility: enrichment_hold rows stay hidden", () =>
  assert.equal(isPublicSearchEligible(elig({ importAction: "enrichment_hold" })), false));
check("eligibility: a normal public row is eligible", () =>
  assert.equal(isPublicSearchEligible(elig()), true));

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

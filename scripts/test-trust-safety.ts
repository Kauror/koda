/**
 * DB-free trust/safety tests: public date gate (A), relevance-first ranking and
 * news threshold (B/C), strict related-content rules (D), recipient metadata (E).
 *
 *   npm run trust:test
 */
import assert from "node:assert";
import { computePublicDate } from "../src/lib/public-date";
import { qualifiesAsLawTopicRelation, strongTextOverlap } from "../src/lib/related";
import { normalizeRecipient } from "../src/lib/recipient";
import {
  type Candidate,
  type SearchQuery,
  passesActiveFilters,
  scoreCandidate,
} from "../src/lib/search-core";

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

const NOW = new Date("2026-06-25T12:00:00Z");
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

console.log("[test] trust/safety checks:");

// ===================================================================== A: dates
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

check("A — TOOVOIT-0016: import-date 2026-06-24 + source year 2017 shows '2017', not '24. juuni 2026'", () => {
  const pd = computePublicDate({ date: d("2026-06-24"), year: 2017 }, NOW);
  assert.equal(pd.text, "2017");
  assert.equal(pd.precision, "year");
  assert.ok(!/2026/.test(pd.text ?? ""), "must not surface 2026");
});
check("A — import-date 2026-06-24 with no reliable year is suppressed (no exact date)", () => {
  const pd = computePublicDate({ date: d("2026-06-24") }, NOW);
  assert.equal(pd.text, null);
  assert.equal(pd.rankingDate, null);
});
check("A — soolise tasakaalu: 31.12.2026 (current-year year-end) is NOT shown as a date", () => {
  const pd = computePublicDate({ date: d("2026-12-31") }, NOW);
  assert.equal(pd.text, null);
  assert.ok(pd.precision !== "day");
});
check("A — 31.12.2026 with verified source year 2025 shows '2025'", () => {
  const pd = computePublicDate({ date: d("2026-12-31"), year: 2025 }, NOW);
  assert.equal(pd.text, "2025");
});
check("A — future exact date without basis is suppressed", () => {
  const pd = computePublicDate({ date: d("2027-03-01") }, NOW);
  assert.equal(pd.text, null);
});
check("A — a genuine verified day (19.06.2017) keeps day precision + ranking date", () => {
  const pd = computePublicDate({ date: d("2017-06-19") }, NOW);
  assert.equal(pd.precision, "day");
  assert.equal(pd.iso, "2017-06-19");
  assert.ok(pd.rankingDate instanceof Date);
  assert.ok((pd.text ?? "").includes("2017"));
});
check("A — past year-end placeholder (31.12.2019) degrades to year '2019'", () => {
  const pd = computePublicDate({ date: d("2019-12-31") }, NOW);
  assert.equal(pd.text, "2019");
  assert.equal(pd.precision, "year");
});

// =========================================================== B: ranking + recency
check("B — a placeholder/import date does not buy a recency boost over a verified recent date", () => {
  const placeholder = cand({ date: d("2026-06-24") }); // import placeholder
  const verifiedRecent = cand({ date: d("2026-06-20") }); // genuine, ~recent
  assert.ok(
    scoreCandidate(verifiedRecent, EMPTY).boost > scoreCandidate(placeholder, EMPTY).boost,
    "verified recent must outrank placeholder-dated row"
  );
});
check("B — cross-sector fallback ranks below primary and secondary activity matches", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["toostus-ja-tootmine"] };
  const primary = cand({ tegevusalad: [{ slug: "toostus-ja-tootmine", name: "Tööstus" }], activityPrimarySlug: "toostus-ja-tootmine" });
  const secondary = cand({ tegevusalad: [{ slug: "toostus-ja-tootmine", name: "Tööstus" }], activityPrimarySlug: "kaubandus" });
  const cross = cand({ tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }] });
  assert.ok(scoreCandidate(primary, q).total > scoreCandidate(secondary, q).total);
  assert.ok(scoreCandidate(secondary, q).total > scoreCandidate(cross, q).total);
});

// =========================================================== C: news threshold
// Mirrors the predicate used in search() to keep cross-sector-only news off
// activity-specific pages.
function newsRelevant(c: Candidate, q: SearchQuery): boolean {
  const b = scoreCandidate(c, q);
  return b.tegevusalaMatches > 0 || b.sectorFallbackMatches > 0 || b.valdkondMatches > 0 || (q.q.length > 0 && b.text > 0);
}
check("C — cross-sector-only news is NOT relevant under a specific activity (haridus)", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["haridus-ja-koolitus"] };
  const crossOnly = cand({ tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }], title: "Kemikaaliohutuse uudis" });
  assert.equal(newsRelevant(crossOnly, q), false);
});
check("C — sector-tagged news IS relevant under that activity", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["haridus-ja-koolitus"] };
  const sectorNews = cand({ tegevusalad: [{ slug: "haridus-ja-koolitus", name: "Haridus ja koolitus" }] });
  assert.equal(newsRelevant(sectorNews, q), true);
});

// =========================================================== D: strict related
const parentRel = {
  lawSlugs: ["tulumaksuseadus"],
  topicSlugs: ["maksud-tasud"],
  text: "Panditulumaks asendati mõistlikuma meetmega ettevõtjate jaoks",
};
check("D — shared BROAD topic only (youth work) is NOT related", () => {
  assert.equal(
    qualifiesAsLawTopicRelation(parentRel, { lawSlugs: [], topicSlugs: ["maksud-tasud"], text: "Noorte tööhõive programm" }),
    false
  );
});
check("D — different law (fuel excise) sharing only topic is NOT related", () => {
  assert.equal(
    qualifiesAsLawTopicRelation(parentRel, { lawSlugs: ["aktsiisiseadus"], topicSlugs: ["maksud-tasud"], text: "Kütuseaktsiis langeb" }),
    false
  );
});
check("D — same law sharing topic but with weak text overlap is NOT related", () => {
  assert.equal(
    qualifiesAsLawTopicRelation(parentRel, { lawSlugs: ["tulumaksuseadus"], topicSlugs: ["maksud-tasud"], text: "Hoopis muu küsimus" }),
    false
  );
});
check("D — same law + topic + strong text overlap IS related", () => {
  assert.equal(
    qualifiesAsLawTopicRelation(parentRel, {
      lawSlugs: ["tulumaksuseadus"],
      topicSlugs: ["maksud-tasud"],
      text: "Panditulumaks ettepanek asendati mõistlikuma meetmega",
    }),
    true
  );
});
check("D — strongTextOverlap needs >= 2 shared significant tokens", () => {
  assert.equal(strongTextOverlap("panditulumaks mõistlikuma meetmega", "panditulumaks mõistlikuma lahendus"), true);
  assert.equal(strongTextOverlap("panditulumaks ainus", "hoopis teine teema"), false);
});

// =========================================================== E: recipient metadata
check("E — historical/abbreviated ministry name normalizes to the current name", () => {
  const r = normalizeRecipient("Majandusministeerium");
  assert.equal(r?.normalized, "Majandus- ja Kommunikatsiooniministeerium");
  assert.equal(r?.type, "ministry");
  assert.equal(r?.reviewRequired, false);
  assert.ok(r?.filterGroup && r.filterGroup.length > 0);
});
check("E — unknown recipient is kept verbatim and flagged for review", () => {
  const r = normalizeRecipient("Tundmatu Asutus X");
  assert.equal(r?.normalized, "Tundmatu Asutus X");
  assert.equal(r?.reviewRequired, true);
});
check("E — explicit normalized/filterGroup columns win over derivation", () => {
  const r = normalizeRecipient("MKM", { normalized: "Majandus- ja Kommunikatsiooniministeerium", filterGroup: "mkm" });
  assert.equal(r?.normalized, "Majandus- ja Kommunikatsiooniministeerium");
  assert.equal(r?.filterGroup, "mkm");
  assert.equal(r?.reviewRequired, false);
});
check("E — recipient filter narrows by filter group (AND constraint)", () => {
  const q: SearchQuery = { ...EMPTY, recipient: ["rahandusministeerium"] };
  const match = cand({ recipientFilterGroup: "rahandusministeerium" });
  const other = cand({ recipientFilterGroup: "kliimaministeerium" });
  const none = cand({ recipientFilterGroup: null });
  assert.equal(passesActiveFilters(q, scoreCandidate(match, q), match), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(other, q), other), false);
  assert.equal(passesActiveFilters(q, scoreCandidate(none, q), none), false);
});
check("E — recipient is metadata only: it never becomes a topic match", () => {
  const q: SearchQuery = { ...EMPTY, recipient: ["rahandusministeerium"] };
  const c = cand({ recipientFilterGroup: "rahandusministeerium", valdkonnad: [{ slug: "maksud_tasud", name: "Maksud ja tasud" }] });
  // recipient filtering passes the row, but it contributes nothing to topic score.
  assert.equal(scoreCandidate(c, q).valdkondMatches, 0);
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

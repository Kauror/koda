/**
 * DB-free tests for the search/ranking core (eligibility, scoring, filters,
 * grouping classification). Pure functions only — runs on any Node.
 *
 *   npm run search:test
 */
import assert from "node:assert";
import {
  isPublicSearchEligible,
  isEvidenceEligible,
  type EligibilityFields,
  type EvidenceFields,
} from "../src/lib/eligibility";
import {
  type Candidate,
  type SearchQuery,
  assignKind,
  compareRankedCandidates,
  getRelatedTopicsForSector,
  getSectorRelevance,
  getSectorRelevanceExplanation,
  groupRankedCandidates,
  hasGenericSectorTag,
  hasOnlyGenericOrNoSector,
  hasSpecificNonMatchingSector,
  isKodaNews,
  parseSearchParams,
  passesActiveFilters,
  primaryType,
  rankRelatedOpinions,
  scoreCandidate,
} from "../src/lib/search-core";
import { outcomeLabel, sourceLabel } from "../src/lib/labels";
import { sourceCtaLabel } from "../src/lib/content-display";
import {
  detectLaw,
  extractLawMentions,
  lawMentionForSlug,
  rankLawContent,
} from "../src/lib/law-match";
import { firstTopic, splitTopics } from "../src/lib/taxonomy-split";

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

// --- helpers ---
function elig(over: Partial<EligibilityFields> = {}): EligibilityFields {
  return {
    isPublic: true,
    isHidden: false,
    needsHumanReview: false,
    numericClaimNeedsReview: false,
    importStatus: "import_public",
    importAction: "import_public",
    publicDisplayAllowed: true,
    publicDisplayStatus: "public_candidate",
    adminVisibilityOverride: null,
    sourceDataset: "web",
    ...over,
  };
}

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: "x",
    externalId: "WEB000001",
    title: "Test",
    displayTitle: null,
    adminDisplayTitleOverride: null,
    summary: null,
    adminSummaryOverride: null,
    companyRelevance: null,
    kodaPosition: null,
    sourceEvidence: null,
    excerpt: null,
    bodyText: null,
    canonicalUrl: "https://www.koda.ee/x",
    sourceUrl: null,
    sourceDataset: "web",
    sourceLayer: "koda_news",
    sourceTypeDetail: "meie_uudis",
    publicDisplayStatus: "main_result_candidate",
    outcomeStatus: null,
    publicPriority: "medium",
    manualWeight: 0,
    isEvergreen: false,
    date: null,
    canonicalContentId: null,
    duplicateStatus: "unique",
    contentHash: "h",
    valdkonnad: [],
    tegevusalad: [],
    tapsustused: [],
    oigusaktid: [],
    lawSearchAllowed: false,
    activityPrimarySlug: null,
    ...over,
  };
}

const EMPTY: SearchQuery = { q: "", valdkond: [], tegevusala: [], tapsustus: [], type: [] };
const total = (c: Candidate, q: SearchQuery = EMPTY) => scoreCandidate(c, q).total;

console.log("[test] search-core checks:");

// ---- Eligibility (Task 2) ----
check("eligible public web row passes", () => assert.equal(isPublicSearchEligible(elig()), true));
check("review-needed rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ needsHumanReview: true })), false));
check("do_not_import_public rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ importAction: "do_not_import_public" })), false));
check("admin_only rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ publicDisplayStatus: "admin_only" })), false));
check("hide_or_review rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ publicDisplayStatus: "hide_or_review" })), false));
check("public opinion rows pass under explicit v0.9.4 gates", () =>
  assert.equal(isPublicSearchEligible(elig({ sourceDataset: "opinions" })), true));
check("support-only rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ importAction: "import_support_only" })), false));
check("numeric-review rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ numericClaimNeedsReview: true })), false));
check("admin hidden override hides a row", () =>
  assert.equal(isPublicSearchEligible(elig({ adminVisibilityOverride: false })), false));
check("admin visible override surfaces a supporting opinion", () =>
  assert.equal(
    isPublicSearchEligible(elig({ sourceDataset: "opinions", isPublic: false, adminVisibilityOverride: true })),
    true
  ));
check("hidden/supporting-only row is not public", () =>
  assert.equal(isPublicSearchEligible(elig({ isHidden: true })), false));

// ---- Ranking (Task 5/10) ----
check("achievement ranks above ordinary news for matching topic", () => {
  const q: SearchQuery = { ...EMPTY, q: "maksud", valdkond: ["maksud-tasud-ja-aruandlus"] };
  const ach = cand({
    sourceTypeDetail: "toovoit",
    sourceLayer: "koda_achievement",
    title: "Pakendimaks jäi kehtestamata",
    outcomeStatus: "achieved",
    isEvergreen: true,
    valdkonnad: [{ slug: "maksud-tasud-ja-aruandlus", name: "Maksud" }],
  });
  const news = cand({
    sourceTypeDetail: "meie_uudis",
    sourceLayer: "koda_news",
    publicDisplayStatus: "topic_history", // realistic: news rows are not main_result_candidate
    title: "Uudis maksudest",
    valdkonnad: [{ slug: "maksud-tasud-ja-aruandlus", name: "Maksud" }],
    date: new Date(),
  });
  assert.ok(total(ach, q) > total(news, q), `ach ${total(ach, q)} !> news ${total(news, q)}`);
});

check("main_result_candidate ranks above topic_history", () => {
  const main = cand({ publicDisplayStatus: "main_result_candidate" });
  const hist = cand({ publicDisplayStatus: "topic_history", sourceLayer: "koda_public_opinion" });
  assert.ok(total(main) > total(hist));
});

check("exact title match beats weak body match", () => {
  const q: SearchQuery = { ...EMPTY, q: "pakendimaks" };
  const titleHit = cand({ title: "Pakendimaks", contentHash: "a" });
  const bodyHit = cand({ title: "Midagi muud", bodyText: "tekst pakendimaks tekst", contentHash: "b" });
  assert.ok(scoreCandidate(titleHit, q).text > scoreCandidate(bodyHit, q).text);
});

check("confirmed law tags boost keyword search", () => {
  const q: SearchQuery = { ...EMPTY, q: "Pakendiseadus" };
  const lawHit = cand({
    title: "Pakendi arutelu",
    oigusaktid: [{ slug: "pakendiseadus", name: "Pakendiseadus" }],
    lawSearchAllowed: true,
  });
  const candidateOnly = cand({
    title: "Pakendi arutelu",
    bodyText: "law_tags_candidate: Pakendiseadus",
    lawSearchAllowed: false,
  });
  assert.ok(scoreCandidate(lawHit, q).text > scoreCandidate(candidateOnly, q).text);
});
check("law-looking queries require confirmed law tags", () => {
  const q: SearchQuery = { ...EMPTY, q: "Töölepingu seadus" };
  const confirmed = cand({
    title: "Töölepingu muudatus",
    oigusaktid: [{ slug: "toolepingu-seadus", name: "Töölepingu seadus" }],
    lawSearchAllowed: true,
  });
  const bodyOnly = cand({
    title: "Töölepingu uudis",
    bodyText: "Töölepingu seadus on tekstis, kuid mitte kinnitatud seadusemärgendina.",
    lawSearchAllowed: false,
  });
  assert.equal(passesActiveFilters(q, scoreCandidate(confirmed, q), confirmed), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(bodyOnly, q), bodyOnly), false);
});

check("topic match boosts results", () => {
  const q: SearchQuery = { ...EMPTY, valdkond: ["energia"] };
  const withTopic = cand({ valdkonnad: [{ slug: "energia", name: "Energia" }] });
  const without = cand({ valdkonnad: [] });
  assert.ok(scoreCandidate(withTopic, q).filter > scoreCandidate(without, q).filter);
});

check("tapsustus is not over-weighted (lighter than valdkond)", () => {
  const qV: SearchQuery = { ...EMPTY, valdkond: ["energia"] };
  const qT: SearchQuery = { ...EMPTY, tapsustus: ["midagi"] };
  const cV = cand({ valdkonnad: [{ slug: "energia", name: "E" }] });
  const cT = cand({ tapsustused: [{ slug: "midagi", name: "M" }] });
  assert.ok(scoreCandidate(cV, qV).filter > scoreCandidate(cT, qT).filter);
});

check("older strong achievement outranks newer weak news", () => {
  const oldAch = cand({
    sourceTypeDetail: "toovoit",
    sourceLayer: "koda_achievement",
    outcomeStatus: "achieved",
    isEvergreen: true,
    date: new Date("2016-01-01"),
  });
  const newWeak = cand({
    sourceTypeDetail: "meie_uudis",
    sourceLayer: "koda_news",
    publicDisplayStatus: "topic_history",
    date: new Date(),
  });
  assert.ok(total(oldAch) > total(newWeak));
});

check("newer ordinary result wins within a close score band", () => {
  const oldNews = cand({
    id: "old",
    sourceTypeDetail: "meie_uudis",
    sourceLayer: "koda_news",
    date: new Date("2022-01-01"),
  });
  const newNews = cand({
    id: "new",
    sourceTypeDetail: "meie_uudis",
    sourceLayer: "koda_news",
    date: new Date("2026-01-15"),
  });
  const sorted = [
    { c: oldNews, total: 92 },
    { c: newNews, total: 84 },
  ].sort(compareRankedCandidates);
  assert.equal(sorted[0].c.id, "new");
});

check("strong old achievement is protected from weak newer ordinary row", () => {
  const oldAch = cand({
    id: "old-ach",
    sourceTypeDetail: "toovoit",
    sourceLayer: "koda_achievement",
    outcomeStatus: "achieved",
    date: new Date("2016-01-01"),
  });
  const newNews = cand({
    id: "new-news",
    sourceTypeDetail: "meie_uudis",
    sourceLayer: "koda_news",
    publicDisplayStatus: "topic_history",
    date: new Date("2026-01-01"),
  });
  const sorted = [
    { c: newNews, total: total(newNews) },
    { c: oldAch, total: total(oldAch) },
  ].sort(compareRankedCandidates);
  assert.equal(sorted[0].c.id, "old-ach");
});

// ---- Classification / filters (Task 3/6) ----
check("achievement classified as toovoit / kind toovoit", () => {
  const c = cand({ sourceTypeDetail: "toovoit", sourceLayer: "koda_achievement" });
  assert.equal(primaryType(c), "toovoit");
  assert.equal(assignKind(c), "toovoit");
});
check("annual report classified as kontekst", () => {
  const c = cand({ sourceDataset: "annual_reports", sourceLayer: "annual_report", sourceTypeDetail: "annual_report_policy_context" });
  assert.equal(primaryType(c), "aastaaruanne");
  assert.equal(assignKind(c), "kontekst");
});
check("news classified as uudis/news group", () => {
  const c = cand({ sourceTypeDetail: "meie_uudis", sourceLayer: "koda_news" });
  assert.equal(primaryType(c), "uudis");
  assert.equal(assignKind(c), "uudis");
  assert.equal(isKodaNews(c), true);
});
check("Koda opinion/article classified as arvamus group", () => {
  const c = cand({
    sourceTypeDetail: "meie_arvamus_article",
    sourceLayer: "koda_public_opinion",
  });
  assert.equal(primaryType(c), "arvamus");
  assert.equal(assignKind(c), "arvamus");
});

check("valdkond filter excludes non-matching", () => {
  const q: SearchQuery = { ...EMPTY, valdkond: ["energia"] };
  const c = cand({ valdkonnad: [{ slug: "maksud", name: "M" }] });
  assert.equal(passesActiveFilters(q, scoreCandidate(c, q), c), false);
});
check("tegevusala filter works", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["ehitus-ja-kinnisvara"] };
  const yes = cand({ tegevusalad: [{ slug: "ehitus-ja-kinnisvara", name: "Ehitus" }] });
  const no = cand({ tegevusalad: [] });
  assert.equal(passesActiveFilters(q, scoreCandidate(yes, q), yes), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(no, q), no), false);
});
check("sector-only search includes sector-matching Koda news", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  const news = cand({
    tegevusalad: [{ slug: "pollumajandus-metsandus-ja-kalandus", name: "Põllumajandus" }],
  });
  assert.equal(passesActiveFilters(q, scoreCandidate(news, q), news), true);
});
check("cross-sector (valdkondadeülene) rows are included under any specific sector, ranked below exact", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  const generic = cand({
    id: "generic",
    publicPriority: "medium",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
  });
  const exact = cand({
    id: "exact",
    publicPriority: "medium",
    tegevusalad: [{ slug: "pollumajandus-metsandus-ja-kalandus", name: "Põllumajandus" }],
  });
  assert.equal(hasGenericSectorTag(generic), true);
  // cross-sector rows ARE included without selecting the generic option…
  assert.equal(passesActiveFilters(q, scoreCandidate(generic, q), generic), true);
  // …but a sector-specific match ranks above the cross-sector row.
  assert.ok(scoreCandidate(exact, q).total > scoreCandidate(generic, q).total);
});
check("related generic sector row can appear below sector-specific matches", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-ja-side-it"] };
  const specific = cand({
    id: "specific",
    title: "IT teenuste areng",
    tegevusalad: [{ slug: "info-ja-side-it", name: "Info ja side / IT" }],
  });
  const generic = cand({
    id: "generic",
    title: "Andmekaitse ja digiteenused ettevõtjatele",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
    valdkonnad: [{ slug: "digi-andmed-ja-tehnoloogia", name: "Digi, andmed ja tehnoloogia" }],
  });
  assert.equal(passesActiveFilters(q, scoreCandidate(generic, q), generic), true);
  assert.ok(scoreCandidate(specific, q).total > scoreCandidate(generic, q).total);
});
check("Info/IT sector has deterministic related topic mapping", () => {
  const rule = getRelatedTopicsForSector("info-side-ja-it");
  assert.ok(rule);
  assert.ok(rule.topicNeedles.some((needle) => needle.includes("digi")));
  assert.equal(getRelatedTopicsForSector("info-ja-side-it"), rule);
});
check("Info/IT: a cross-sector e-commerce row is included as cross-sector but ranks below an exact IT match", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  const digital = cand({
    id: "digital",
    sourceLayer: "koda_public_opinion",
    sourceTypeDetail: "meie_arvamus_article",
    title: "E-kaubanduse ja andmekaitse muudatused",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
    valdkonnad: [{ slug: "e-kaubandus-ja-tarbijakaitse", name: "E-kaubandus ja tarbijakaitse" }],
  });
  // The keyword fallback itself still does not *promote* it on weak evidence…
  assert.equal(getSectorRelevance(digital, q.tegevusala).matches, 0);
  assert.equal(getSectorRelevanceExplanation(digital, "info-side-ja-it").fallbackBlockedReason, "sector-fallback-exclusion");
  // …but it IS included because it is explicitly tagged cross-sector.
  assert.equal(passesActiveFilters(q, scoreCandidate(digital, q), digital), true);
  const exact = cand({ id: "exact-it", title: "IT teenuste areng", tegevusalad: [{ slug: "info-side-ja-it", name: "Info ja side / IT" }] });
  assert.ok(scoreCandidate(exact, q).total > scoreCandidate(digital, q).total);
});
check("Info/IT: cross-sector rows (packaging, waste, etc.) are included as cross-sector", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  for (const [id, title] of [
    ["waste", "Jaatmeseadus vajab parandusi"],
    ["packaging", "Pakendi ja margistuse nouded muutuvad"],
    ["green-claims", "Keskkonnavaidete reeglid ja kaupade havitamine"],
    ["withdrawal", "E-poe taganemisnupp ja tarbija teavitamine"],
  ]) {
    const row = cand({
      id,
      title,
      tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Generic sector" }],
    });
    assert.equal(passesActiveFilters(q, scoreCandidate(row, q), row), true, id);
  }
});
check("Info/IT sector includes actual slug and old alias for strong technology fallback", () => {
  for (const slug of ["info-side-ja-it", "info-ja-side-it"]) {
    const q: SearchQuery = { ...EMPTY, tegevusala: [slug] };
    const ai = cand({
      id: `ai-${slug}`,
      title: "Tehisintellekti ja algoritmi nouded",
      tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Generic sector" }],
    });
    assert.equal(passesActiveFilters(q, scoreCandidate(ai, q), ai), true, slug);
  }
});
check("Info/IT sector includes cybersecurity, data protection, telecom and software fallback rows", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  for (const [id, title] of [
    ["cyber", "Kuberturvalisus ja infoturve ettevottes"],
    ["data", "Andmekaitse ja digiteenused ettevotjatele"],
    ["telecom", "Elektrooniline side ja telekommunikatsiooniteenused"],
    ["software", "Tarkvara ja digitaalne identiteet"],
  ]) {
    const row = cand({
      id,
      title,
      tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Generic sector" }],
    });
    assert.equal(passesActiveFilters(q, scoreCandidate(row, q), row), true, id);
  }
});
check("sector fallback ignores rows with explicit different sector tags", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  const trade = cand({
    title: "Tehisintellekt kaubanduse muugikanalites",
    tegevusalad: [{ slug: "kaubandus", name: "Kaubandus" }],
  });
  assert.equal(hasSpecificNonMatchingSector(trade, q.tegevusala), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(trade, q), trade), false);
});
check("exact sector matches still pass when fallback exclusion terms are present", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  const exact = cand({
    title: "Info ja side sektori e-kaubanduse platvorm",
    tegevusalad: [{ slug: "info-side-ja-it", name: "Info ja side / IT" }],
  });
  const explanation = getSectorRelevanceExplanation(exact, "info-side-ja-it");
  assert.equal(explanation.exactSectorMatch, true);
  assert.equal(passesActiveFilters(q, scoreCandidate(exact, q), exact), true);
});
check("body text alone does not create sector eligibility for a no-sector row", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  // No sector tag at all (not even cross-sector): the keyword fallback needs
  // title/summary evidence, so body-only keywords must not qualify.
  const noisy = cand({
    title: "Tavaline ettevotluse uudis",
    bodyText: "Tehisintellekt kuberturvalisus andmekaitse tarkvara digiteenused",
    tegevusalad: [],
  });
  assert.equal(hasOnlyGenericOrNoSector(noisy), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(noisy, q), noisy), false);
});
check("Koda news can appear in Info/IT sector results through related topic fallback", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  const news = cand({
    id: "news-it",
    sourceLayer: "koda_news",
    sourceTypeDetail: "meie_uudis",
    title: "Kübertugevuse ja tehisintellekti nõuded ettevõtjatele",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
    valdkonnad: [{ slug: "digi-andmed-ja-tehnoloogia", name: "Digi, andmed ja tehnoloogia" }],
  });
  assert.equal(assignKind(news), "uudis");
  assert.equal(passesActiveFilters(q, scoreCandidate(news, q), news), true);
});
check("agriculture: no-sector rows with broad terms (no anchor) are still excluded", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  // No sector tag → keyword fallback applies, and broad non-anchor terms are excluded.
  for (const [id, title] of [
    ["environment", "Keskkond ja jaatmed ettevottes"],
    ["permit", "Lubade ja planeeringu muudatused"],
    ["land", "Maa kasutamise uued reeglid"],
    ["food", "Toidu margistamise nouded"],
  ]) {
    const row = cand({ id, title, tegevusalad: [] });
    assert.equal(passesActiveFilters(q, scoreCandidate(row, q), row), false, id);
  }
});
check("agriculture: cross-sector tagged rows are included regardless of broad terms", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  const row = cand({
    id: "cross",
    title: "Keskkond ja jaatmed ettevottes",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
  });
  assert.equal(passesActiveFilters(q, scoreCandidate(row, q), row), true);
});
check("agriculture fallback includes agriculture, forestry and fishing anchors", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  for (const [id, title] of [
    ["farm", "Pollumajandustootja keskkonnaload"],
    ["forestry", "Metsandus ja maakasutus"],
    ["fishing", "Kalandusettevotja toetused"],
  ]) {
    const row = cand({
      id,
      title,
      tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Generic sector" }],
    });
    assert.equal(passesActiveFilters(q, scoreCandidate(row, q), row), true, id);
  }
});
check("recent relevant news wins within the news group", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  const oldNews = cand({
    id: "old-news",
    date: new Date("2022-01-01"),
    tegevusalad: [{ slug: "pollumajandus-metsandus-ja-kalandus", name: "Põllumajandus" }],
  });
  const newNews = cand({
    id: "new-news",
    date: new Date("2026-01-01"),
    tegevusalad: [{ slug: "pollumajandus-metsandus-ja-kalandus", name: "Põllumajandus" }],
  });
  const sorted = [
    { c: oldNews, total: scoreCandidate(oldNews, q).total },
    { c: newNews, total: scoreCandidate(newNews, q).total },
  ].sort(compareRankedCandidates);
  assert.equal(sorted[0].c.id, "new-news");
});
check("query-only search requires a text match", () => {
  const q: SearchQuery = { ...EMPTY, q: "energia" };
  const hit = cand({ title: "Energia hind", contentHash: "a" });
  const miss = cand({ title: "Maksud", contentHash: "b" });
  assert.equal(passesActiveFilters(q, scoreCandidate(hit, q), hit), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(miss, q), miss), false);
});
check("topic-only search works without sector", () => {
  const q: SearchQuery = { ...EMPTY, valdkond: ["energia"] };
  const c = cand({ valdkonnad: [{ slug: "energia", name: "E" }] });
  assert.equal(passesActiveFilters(q, scoreCandidate(c, q), c), true);
});
check("type filter restricts result type", () => {
  const q: SearchQuery = { ...EMPTY, type: ["toovoit"] };
  const ach = cand({ sourceTypeDetail: "toovoit", sourceLayer: "koda_achievement" });
  const news = cand({ sourceTypeDetail: "meie_uudis", sourceLayer: "koda_news" });
  assert.equal(passesActiveFilters(q, scoreCandidate(ach, q), ach), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(news, q), news), false);
});

check("grouped result counts distinguish matched rows from displayed capped rows", () => {
  const scored = [
    { c: cand({ id: "ach-1", sourceTypeDetail: "toovoit", sourceLayer: "koda_achievement" }), total: 90 },
    { c: cand({ id: "ach-2", sourceTypeDetail: "toovoit", sourceLayer: "koda_achievement" }), total: 80 },
    { c: cand({ id: "ach-3", sourceTypeDetail: "toovoit", sourceLayer: "koda_achievement" }), total: 70 },
    { c: cand({ id: "news-1", sourceTypeDetail: "meie_uudis", sourceLayer: "koda_news" }), total: 60 },
    { c: cand({ id: "news-2", sourceTypeDetail: "meie_uudis", sourceLayer: "koda_news" }), total: 50 },
  ];
  const grouped = groupRankedCandidates(scored, { toovoit: 2, arvamus: 5, uudis: 1, kontekst: 5 });
  assert.equal(grouped.totalMatchedBeforeCaps, 5);
  assert.equal(grouped.totalDisplayed, 3);
  assert.deepEqual(grouped.groupCounts.toovoit, { matched: 3, displayed: 2, cap: 2 });
  assert.deepEqual(grouped.groupCounts.uudis, { matched: 2, displayed: 1, cap: 1 });
  assert.deepEqual(grouped.displayed.map((row) => row.c.id), ["ach-1", "ach-2", "news-1"]);
});

// ---- Param parsing (Task 3) ----
check("parseSearchParams reads new params", () => {
  const q = parseSearchParams({ q: "maksud", valdkond: "a,b", tegevusala: "c", tapsustus: "d", type: "toovoit" });
  assert.deepEqual(q.valdkond, ["a", "b"]);
  assert.deepEqual(q.tegevusala, ["c"]);
  assert.deepEqual(q.type, ["toovoit"]);
  assert.equal(q.q, "maksud");
});
check("parseSearchParams maps legacy params into q", () => {
  const q = parseSearchParams({ huvid: "maksud", sektor: "toostus" });
  assert.ok(q.q.includes("maksud"));
});
check("parseSearchParams ignores unknown type values", () => {
  assert.deepEqual(parseSearchParams({ type: "toovoit,bogus" }).type, ["toovoit"]);
});

// ---- Detail direct-access eligibility (Task 9) ----
// The detail route 404s on anything isPublicSearchEligible rejects.
check("public item detail loads (eligible)", () => assert.equal(isPublicSearchEligible(elig()), true));
check("hidden item direct URL returns not found", () =>
  assert.equal(isPublicSearchEligible(elig({ isHidden: true, isPublic: false })), false));
check("hidden opinion item direct URL returns not found", () =>
  assert.equal(isPublicSearchEligible(elig({ sourceDataset: "opinions", isPublic: false })), false));
check("admin hidden override blocks detail", () =>
  assert.equal(isPublicSearchEligible(elig({ adminVisibilityOverride: false })), false));

// ---- Evidence eligibility (Task 6) ----
function ev(over: Partial<EvidenceFields> = {}): EvidenceFields {
  return { extractionQuality: "good", needsHumanReview: false, adminVisibilityOverride: null, ...over };
}
check("good supporting row is evidence-eligible", () => assert.equal(isEvidenceEligible(ev()), true));
check("needsHumanReview evidence excluded by default", () =>
  assert.equal(isEvidenceEligible(ev({ needsHumanReview: true })), false));
check("failed extraction not shown as evidence", () =>
  assert.equal(isEvidenceEligible(ev({ extractionQuality: "failed" })), false));
check("weak extraction not shown as evidence", () =>
  assert.equal(isEvidenceEligible(ev({ extractionQuality: "weak" })), false));
check("admin-hidden row not shown as evidence", () =>
  assert.equal(isEvidenceEligible(ev({ adminVisibilityOverride: false })), false));
check("hidden opinion can still be evidence when safe", () => {
  assert.equal(isPublicSearchEligible(elig({ sourceDataset: "opinions", isPublic: false })), false);
  assert.equal(isEvidenceEligible(ev()), true);
});

// ---- Related-opinion ranking + cap (Task 5) ----
check("related opinions: shared topic, capped, non-matching excluded", () => {
  const parent = cand({ valdkonnad: [{ slug: "energia", name: "Energia" }], title: "Energia hind" });
  const opinions: Candidate[] = [
    cand({ id: "o1", valdkonnad: [{ slug: "energia", name: "E" }], title: "Energia arvamus" }),
    cand({ id: "o2", valdkonnad: [{ slug: "energia", name: "E" }], title: "Veel energiast" }),
    cand({ id: "o3", valdkonnad: [{ slug: "maksud", name: "M" }], title: "Maksud" }), // no shared topic
  ];
  const ranked = rankRelatedOpinions(parent, opinions, 5);
  assert.equal(ranked.length, 2, "only shared-topic opinions");
  assert.ok(!ranked.find((o) => o.id === "o3"));
});
check("related opinions cap is enforced", () => {
  const parent = cand({ valdkonnad: [{ slug: "x", name: "X" }] });
  const many = Array.from({ length: 9 }, (_, i) =>
    cand({ id: `o${i}`, valdkonnad: [{ slug: "x", name: "X" }] })
  );
  assert.equal(rankRelatedOpinions(parent, many, 5).length, 5);
});

// ---- Labels (Task 7) ----
check("source labels are Estonian + correct", () => {
  assert.equal(sourceLabel("koda_achievement", "toovoit"), "Töövõit");
  assert.equal(sourceLabel("koda_news", "meie_uudis"), "Koja uudis");
  assert.equal(sourceLabel("annual_report", "annual_report_policy_context"), "Aastaaruande kontekst");
  assert.equal(sourceLabel("opinion_file", "opinion_file"), "Koja arvamus / toetav allikas");
});
check("Koda news uses news label and CTA", () => {
  assert.equal(sourceLabel("koda_news", "meie_uudis"), "Koja uudis");
  assert.equal(sourceCtaLabel({ sourceLayer: "koda_news", sourceTypeDetail: "meie_uudis" }), "Loe uudist");
});
check("outcome labels are Estonian", () => {
  assert.equal(outcomeLabel("achieved"), "Saavutatud");
  assert.equal(outcomeLabel("partially_achieved"), "Osaliselt saavutatud");
  assert.equal(outcomeLabel("ongoing"), "Töös");
  assert.equal(outcomeLabel("opposed"), "Koda oli vastu");
  assert.equal(outcomeLabel("outcome_unknown"), null);
});

// ---- Law / õigusakt search (Step 9) ----
check("exact law name is recognized", () => {
  const hit = detectLaw("Jäätmeseadus");
  assert.ok(hit);
  assert.equal(hit!.law.slug, "jaatmeseadus");
  assert.equal(hit!.mention.matchType, "exact_name");
  assert.equal(hit!.mention.confidence, "high");
});

check("inflected law name is recognized as high confidence", () => {
  for (const q of ["jäätmeseaduse muudatus", "uus jäätmeseadusega seotud ettepanek", "Pakendiseaduse eelnõu"]) {
    const hit = detectLaw(q);
    assert.ok(hit, `expected a law for "${q}"`);
    assert.equal(hit!.mention.confidence, "high");
    assert.equal(hit!.mention.matchType, "inflected_name");
  }
  assert.equal(detectLaw("jäätmeseaduse")!.law.slug, "jaatmeseadus");
});

check("multi-word law name matches with trailing inflection", () => {
  assert.equal(detectLaw("töölepingu seadus")!.law.slug, "toolepingu-seadus");
  assert.equal(detectLaw("töölepingu seaduse muudatus")!.law.slug, "toolepingu-seadus");
});

check("aliases are recognized (medium)", () => {
  const a = detectLaw("andmekaitseseadus");
  assert.equal(a!.law.slug, "isikuandmete-kaitse-seadus");
  assert.equal(a!.mention.matchType, "alias");
  const b = detectLaw("töölepinguseaduse järgi"); // no-space alias, inflected
  assert.equal(b!.law.slug, "toolepingu-seadus");
  assert.equal(b!.mention.matchType, "alias");
});

check("abbreviations are recognized case-insensitively (medium)", () => {
  for (const q of ["KMS", "kms"]) {
    const hit = detectLaw(q);
    assert.equal(hit!.law.slug, "kaibemaksuseadus");
    assert.equal(hit!.mention.matchType, "abbreviation");
    assert.equal(hit!.mention.confidence, "medium");
  }
  // Too-short abbreviations are not matched (avoids "LS"/"ÄS" noise).
  assert.equal(detectLaw("ls"), null);
});

check("broad everyday words never become a confirmed law match", () => {
  for (const broad of ["jäätmed", "pakend", "maks", "maksud", "töö", "töötajad", "ettevõte"]) {
    assert.equal(detectLaw(broad), null, `"${broad}" must not be recognized as a law`);
    const mentions = extractLawMentions({ title: broad });
    assert.ok(
      mentions.every((m) => m.confidence !== "high"),
      `"${broad}" must not produce a high-confidence law match`
    );
  }
});

check("weak topical keywords are low confidence and never trigger recognition", () => {
  const mentions = extractLawMentions({ title: "Uus jäätmekäitlus piirkonnas" });
  const jaatme = mentions.find((m) => m.slug === "jaatmeseadus");
  assert.ok(jaatme);
  assert.equal(jaatme!.matchType, "weak_keyword");
  assert.equal(jaatme!.confidence, "low");
  // Weak keyword alone does not recognize the law for search.
  assert.equal(detectLaw("jäätmekäitlus"), null);
  assert.equal(detectLaw("tarbijakaitse"), null);
});

check("missing/invalid text never crashes the matcher", () => {
  assert.deepEqual(extractLawMentions({}), []);
  assert.deepEqual(extractLawMentions({ title: null, summary: undefined, bodyText: null }), []);
  assert.equal(lawMentionForSlug({}, "jaatmeseadus"), null);
  assert.equal(detectLaw(null), null);
  assert.equal(detectLaw(undefined), null);
  assert.equal(detectLaw(""), null);
  assert.equal(detectLaw("   "), null);
});

check("content rows are matched to a law incl. inflected mentions", () => {
  const related = cand({ id: "a", title: "Jäätmeseaduse muudatus jõustus" });
  const unrelated = cand({ id: "b", title: "Maksupoliitika ülevaade" });
  assert.ok(lawMentionForSlug(related, "jaatmeseadus"));
  assert.equal(lawMentionForSlug(unrelated, "jaatmeseadus"), null);
});

check("searching a law finds related content, newest-first", () => {
  const older = cand({ id: "old", title: "Jäätmeseaduse esimene ettepanek", date: new Date("2019-03-01") });
  const newer = cand({ id: "new", title: "Jäätmeseaduse uus muudatus", date: new Date("2024-09-01") });
  const unrelated = cand({ id: "u", title: "Energia hind tõuseb", date: new Date("2025-01-01") });
  const ranked = rankLawContent([older, unrelated, newer], "jaatmeseadus");
  assert.deepEqual(ranked.map((c) => c.id), ["new", "old"]);
});

check("a confirmed law match satisfies the free-text filter (inflected query)", () => {
  const c = cand({ title: "Jäätmeseadus" });
  const q: SearchQuery = { ...EMPTY, q: "jäätmeseaduse" };
  const s = scoreCandidate(c, q);
  assert.equal(s.text, 0); // literal scorer misses the inflected query
  assert.equal(passesActiveFilters(q, s, c), false);
  assert.equal(passesActiveFilters(q, s, c, { lawMatch: true }), true);
});

// ---- Activity tiers: primary > secondary > cross-sector, all included ----
check("activity tiers rank primary > secondary > cross-sector and include all three", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["toostus-ja-tootmine"] };
  const primary = cand({
    id: "p",
    tegevusalad: [{ slug: "toostus-ja-tootmine", name: "Tööstus ja tootmine" }],
    activityPrimarySlug: "toostus-ja-tootmine",
  });
  const secondary = cand({
    id: "s",
    tegevusalad: [
      { slug: "kaubandus", name: "Kaubandus" },
      { slug: "toostus-ja-tootmine", name: "Tööstus ja tootmine" },
    ],
    activityPrimarySlug: "kaubandus", // industry is only the secondary activity here
  });
  const cross = cand({
    id: "c",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
  });
  for (const c of [primary, secondary, cross]) {
    assert.equal(passesActiveFilters(q, scoreCandidate(c, q), c), true, c.id);
  }
  assert.ok(scoreCandidate(primary, q).total > scoreCandidate(secondary, q).total, "primary > secondary");
  assert.ok(scoreCandidate(secondary, q).total > scoreCandidate(cross, q).total, "secondary > cross-sector");
});

check("cross-sector inclusion holds across the validation sectors (all layers)", () => {
  const sectors = ["toostus-ja-tootmine", "kaubandus", "info-side-ja-it", "ehitus-ja-kinnisvara", "transport-ja-logistika"];
  const layers = [
    { sourceTypeDetail: "toovoit", sourceLayer: "koda_achievement" }, // töövõit
    { sourceTypeDetail: "meie_arvamus_article", sourceLayer: "koda_public_opinion" }, // opinion
    { sourceTypeDetail: "meie_uudis", sourceLayer: "koda_news" }, // web/news
  ];
  for (const slug of sectors) {
    const q: SearchQuery = { ...EMPTY, tegevusala: [slug] };
    for (const layer of layers) {
      const cross = cand({
        id: `${slug}-${layer.sourceLayer}`,
        ...layer,
        tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
      });
      assert.equal(passesActiveFilters(q, scoreCandidate(cross, q), cross), true, `${slug}/${layer.sourceLayer}`);
    }
  }
});

// ---- Topic splitting: repair ";"-corrupted compound names (filter doubling) ----
check("splitTopics keeps real ';' separators but repairs ';'-for-',' corruption", () => {
  // genuine multi-topic separators (next topic Capitalised) are preserved
  assert.deepEqual(splitTopics("Bürokraatia ja halduskoormus; Maksud ja tasud"), [
    "Bürokraatia ja halduskoormus",
    "Maksud ja tasud",
  ]);
  assert.deepEqual(splitTopics("Digi, andmed, AI ja küberturvalisus; E-kaubandus ja tarbijakaitse"), [
    "Digi, andmed, AI ja küberturvalisus",
    "E-kaubandus ja tarbijakaitse",
  ]);
  // ';' before a lowercase word is an intra-name corruption → restored to ', '
  assert.deepEqual(splitTopics("Eksport; rahvusvahelistumine ja toll"), ["Eksport, rahvusvahelistumine ja toll"]);
  assert.deepEqual(splitTopics("Energia; elektrihind ja varustuskindlus"), ["Energia, elektrihind ja varustuskindlus"]);
  assert.deepEqual(splitTopics("Alkohol; tubakas ja aktsiisikaubad"), ["Alkohol, tubakas ja aktsiisikaubad"]);
  // mixed: corruption + a genuine following topic
  assert.deepEqual(splitTopics("Eksport; rahvusvahelistumine ja toll; Euroopa Liidu poliitika ja õigus"), [
    "Eksport, rahvusvahelistumine ja toll",
    "Euroopa Liidu poliitika ja õigus",
  ]);
  assert.deepEqual(splitTopics(""), []);
});

check("firstTopic returns the primary value, repairing ;-corruption and multi-value", () => {
  assert.equal(firstTopic("Eksport; rahvusvahelistumine ja toll"), "Eksport, rahvusvahelistumine ja toll");
  assert.equal(firstTopic("Tööstus ja tootmine; Kaubandus"), "Tööstus ja tootmine");
  assert.equal(firstTopic("Maksud ja tasud"), "Maksud ja tasud");
  assert.equal(firstTopic(null), null);
  assert.equal(firstTopic(""), null);
});

check("law-query gate is strict by default but relaxes to normal search as a fallback", () => {
  const q: SearchQuery = { ...EMPTY, q: "uus seadus" };
  const row = cand({ title: "Uus seadus ettevõtjatele", lawSearchAllowed: false }); // no confirmed law tag
  const s = scoreCandidate(row, q);
  assert.equal(passesActiveFilters(q, s, row, {}), false); // strict: needs a confirmed law match
  assert.equal(passesActiveFilters(q, s, row, { relaxLawGate: true }), true); // fallback: normal text match
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

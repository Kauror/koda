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
    importStatus: "import_public_candidate",
    publicDisplayStatus: "main_result_candidate",
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
check("do_not_import_yet rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ importStatus: "do_not_import_yet" })), false));
check("admin_only rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ publicDisplayStatus: "admin_only" })), false));
check("hide_or_review rows are not public", () =>
  assert.equal(isPublicSearchEligible(elig({ publicDisplayStatus: "hide_or_review" })), false));
check("opinion rows are not public by default", () =>
  assert.equal(isPublicSearchEligible(elig({ sourceDataset: "opinions" })), false));
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
check("generic sector fallback does not flood unrelated sector searches", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  const generic = cand({
    publicPriority: "medium",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
  });
  assert.equal(hasGenericSectorTag(generic), true);
  assert.equal(passesActiveFilters(q, scoreCandidate(generic, q), generic), false);
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
check("Info/IT sector excludes e-commerce and consumer-protection fallback rows", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  const digital = cand({
    id: "digital",
    sourceLayer: "koda_public_opinion",
    sourceTypeDetail: "meie_arvamus_article",
    title: "E-kaubanduse ja andmekaitse muudatused",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }],
    valdkonnad: [{ slug: "e-kaubandus-ja-tarbijakaitse", name: "E-kaubandus ja tarbijakaitse" }],
  });
  const relevance = getSectorRelevance(digital, q.tegevusala);
  const explanation = getSectorRelevanceExplanation(digital, "info-side-ja-it");
  assert.equal(relevance.matches, 0);
  assert.equal(explanation.fallbackAllowed, false);
  assert.equal(explanation.fallbackBlockedReason, "sector-fallback-exclusion");
  assert.equal(passesActiveFilters(q, scoreCandidate(digital, q), digital), false);
});
check("Info/IT sector excludes packaging, waste, labelling and environmental-claims fallback rows", () => {
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
    assert.equal(passesActiveFilters(q, scoreCandidate(row, q), row), false, id);
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
check("body text alone does not create sector fallback eligibility", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["info-side-ja-it"] };
  const noisy = cand({
    title: "Tavaline ettevotluse uudis",
    bodyText: "Tehisintellekt kuberturvalisus andmekaitse tarkvara digiteenused",
    tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Generic sector" }],
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
check("agriculture fallback excludes broad environment, permit, planning, land and food terms without anchors", () => {
  const q: SearchQuery = { ...EMPTY, tegevusala: ["pollumajandus-metsandus-ja-kalandus"] };
  for (const [id, title] of [
    ["environment", "Keskkond ja jaatmed ettevottes"],
    ["permit", "Lubade ja planeeringu muudatused"],
    ["land", "Maa kasutamise uued reeglid"],
    ["food", "Toidu margistamise nouded"],
  ]) {
    const row = cand({
      id,
      title,
      tegevusalad: [{ slug: "koik-tegevusalad-valdkondadeulene", name: "Generic sector" }],
    });
    assert.equal(passesActiveFilters(q, scoreCandidate(row, q), row), false, id);
  }
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
check("opinion item direct URL returns not found by default", () =>
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
check("opinion can be evidence even though not a public result", () => {
  // opinions fail the public gate but pass the evidence gate (good extraction, no review)
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

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

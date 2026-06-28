import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  firstCleanPublicParagraph,
  getCleanPublicExcerpt,
  getPublicDetailSummary,
  isDuplicateText,
  isGenericWorkWinUrl,
  isUnsafePublicDetailText,
  sourceCtaLabel,
  uniquePublicTexts,
} from "../src/lib/content-display";
import { displayablePublicActivities, isInternalFallbackActivity } from "../src/lib/activities";
import { shouldShowRecipientChip } from "../src/lib/search-core";
import { buildLawChips } from "../src/lib/law-match";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL- ${name}`);
    console.log("        " + (error as Error).message);
  }
}

console.log("[test] public UI checks:");

check("source CTA labels are contextual", () => {
  assert.equal(sourceCtaLabel({ sourceLayer: "koda_news", sourceTypeDetail: "meie_uudis" }), "Loe uudist");
  assert.equal(
    sourceCtaLabel({ sourceLayer: "koda_public_opinion", sourceTypeDetail: "meie_arvamus_article" }),
    "Loe koja arvamust"
  );
  assert.equal(sourceCtaLabel({ sourceLayer: "koda_achievement", sourceTypeDetail: "toovoit" }), "Vaata töövõitu");
  assert.equal(
    sourceCtaLabel({ sourceLayer: "annual_report", sourceTypeDetail: "annual_report_policy_context" }),
    "Loe konteksti"
  );
  assert.equal(sourceCtaLabel({ sourceLayer: "other", sourceTypeDetail: "unknown" }), "Ava koda.ee allikas");
});

check("noisy navigation/body snippets are not public excerpts", () => {
  const noisy = "Liigu edasi põhisisu juurde Avaleht Menüü Otsing Javascript";
  assert.equal(getCleanPublicExcerpt({ bodyText: noisy }), null);
});

check("clean fields are preferred over body text", () => {
  assert.equal(
    getCleanPublicExcerpt({ summary: "Selge kokkuvõte ettevõtjale.", bodyText: "Liigu edasi põhisisu juurde" }),
    "Selge kokkuvõte ettevõtjale."
  );
});

check("detail text deduplication removes repeated summary blocks", () => {
  const values = uniquePublicTexts([
    "Koda saavutas olulise muudatuse ettevõtjate jaoks.",
    "Koda saavutas olulise muudatuse ettevõtjate jaoks.",
    "Täiendav mõju kirjeldus.",
  ]);
  assert.deepEqual(values, [
    "Koda saavutas olulise muudatuse ettevõtjate jaoks.",
    "Täiendav mõju kirjeldus.",
  ]);
  assert.equal(isDuplicateText(values[0], values[1]), false);
});

check("text ending with ellipsis is unsafe for public detail summary", () => {
  assert.equal(isUnsafePublicDetailText("Koda andis ministeeriumile teada, et eelnõu..."), true);
  assert.equal(isUnsafePublicDetailText("Koda andis ministeeriumile teada, et eelnõu…"), true);
  assert.equal(isUnsafePublicDetailText("Koda andis ministeeriumile teada, et eelnõuâ€¦"), true);
});

check("first clean body paragraph is preferred for Koda web rows", () => {
  const summary = getPublicDetailSummary({
    sourceDataset: "web",
    sourceLayer: "koda_news",
    sourceTypeDetail: "meie_uudis",
    summary: "Katkine imporditud kokkuvõte...",
    bodyText: "Liigu edasi põhisisu juurde\n\nKoda selgitas ministeeriumile, miks muudatus vajab täpsemat mõjuanalüüsi.\n\nTeine lõik.",
  });
  assert.equal(summary, "Koda selgitas ministeeriumile, miks muudatus vajab täpsemat mõjuanalüüsi.");
});

check("clean curated summary is allowed for non-web detail rows", () => {
  const summary = getPublicDetailSummary({
    sourceDataset: "annual_reports",
    summary: "Aruanne kirjeldab koja pikemat tööd ettevõtjate halduskoormuse vähendamisel.",
    bodyText: "Aruande toortekst võib olla pikem.",
  });
  assert.equal(summary, "Aruanne kirjeldab koja pikemat tööd ettevõtjate halduskoormuse vähendamisel.");
});

check("unsafe excerpt falls back to body text", () => {
  const summary = getPublicDetailSummary({
    sourceDataset: "web",
    sourceLayer: "koda_public_opinion",
    sourceTypeDetail: "meie_arvamus_article",
    excerpt: "Koda tegi ettepaneku muuta määrust...",
    bodyText: "Koda tegi ettepaneku muuta määrust nii, et ettevõtjatele jääks piisav üleminekuaeg.",
  });
  assert.equal(
    summary,
    "Koda tegi ettepaneku muuta määrust nii, et ettevõtjatele jääks piisav üleminekuaeg."
  );
});

check("no safe text returns null and keeps source CTA fallback path", () => {
  const summary = getPublicDetailSummary({
    sourceDataset: "web",
    sourceLayer: "koda_news",
    summary: "Katkine tekst...",
    excerpt: "Veel katkisem tekst...",
    bodyText: "Avaleht Menüü Otsing Javascript",
  });
  assert.equal(summary, null);
});

check("WEB-like broken examples do not render truncated detail text", () => {
  const ids = ["WEB003788", "WEB003719", "WEB003096"];
  for (const id of ids) {
    const summary = getPublicDetailSummary({
      sourceDataset: "web",
      sourceLayer: "koda_news",
      sourceTypeDetail: "meie_uudis",
      summary: `${id} katkine genereeritud kokkuvõte...`,
      excerpt: `${id} katkine väljavõte...`,
      bodyText: "Koda selgitas avalikus materjalis ettevõtjate jaoks olulist muudatust ja selle mõju.",
    });
    assert.ok(summary);
    assert.ok(!summary.endsWith("..."));
    assert.ok(!summary.endsWith("…"));
  }
});

check("first paragraph extractor skips navigation fragments", () => {
  assert.equal(
    firstCleanPublicParagraph("Avaleht\nMenüü\n\nKoda toetab ettevõtjatele selgemaid reegleid."),
    "Koda toetab ettevõtjatele selgemaid reegleid."
  );
});

check("public detail page does not render backend metadata/supporting headings", () => {
  const source = readFileSync("src/app/sisu/[id]/page.tsx", "utf8");
  assert.ok(!source.includes("Algallikas"));
  assert.ok(!source.includes("Seotud allikad ja taust"));
  assert.ok(!source.includes("Toetavad arvamused"));
  assert.ok(!source.includes("sourceFileName"));
  assert.ok(!source.includes("canonicalUrl"));
  assert.ok(!source.includes(".xlsx"));
  assert.ok(!source.includes(".csv"));
});

check("teema ajalugu uses contextual CTA labels, not generic allikas wording", () => {
  const source = readFileSync("src/app/sisu/[id]/page.tsx", "utf8");
  assert.ok(source.includes("sourceCtaLabel"));
  assert.ok(!source.includes("Vaata allikat"));
});

check("results page uses incremental batch-of-3 load-more pagination", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  // Sections render through the LoadMore client component (batches of 3),
  // keyed by the active query so the visible count resets on filter/search change.
  assert.ok(source.includes("import LoadMore"));
  assert.ok(source.includes("<LoadMore"));
  assert.ok(source.includes("batchSize={LOAD_MORE_BATCH}"));
  assert.ok(source.includes("initialVisibleCount={initialVisibleCount}"));
  assert.ok(source.includes("initialVisibleCount={results.achievementsInitialVisible}"));
  assert.ok(source.includes("const LOAD_MORE_BATCH = 3"));
  assert.ok(source.includes("resetKey={editQuery}"));
  // The old "show 2, dump the rest in a <details>" pattern is gone.
  assert.ok(!source.includes("hiddenCards.map"));

  const loadMore = readFileSync("src/app/tulemused/LoadMore.tsx", "utf8");
  assert.ok(loadMore.includes("Näita rohkem"));
  assert.ok(loadMore.includes("\"use client\""));
  assert.ok(loadMore.includes("batchSize = 3"));
  assert.ok(loadMore.includes("initialVisibleCount"));
  assert.ok(!loadMore.includes("kokku"));
  assert.ok(!loadMore.includes("veel {"));
});

check("nested töövõidud sections are collapsed by default (no open attribute)", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  // The nested <details> must NOT be force-opened (open by default would expand
  // every timeline on load). Threads no longer pass open={isThread}.
  assert.ok(source.includes('<details className="nested-section">'));
  assert.ok(!source.includes("open={isThread}"));
  // Estonian expand controls + counts.
  assert.ok(source.includes("Näita seotud etappe"));
  assert.ok(source.includes("Näita ajajoont"));
});

check("results page separates news/progress from opinions", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  assert.ok(source.includes("Koja seisukohad"));
  assert.ok(source.includes("Koja uudised"));
  assert.ok(source.includes("Veel samal teemal"));
  assert.ok(source.includes("results.news"));
  assert.ok(source.includes("valdkondadeüleseid tulemusi"));
  assert.ok(!source.includes("Vaata allikat"));
  assert.ok(!source.includes("Koja avalikud seisukohad, ettepanekud ja hoiatused."));
  assert.ok(!source.includes("Koda.ee uudised, praktilised muutused ja teema edenemise vahekokkuvõtted."));
  assert.ok(!source.includes("Aastaaruannete kontekst ja koja pikem töö samadel teemadel."));
});

check("results page does not show capped total copy", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  assert.ok(!source.includes("results-count-line"));
  assert.ok(!source.includes("Kuvame neist"));
});

check("search form allows topic-only search (sector not mandatory) and hides removed type filters", () => {
  const source = readFileSync("src/app/SearchForm.tsx", "utf8");
  // Sector is no longer mandatory: a search needs at least one filter, but the
  // user may search by Teema / valdkond (or recipient) alone.
  assert.ok(source.includes("hasAnyFilter"));
  assert.ok(!source.includes("tegevusalaOptions.length > 0 && tegevusala.length === 0"));
  // The cross-sector fallback option is hidden via the shared helper.
  assert.ok(source.includes("isInternalFallbackActivity"));
  // The recipient/ministry filter section is removed from public search.
  assert.ok(!source.includes("Adressaat / ministeerium"));
  assert.ok(!source.includes("Kellele koda pöördus"));
  assert.ok(source.includes('type="submit"'));
  assert.ok(source.includes("Teema / valdkond"));
  assert.ok(!source.includes('type="search"'));
  assert.ok(!source.includes('name="q"'));
  assert.ok(!source.includes("Otsi teemat või märksõna"));
  assert.ok(!source.includes("Ettevõtte olukord / täpsustus"));
  assert.ok(!source.includes("Tulemuse tüüp"));
  assert.ok(!source.includes("RESULT_TYPES"));
  assert.ok(!source.includes('p.set("tapsustus"'));
  assert.ok(!source.includes('p.set("type"'));
  assert.ok(!source.includes("Esialgne täiendav filter"));
  assert.ok(!source.includes("Aastaaruanne"));
  assert.ok(!source.includes("Taust"));
});

check("homepage does not show example keyword shortcuts", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");
  assert.ok(!source.includes("EXAMPLE_SEARCHES"));
  assert.ok(!source.includes("homepage.search.examplesTitle"));
  assert.ok(!source.includes("Näiteks:"));
});

check("homepage keeps filter groups when database options are unavailable", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");
  assert.ok(source.includes("FALLBACK_FILTER_OPTIONS"));
  assert.ok(source.includes("withFallbackOptions"));
  assert.ok(source.includes("filterOptions"));
  assert.ok(source.includes("Tööstus ja tootmine"));
  assert.ok(source.includes("Maksud, tasud ja aruandlus"));
  assert.ok(source.includes("tapsustused: []"));
  assert.ok(!source.includes("using empty filter list"));
});

check("detail page hides front-facing outcome status metadata", () => {
  const source = readFileSync("src/app/sisu/[id]/page.tsx", "utf8");
  assert.ok(source.includes("Veel samal teemal"));
  assert.ok(!source.includes("<dt>Tulemus</dt>"));
  assert.ok(!source.includes("{item.outcomeLabel &&"));
});

check("legacy crawler requires explicit opt-in before running", () => {
  const source = readFileSync("scripts/crawl.ts", "utf8");
  const envExample = readFileSync(".env.example", "utf8");
  assert.ok(source.includes("--legacy-ok"));
  assert.ok(source.includes("CRAWLER_ENABLED || \"false\""));
  assert.ok(source.includes("Refusing to run the legacy crawler"));
  assert.ok(envExample.includes("CRAWLER_ENABLED=false"));
});

check("result cards show linked law tags, not generic topic/sector chips", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  assert.ok(source.includes("card.laws"));
  assert.ok(source.includes("tag-law"));
  assert.ok(source.includes("/seadused/"));
  // The "Seotud õigusaktid:" label is removed; only the blue chips remain.
  assert.ok(!source.includes("Seotud õigusaktid"));
  // The old generic valdkond/tegevusala chip rendering is gone from the card.
  assert.ok(!source.includes("card.valdkonnad.slice"));
  assert.ok(!source.includes("card.tegevusalad.slice"));
  assert.ok(!source.includes("tag tag-muted"));
});

check("result cards use one internal 'Loe lähemalt' CTA and recipient chips", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  // Internal CTA renamed everywhere on the results page.
  assert.ok(source.includes("Loe lähemalt"));
  assert.ok(!source.includes("Vaata kokkuvõtet"));
  // Recipient/ministry shows as a clickable chip (filters by recipient) next to laws.
  assert.ok(source.includes("card.recipient"));
  assert.ok(source.includes("tag-recipient"));
  assert.ok(source.includes("recipient=$"));
  // Law chips link to /seadused when a page exists, else to a filtered search.
  assert.ok(source.includes("law.hasPage"));
  assert.ok(source.includes("/seadused/"));
  assert.ok(source.includes("q=$"));
  // Töövõit and news cards drop the external source link (one CTA only); the
  // generic koda.ee work-wins listing is never linked.
  assert.ok(source.includes("isGenericWorkWinUrl"));
  assert.ok(source.includes('card.kind !== "uudis"'));
});

check("law page renames news section, renames CTA and drops generic work-win links", () => {
  const source = readFileSync("src/app/seadused/[slug]/page.tsx", "utf8");
  assert.ok(source.includes('title="Uudised"'));
  assert.ok(!source.includes("Uudised ja arengud"));
  assert.ok(source.includes("Loe lähemalt"));
  assert.ok(!source.includes("Vaata kokkuvõtet"));
  assert.ok(source.includes("isGenericWorkWinUrl"));
});

check("work-win / news detail page hides the generic external source button", () => {
  const source = readFileSync("src/app/sisu/[id]/page.tsx", "utf8");
  assert.ok(source.includes("isGenericWorkWinUrl"));
  // Recipient/ministry chip is rendered on relevant detail pages.
  assert.ok(source.includes("item.recipient"));
  assert.ok(source.includes("tag-recipient"));
});

check("isInternalFallbackActivity suppresses the cross-sector fallback only", () => {
  assert.equal(
    isInternalFallbackActivity({ slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" }),
    true
  );
  assert.equal(isInternalFallbackActivity({ slug: "", name: "valdkondadeülene" }), true);
  assert.equal(isInternalFallbackActivity({ slug: "", name: "Kõik tegevusalad" }), true);
  // Real sectors are kept.
  assert.equal(isInternalFallbackActivity({ slug: "kaubandus", name: "Kaubandus" }), false);
  assert.equal(isInternalFallbackActivity({ slug: "toostus-ja-tootmine", name: "Tööstus ja tootmine" }), false);

  const filtered = displayablePublicActivities([
    { slug: "kaubandus", name: "Kaubandus" },
    { slug: "koik-tegevusalad-valdkondadeulene", name: "Kõik tegevusalad / valdkondadeülene" },
  ]);
  assert.deepEqual(filtered, [{ slug: "kaubandus", name: "Kaubandus" }]);
});

check("shouldShowRecipientChip: opinions/news with a recipient only", () => {
  assert.equal(shouldShowRecipientChip({ kind: "arvamus", hasRecipient: true }), true);
  assert.equal(shouldShowRecipientChip({ kind: "uudis", hasRecipient: true }), true);
  // No recipient → never shown.
  assert.equal(shouldShowRecipientChip({ kind: "arvamus", hasRecipient: false }), false);
  // Work wins and background never show recipient chips.
  assert.equal(shouldShowRecipientChip({ kind: "toovoit", hasRecipient: true }), false);
  assert.equal(shouldShowRecipientChip({ kind: "kontekst", hasRecipient: true }), false);
});

check("buildLawChips uses confirmed tags (incl. non-dictionary) + dictionary mentions", () => {
  // Confirmed tag for a law OUTSIDE the 20-law dictionary still becomes a chip,
  // flagged hasPage:false (no /seadused page) — this is the missing-law fix.
  const offDict = buildLawChips({
    title: "Raamatupidamise seaduse ja audiitortegevuse seaduse muutmine",
    oigusaktid: [{ slug: "raamatupidamise-seadus", name: "Raamatupidamise seadus" }],
  });
  assert.deepEqual(offDict, [
    { slug: "raamatupidamise-seadus", canonicalName: "Raamatupidamise seadus", hasPage: false },
  ]);

  // Confirmed tag for a dictionary law → hasPage:true (links to /seadused).
  const dict = buildLawChips({ title: "x", oigusaktid: [{ slug: "riigihangete-seadus", name: "Riigihangete seadus" }] });
  assert.equal(dict.length, 1);
  assert.equal(dict[0].hasPage, true);

  // Dictionary text-mention with no confirmed tag is still surfaced.
  const mention = buildLawChips({ title: "Pakendiseadus muutub taas", oigusaktid: [] });
  assert.ok(mention.some((l) => l.slug === "pakendiseadus" && l.hasPage));

  // No laws → empty.
  assert.deepEqual(buildLawChips({ title: "Üldine uudis ettevõtjatele", oigusaktid: [] }), []);
});

check("isGenericWorkWinUrl matches the generic koda.ee work-wins listing only", () => {
  assert.equal(isGenericWorkWinUrl("https://www.koda.ee/et/meie-moju/meie-toovoidud"), true);
  assert.equal(isGenericWorkWinUrl("/et/meie-moju/meie-toovoidud"), true);
  assert.equal(isGenericWorkWinUrl("https://www.koda.ee/et/uudised/mingi-konkreetne-artikkel"), false);
  assert.equal(isGenericWorkWinUrl(null), false);
  assert.equal(isGenericWorkWinUrl(undefined), false);
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

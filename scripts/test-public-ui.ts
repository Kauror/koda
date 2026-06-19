import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  firstCleanPublicParagraph,
  getCleanPublicExcerpt,
  getPublicDetailSummary,
  isDuplicateText,
  isUnsafePublicDetailText,
  sourceCtaLabel,
  uniquePublicTexts,
} from "../src/lib/content-display";

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

check("results page uses compact expandable sections", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  assert.ok(source.includes("const visibleLimit = compactAchievements ? 2 : initialVisibleCount ?? cards.length"));
  assert.ok(source.includes("Näita rohkem"));
  assert.ok(source.includes("hiddenCards.map"));
  assert.ok(source.includes("initialVisibleCount={5}"));
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

check("search form requires a concrete sector and hides removed type filters", () => {
  const source = readFileSync("src/app/SearchForm.tsx", "utf8");
  assert.ok(source.includes("tegevusala.length === 0"));
  assert.ok(source.includes("isGenericSectorOption"));
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

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

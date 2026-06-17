import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  getCleanPublicExcerpt,
  isDuplicateText,
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

check("results page shows two achievements before the expand control", () => {
  const source = readFileSync("src/app/tulemused/page.tsx", "utf8");
  assert.ok(source.includes("cards.slice(0, 2)"));
  assert.ok(source.includes("Näita veel töövõite"));
  assert.ok(source.includes("hiddenCards.map"));
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

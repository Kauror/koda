import assert from "node:assert";
import {
  SITE_TEXT_DEFAULTS,
  defaultSiteTextMap,
  missingSiteTextDefaults,
  resolveSiteTexts,
} from "../src/lib/site-text-defaults";

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

console.log("[test] site-text checks:");

check("defaults return homepage hero text without database rows", () => {
  const texts = resolveSiteTexts([]);
  assert.equal(texts["homepage.hero.title"], defaultSiteTextMap()["homepage.hero.title"]);
  assert.ok(texts["homepage.hero.title"].length > 0);
});

check("database value overrides fallback for a known key", () => {
  const texts = resolveSiteTexts([{ key: "homepage.hero.title", valueEt: "Muudetud pealkiri" }]);
  assert.equal(texts["homepage.hero.title"], "Muudetud pealkiri");
});

check("legacy default database values are upgraded to current defaults", () => {
  const texts = resolveSiteTexts([
    { key: "homepage.hero.eyebrow", valueEt: "Allikapõhine ülevaade koja tööst" },
  ]);
  assert.equal(texts["homepage.hero.eyebrow"], "Ülevaade koja tegevustest");
});

check("unknown database keys are ignored by homepage resolver", () => {
  const texts = resolveSiteTexts([{ key: "other.key", valueEt: "Ei kuvata" }]);
  assert.equal(texts["homepage.hero.title"], defaultSiteTextMap()["homepage.hero.title"]);
});

check("seed helper selects only missing default keys", () => {
  const existing = SITE_TEXT_DEFAULTS.slice(0, 2).map((item) => item.key);
  const existingSet = new Set<string>(existing);
  const missing = missingSiteTextDefaults(existing);
  assert.equal(missing.length, SITE_TEXT_DEFAULTS.length - existing.length);
  assert.ok(!missing.some((item) => existingSet.has(item.key)));
});

check("seed helper does not mark edited existing keys as missing", () => {
  const allKeys = SITE_TEXT_DEFAULTS.map((item) => item.key);
  assert.equal(missingSiteTextDefaults(allKeys).length, 0);
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

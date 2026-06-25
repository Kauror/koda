/**
 * DB-free tests for the canonical public topic taxonomy and alias-normalized
 * topic filtering. Pure functions only.
 *
 *   npm run topics:test
 *
 * Includes a regression test that parses the authoritative taxonomy file
 * (data/taxonomy/koda_taxonomy_rules_v0_9_1.txt, section 2) and fails if
 * src/lib/topics.ts drifts from it.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PUBLIC_TOPIC_FILTERS,
  TOPICS,
  canonicalTopicId,
  canonicalTopicLabel,
  canonicalPublicValdkonnad,
  normalizeTopicLabel,
} from "../src/lib/topics";
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

const EXPECTED_PUBLIC = [
  "Ettevõtluskeskkond ja konkurentsivõime",
  "Euroopa Liidu poliitika ja õigus",
  "Maksud ja tasud",
  "Raamatupidamine, audit ja aruandlus",
  "Bürokraatia ja halduskoormus",
  "Tööjõud ja tööõigus",
  "Töötervishoid ja tööohutus",
  "Välistööjõud ja ränne",
  "Haridus, oskused ja järelkasv",
  "Teadus, arendus ja innovatsioon",
  "Pakend, jäätmed ja ringmajandus",
  "Tootjavastutus ja probleemtooted",
  "Kliima, kestlikkus ja rohenõuded",
  "Energia, elektrihind ja varustuskindlus",
  "Digi, andmed, AI ja küberturvalisus",
  "E-kaubandus ja tarbijakaitse",
  "Finants, krediit ja rahapesu nõuded",
  "Äriõigus, ühingud ja äriregister",
  "Intellektuaalomand ja autoriõigus",
  "Tootenõuded, ohutus ja turujärelevalve",
  "Planeeringud, load, ehitus ja kinnisvara",
  "Riigihanked ja avaliku sektoriga äri",
  "Toetused, riigiabi ja investeeringud",
  "Eksport, rahvusvahelistumine ja toll",
  "Alkohol, tubakas ja aktsiisikaubad",
  "Riigikaitse, julgeolek ja kriisikindlus",
];

const MUST_NOT_APPEAR = [
  "Õigusloome kvaliteet ja kaasamine",
  "Eksport",
  "Digi, andmed",
  "Energia",
  "Kliima",
  "Raamatupidamine",
  "Alkohol",
  "Pakend",
  "Planeeringud",
  "Planeeringud, load",
  "Riigikaitse",
  "Teadus",
  "Toetused",
  "Äriõigus",
];

const EMPTY: SearchQuery = { q: "", valdkond: [], tegevusala: [], tapsustus: [], type: [] };

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

console.log("[test] topic taxonomy checks:");

// ---- Test A: public labels match the canonical list exactly, in order ----
check("A1: public filter has exactly 26 topics", () =>
  assert.equal(PUBLIC_TOPIC_FILTERS.length, 26));
check("A2: public labels match canonical list in canonical order", () =>
  assert.deepEqual(PUBLIC_TOPIC_FILTERS.map((o) => o.name), EXPECTED_PUBLIC));
check("A3: public ids are unique", () =>
  assert.equal(new Set(PUBLIC_TOPIC_FILTERS.map((o) => o.slug)).size, 26));

// ---- Test B: invalid/legacy/internal labels must not appear publicly ----
for (const bad of MUST_NOT_APPEAR) {
  check(`B: "${bad}" is not a public filter label`, () =>
    assert.ok(!PUBLIC_TOPIC_FILTERS.some((o) => o.name === bad), `"${bad}" leaked into public filters`));
}

// ---- Test C: internal-only topic behaviour ----
check("C1: internal-only topic exists in taxonomy", () =>
  assert.ok(TOPICS.some((t) => t.id === "oigusloome_kvaliteet_kaasamine" && t.internalOnly)));
check("C2: internal-only topic resolves (admin/review can use it)", () =>
  assert.equal(canonicalTopicLabel("Õigusloome kvaliteet ja kaasamine"), "Õigusloome kvaliteet ja kaasamine"));
check("C3: internal-only topic is not a public filter option", () =>
  assert.ok(!PUBLIC_TOPIC_FILTERS.some((o) => o.slug === "oigusloome_kvaliteet_kaasamine")));
check("C4: internal-only topic is not counted/exposed in public display", () =>
  assert.deepEqual(
    canonicalPublicValdkonnad([{ slug: "oigusloome-kvaliteet-ja-kaasamine", name: "Õigusloome kvaliteet ja kaasamine" }]),
    []
  ));

// ---- Test D: Riigikaitse behaviour ----
check("D1: canonical Riigikaitse topic is a public filter", () =>
  assert.ok(PUBLIC_TOPIC_FILTERS.some((o) => o.name === "Riigikaitse, julgeolek ja kriisikindlus")));
check("D2: short alias 'Riigikaitse' is not a public filter label", () =>
  assert.ok(!PUBLIC_TOPIC_FILTERS.some((o) => o.name === "Riigikaitse")));
check("D3: 'Riigikaitse' alias normalizes to the canonical riigikaitse topic", () =>
  assert.equal(canonicalTopicId("Riigikaitse"), "riigikaitse_julgeolek_kriisikindlus"));
check("D4: canonical Riigikaitse topic is not internal-only", () =>
  assert.ok(!TOPICS.find((t) => t.id === "riigikaitse_julgeolek_kriisikindlus")!.internalOnly));

// ---- Test: Eksport behaviour (full canonical visible, short alias hidden) ----
check("Eksport: full canonical 'Eksport, rahvusvahelistumine ja toll' is public", () =>
  assert.ok(PUBLIC_TOPIC_FILTERS.some((o) => o.name === "Eksport, rahvusvahelistumine ja toll")));
check("Eksport: short alias 'Eksport' normalizes but is not a public label", () => {
  assert.equal(canonicalTopicId("Eksport"), "eksport_rahvusvahelistumine_toll");
  assert.ok(!PUBLIC_TOPIC_FILTERS.some((o) => o.name === "Eksport"));
});

// ---- canonicalTopicId resolves ids, labels, DB slugs and aliases ----
check("id resolves to itself", () =>
  assert.equal(canonicalTopicId("energia_elektrihind_varustuskindlus"), "energia_elektrihind_varustuskindlus"));
check("full label resolves", () =>
  assert.equal(canonicalTopicId("Energia, elektrihind ja varustuskindlus"), "energia_elektrihind_varustuskindlus"));
check("DB tag slug (slugify of full label) resolves", () =>
  assert.equal(canonicalTopicId("energia-elektrihind-ja-varustuskindlus"), "energia_elektrihind_varustuskindlus"));
check("alias label resolves", () =>
  assert.equal(canonicalTopicId("Energia"), "energia_elektrihind_varustuskindlus"));
check("alias DB slug resolves", () =>
  assert.equal(canonicalTopicId("digi-andmed"), "digi_andmed_ai_kuberturvalisus"));
check("unknown topic returns null", () =>
  assert.equal(canonicalTopicId("Mingi tundmatu teema"), null));

// ---- normalizeTopicLabel (importer) ----
check("normalizeTopicLabel folds alias to canonical label", () =>
  assert.deepEqual(normalizeTopicLabel("Energia"), { label: "Energia, elektrihind ja varustuskindlus", known: true }));
check("normalizeTopicLabel keeps unknown label, flagged not known", () =>
  assert.deepEqual(normalizeTopicLabel("Tundmatu"), { label: "Tundmatu", known: false }));

// ---- Test E: selecting a canonical topic finds rows with legacy alias tags ----
function matches(filterId: string, tag: { slug: string; name: string }): boolean {
  const q: SearchQuery = { ...EMPTY, valdkond: [filterId] };
  const c = cand({ valdkonnad: [tag] });
  return passesActiveFilters(q, scoreCandidate(c, q), c);
}
check("E1: canonical Energia filter matches a row tagged with alias 'Energia'", () =>
  assert.equal(matches("energia_elektrihind_varustuskindlus", { slug: "energia", name: "Energia" }), true));
check("E2: canonical Digi filter matches a row tagged with alias 'Digi, andmed'", () =>
  assert.equal(matches("digi_andmed_ai_kuberturvalisus", { slug: "digi-andmed", name: "Digi, andmed" }), true));
check("E3: canonical Riigikaitse filter matches a row tagged with alias 'Riigikaitse'", () =>
  assert.equal(matches("riigikaitse_julgeolek_kriisikindlus", { slug: "riigikaitse", name: "Riigikaitse" }), true));
check("E4: canonical filter matches a row already tagged with the canonical label", () =>
  assert.equal(
    matches("energia_elektrihind_varustuskindlus", {
      slug: "energia-elektrihind-ja-varustuskindlus",
      name: "Energia, elektrihind ja varustuskindlus",
    }),
    true
  ));
check("E5: canonical filter does NOT match an unrelated topic row", () =>
  assert.equal(matches("energia_elektrihind_varustuskindlus", { slug: "maksud-ja-tasud", name: "Maksud ja tasud" }), false));

// ---- canonicalPublicValdkonnad for display ----
check("display normalizes alias tag to canonical label", () =>
  assert.deepEqual(
    canonicalPublicValdkonnad([{ slug: "energia", name: "Energia" }]),
    [{ slug: "energia_elektrihind_varustuskindlus", name: "Energia, elektrihind ja varustuskindlus" }]
  ));
check("display de-duplicates alias + canonical of the same topic", () =>
  assert.deepEqual(
    canonicalPublicValdkonnad([
      { slug: "energia", name: "Energia" },
      { slug: "energia-elektrihind-ja-varustuskindlus", name: "Energia, elektrihind ja varustuskindlus" },
    ]),
    [{ slug: "energia_elektrihind_varustuskindlus", name: "Energia, elektrihind ja varustuskindlus" }]
  ));
check("display drops unknown topics", () =>
  assert.deepEqual(canonicalPublicValdkonnad([{ slug: "tundmatu", name: "Tundmatu" }]), []));

// ---- Taxonomy-file regression: topics.ts must match the authoritative file ----
function parseTaxonomyTopics(): { id: string; internalOnly: boolean; order: number }[] {
  const path = resolve(process.cwd(), "data", "taxonomy", "koda_taxonomy_rules_v0_9_1.txt");
  const text = readFileSync(path, "utf8");
  // Scope to section 2 ("AVALIKUD TEEMAD") up to section 3 ("PRIMARY JA SECONDARY").
  const start = text.indexOf("AVALIKUD TEEMAD");
  const end = text.indexOf("PRIMARY JA SECONDARY");
  assert.ok(start >= 0 && end > start, "could not locate section 2 in taxonomy file");
  const section = text.slice(start, end);
  const lines = section.split(/\r?\n/);
  const topics: { id: string; internalOnly: boolean; order: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^(\d+)\.\s+\S/);
    if (!head) continue;
    // Find the ID: line and any "Avalik filtris: ei" / internal-only marker
    // before the next numbered heading.
    let id: string | null = null;
    let internalOnly = false;
    for (let j = i + 1; j < lines.length && !/^\d+\.\s+\S/.test(lines[j]); j++) {
      const idm = lines[j].match(/^ID:\s*(\S+)/);
      if (idm) id = idm[1].trim();
      if (/Avalik filtris:\s*ei/i.test(lines[j]) || /internal-only/i.test(lines[j])) internalOnly = true;
    }
    if (id) topics.push({ id, internalOnly, order: parseInt(head[1], 10) });
  }
  return topics;
}

check("FILE: taxonomy file parses to 27 topics (26 public + 1 internal-only)", () => {
  const parsed = parseTaxonomyTopics();
  assert.equal(parsed.length, 27, `parsed ${parsed.length} topics`);
  assert.equal(parsed.filter((t) => !t.internalOnly).length, 26);
  assert.equal(parsed.filter((t) => t.internalOnly).length, 1);
});
check("FILE: topics.ts ids+order+visibility match the taxonomy file exactly", () => {
  const parsed = parseTaxonomyTopics().sort((a, b) => a.order - b.order);
  const mine = [...TOPICS].sort((a, b) => a.order - b.order);
  assert.deepEqual(
    mine.map((t) => ({ id: t.id, internalOnly: !!t.internalOnly })),
    parsed.map((t) => ({ id: t.id, internalOnly: t.internalOnly })),
    "topics.ts (id/internalOnly, in order) does not match the taxonomy file"
  );
});
check("FILE: internal-only topic in file is oigusloome_kvaliteet_kaasamine", () => {
  const internal = parseTaxonomyTopics().filter((t) => t.internalOnly);
  assert.deepEqual(internal.map((t) => t.id), ["oigusloome_kvaliteet_kaasamine"]);
});
check("FILE: every public file-id is a public filter, in the same order", () => {
  const filePublicIds = parseTaxonomyTopics()
    .filter((t) => !t.internalOnly)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);
  assert.deepEqual(PUBLIC_TOPIC_FILTERS.map((o) => o.slug), filePublicIds);
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

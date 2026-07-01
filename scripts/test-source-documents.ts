/**
 * Pure unit tests for opinion source-document (PDF) matching.
 *
 *   npm run source-docs:test
 *
 * DB-free: exercises src/lib/source-documents.ts on synthetic manifest + opinions.
 */
import assert from "node:assert";
import {
  foldText,
  isSupplementaryFilename,
  matchDocument,
  normalizeFilenameKey,
  parseOpinionFilename,
  pickPrimaryDoc,
  type OpinionRef,
} from "../src/lib/source-documents";

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

function op(p: Partial<OpinionRef> & { externalId: string }): OpinionRef {
  return {
    externalId: p.externalId,
    sourceFileName: p.sourceFileName ?? null,
    title: p.title ?? "",
    date: p.date ?? null,
    recipientNormalized: p.recipientNormalized ?? null,
    recipientRaw: p.recipientRaw ?? null,
  };
}

const FN = "2020-01-05 - Rahandusministeerium - Arvamus maksualase teabevahetuse seaduse eelnõu kohta.pdf";

console.log("[test] source documents (pure):");

check("parseOpinionFilename splits date / recipient / title", () => {
  const p = parseOpinionFilename(FN);
  assert.equal(p.date, "2020-01-05");
  assert.equal(p.recipient, "Rahandusministeerium");
  assert.equal(p.title, "Arvamus maksualase teabevahetuse seaduse eelnõu kohta");
  const none = parseOpinionFilename("juhuslik fail.pdf");
  assert.equal(none.date, null);
  assert.equal(none.title, "juhuslik fail");
});

check("foldText + normalizeFilenameKey fold Estonian and drop .pdf", () => {
  assert.equal(foldText("Jäätmeseadus ÕÖÜ"), "jaatmeseadus oou");
  assert.equal(normalizeFilenameKey("2020-01-05 - X - Ä.pdf"), normalizeFilenameKey("2020-01-05 - X - Ä"));
});

check("exact filename match → high", () => {
  const r = matchDocument(FN, [op({ externalId: "OPINION-1", sourceFileName: FN, title: "peaks olema ükskõik" })]);
  assert.equal(r.status, "matched");
  if (r.status === "matched") {
    assert.equal(r.method, "exact_filename");
    assert.equal(r.confidence, "high");
    assert.equal(r.opinion.externalId, "OPINION-1");
  }
});

check("two opinions with the same source filename → ambiguous (never guessed)", () => {
  const r = matchDocument(FN, [
    op({ externalId: "OPINION-1", sourceFileName: FN }),
    op({ externalId: "OPINION-2", sourceFileName: FN }),
  ]);
  assert.equal(r.status, "ambiguous");
});

check("parsed date+title match (no source filename) → high on exact title", () => {
  const r = matchDocument(FN, [
    op({ externalId: "OPINION-9", title: "Arvamus maksualase teabevahetuse seaduse eelnõu kohta", date: new Date("2020-01-05") }),
    op({ externalId: "OPINION-8", title: "Midagi hoopis muud", date: new Date("2020-01-05") }),
  ]);
  assert.equal(r.status, "matched");
  if (r.status === "matched") {
    assert.equal(r.method, "parsed_date_recipient_title");
    assert.equal(r.confidence, "high");
    assert.equal(r.opinion.externalId, "OPINION-9");
  }
});

check("parsed match disambiguates by recipient", () => {
  const title = "Arvamus maksualase teabevahetuse seaduse eelnõu kohta";
  const r = matchDocument(FN, [
    op({ externalId: "OPINION-A", title, date: new Date("2020-01-05"), recipientNormalized: "Siseministeerium" }),
    op({ externalId: "OPINION-B", title, date: new Date("2020-01-05"), recipientNormalized: "Rahandusministeerium" }),
  ]);
  assert.equal(r.status, "matched");
  if (r.status === "matched") assert.equal(r.opinion.externalId, "OPINION-B");
});

check("same date+title, no recipient signal → ambiguous", () => {
  const title = "Arvamus maksualase teabevahetuse seaduse eelnõu kohta";
  const r = matchDocument(FN, [
    op({ externalId: "OPINION-A", title, date: new Date("2020-01-05") }),
    op({ externalId: "OPINION-B", title, date: new Date("2020-01-05") }),
  ]);
  assert.equal(r.status, "ambiguous");
});

check("fuzzy match: close date + recipient + strong title overlap → low", () => {
  const r = matchDocument(FN, [
    op({
      externalId: "OPINION-F",
      title: "Maksualase teabevahetuse seaduse eelnõu arvamus",
      date: new Date("2020-01-06"),
      recipientNormalized: "Rahandusministeerium",
    }),
  ]);
  assert.equal(r.status, "matched");
  if (r.status === "matched") {
    assert.equal(r.method, "fuzzy");
    assert.equal(r.confidence, "low");
  }
});

check("no plausible candidate → unmatched", () => {
  const r = matchDocument(FN, [op({ externalId: "OPINION-Z", title: "Täiesti seosetu pealkiri", date: new Date("2019-05-05") })]);
  assert.equal(r.status, "unmatched");
});

check("isSupplementaryFilename flags Lisa / Seletuskiri", () => {
  assert.ok(isSupplementaryFilename("2023-09-13 - Kliimaministeerium - Liiklusseaduse eelnõu - Seletuskiri.pdf"));
  assert.ok(isSupplementaryFilename("2022-01-16 - Siseministeerium - Ühispöördumine - Lisa.pdf"));
  assert.ok(!isSupplementaryFilename(FN));
});

check("pickPrimaryDoc prefers a verified, non-supplementary PDF", () => {
  const docs = [
    { id: "OPINIONDOC-2", originalFilename: "2020-01-05 - X - Teema - Seletuskiri.pdf", fileVerified: true, isPrimary: true },
    { id: "OPINIONDOC-1", originalFilename: "2020-01-05 - X - Teema.pdf", fileVerified: true, isPrimary: true },
    { id: "OPINIONDOC-3", originalFilename: "2020-01-05 - X - Teema.pdf", fileVerified: false, isPrimary: true },
  ];
  assert.equal(pickPrimaryDoc(docs)!.id, "OPINIONDOC-1");
  assert.equal(pickPrimaryDoc([]), null);
});

console.log(`\n[test] source documents: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

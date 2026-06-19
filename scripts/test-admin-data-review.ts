import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  REQUIRED_BUNDLE_FILES,
  bundleFriendlyError,
  bundlePath,
  computeReviewProgress,
  type ContentBundleItem,
  filterContentItems,
  filterReviewCandidates,
  findContentItem,
  findReviewCandidate,
  missingBundleFiles,
  normalizeReviewCandidate,
  readBundleOverview,
  readContentItems,
  readReviewCandidates,
  type ReviewCandidate,
} from "../src/lib/admin-bundle";
import {
  BUNDLE_GENERATE_COMMAND,
  BUNDLE_VALIDATE_COMMAND,
  DECISIONS_NOT_APPLIED_NOTICE,
} from "../src/lib/admin-review-ui";

const readSource = (path: string) => readFileSync(path, "utf8");

let passed = 0;
let failed = 0;
let skipped = 0;

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

function skip(name: string, reason: string) {
  skipped++;
  console.log(`  skip- ${name} (${reason})`);
}

console.log("[test] admin data-review checks:");

// ---------------------------------------------------------------------------
// 1) Pure logic with synthetic fixtures — runs without any private data files.
//    This is the core parser/filter/pagination logic the admin tool depends on.
// ---------------------------------------------------------------------------

const syntheticCandidates: ReviewCandidate[] = [
  normalizeReviewCandidate({
    candidateId: "WEB000001",
    contentId: "WEB000001",
    title: "Maksupoliitika muudatused ettevõtjatele",
    url: "https://www.koda.ee/et/uudised/maksud",
    confidence: "high",
    recommendedAction: "approve",
    currentValdkond: ["maksud-tasud-ja-aruandlus"],
    suggestedValdkond: ["maksud-tasud-ja-aruandlus", "ettevotluskeskkond"],
    currentTegevusala: [],
    suggestedTegevusala: ["toostus-ja-tootmine"],
    ruleSource: "topic-rule",
    evidence: "maksumäär, käibemaks",
  }),
  normalizeReviewCandidate({
    candidateId: "WEB000002",
    contentId: "WEB000002",
    title: "Keskkonnaload ja jäätmekäitlus",
    url: "https://www.koda.ee/et/uudised/keskkond",
    confidence: "medium",
    recommendedAction: "needs_review",
    currentValdkond: ["keskkond-kliima-ja-jaatmed"],
    suggestedValdkond: ["keskkond-kliima-ja-jaatmed"],
    currentTegevusala: ["energia-ja-ressursimahukas-tegevus"],
    suggestedTegevusala: ["energia-ja-ressursimahukas-tegevus"],
    ruleSource: "keyword-rule",
    evidence: "jäätmeseadus",
  }),
  // No explicit ids: normalizeReviewCandidate must still produce a stable id.
  normalizeReviewCandidate({
    title: "Ilma ID-ta kandidaat",
    sourceRow: { rowNumber: "42" },
  }),
];

check("normalizeReviewCandidate assigns stable candidate IDs (incl. fallback)", () => {
  assert.equal(syntheticCandidates[0].candidateId, "WEB000001");
  // Falls back to sourceRow.rowNumber when no candidateId/contentId is present.
  assert.equal(syntheticCandidates[2].candidateId, "42");
  assert.ok(syntheticCandidates.every((row) => row.candidateId.length > 0));
  // Re-normalizing a row with no identifiers at all yields a deterministic hash id.
  const a = normalizeReviewCandidate({ title: "X" });
  const b = normalizeReviewCandidate({ title: "X" });
  assert.equal(a.candidateId, b.candidateId);
  assert.ok(a.candidateId.startsWith("candidate-"));
});

check("filterReviewCandidates filters by decision, query and tags + paginates", () => {
  const decisions = new Map([[syntheticCandidates[0].candidateId, "approved"]]);

  const approved = filterReviewCandidates(syntheticCandidates, { decision: "approved" }, decisions);
  assert.equal(approved.pagination.total, 1);
  assert.equal(approved.rows[0].candidateId, "WEB000001");

  const undecided = filterReviewCandidates(syntheticCandidates, { decision: "undecided" }, decisions);
  assert.equal(undecided.pagination.total, 2);

  const byText = filterReviewCandidates(syntheticCandidates, { q: "keskkonna" }, new Map());
  assert.equal(byText.pagination.total, 1);
  assert.equal(byText.rows[0].candidateId, "WEB000002");

  const byTag = filterReviewCandidates(
    syntheticCandidates,
    { suggestedValdkond: "ettevotluskeskkond" },
    new Map(),
  );
  assert.equal(byTag.pagination.total, 1);
  assert.equal(byTag.rows[0].candidateId, "WEB000001");

  const paged = filterReviewCandidates(syntheticCandidates, { pageSize: 2, page: 2 }, new Map());
  assert.equal(paged.pagination.pages, 2);
  assert.equal(paged.pagination.page, 2);
  assert.equal(paged.rows.length, 1);
});

check("review list defaults to undecided and sorts undecided first under 'all'", () => {
  const decisions = new Map([["WEB000001", "approved"]]);

  // Default (undecided) filter hides already-decided candidates.
  const undecidedOnly = filterReviewCandidates(syntheticCandidates, { decision: "undecided" }, decisions);
  assert.equal(undecidedOnly.pagination.total, 2);
  assert.ok(undecidedOnly.rows.every((row) => !decisions.has(row.candidateId)));

  // "all" keeps every row but undecided ones must rank ahead of decided ones.
  const all = filterReviewCandidates(syntheticCandidates, { decision: "all" }, decisions);
  assert.equal(all.pagination.total, 3);
  const decidedFlags = all.rows.map((row) => decisions.has(row.candidateId));
  const firstDecided = decidedFlags.indexOf(true);
  const lastUndecided = decidedFlags.lastIndexOf(false);
  assert.ok(firstDecided > lastUndecided, "all undecided rows must come before decided rows");
});

check("computeReviewProgress counts decisions and percentage", () => {
  const ids = ["a", "b", "c", "d"];
  const decisions = new Map([
    ["a", "approved"],
    ["b", "rejected"],
    ["c", "needs_review"],
  ]);
  const progress = computeReviewProgress(ids, decisions);
  assert.equal(progress.total, 4);
  assert.equal(progress.approved, 1);
  assert.equal(progress.rejected, 1);
  assert.equal(progress.needsReview, 1);
  assert.equal(progress.decided, 3);
  assert.equal(progress.undecided, 1);
  assert.equal(progress.progressPercent, 75);

  // Decisions for candidates not in the current bundle are ignored.
  const stray = computeReviewProgress(["a"], new Map([["zzz", "approved"]]));
  assert.equal(stray.decided, 0);
  assert.equal(stray.undecided, 1);

  const empty = computeReviewProgress([], new Map());
  assert.equal(empty.total, 0);
  assert.equal(empty.progressPercent, 0);
});

// ---------------------------------------------------------------------------
// 1b) Admin UI wiring — assert the page sources expose the required affordances
//     (links, warnings, export buttons, friendly missing-bundle commands).
// ---------------------------------------------------------------------------

check("admin landing page links to all major admin tools", () => {
  const src = readSource("src/app/admin/(dash)/page.tsx");
  for (const href of [
    "/admin/site-texts",
    "/admin/data-bundle",
    "/admin/data-review",
    "/admin/content-items",
    "/admin/taxonomy",
  ]) {
    assert.ok(src.includes(href), `landing page is missing a link to ${href}`);
  }
});

check("data-review page shows progress, export buttons and the not-applied warning", () => {
  const src = readSource("src/app/admin/(dash)/data-review/page.tsx");
  assert.ok(src.includes("/api/admin/data-review/export?format=csv"));
  assert.ok(src.includes("/api/admin/data-review/export?format=jsonl"));
  assert.ok(src.includes("DECISIONS_NOT_APPLIED_NOTICE"));
  assert.ok(src.includes("ReviewProgressCard"));
  assert.ok(src.includes("DEFAULT_DECISION_FILTER"));
});

check("data-review detail page shows the not-applied warning", () => {
  const src = readSource("src/app/admin/(dash)/data-review/[id]/page.tsx");
  assert.ok(src.includes("DECISIONS_NOT_APPLIED_NOTICE"));
});

check("not-applied notice copy is explicit and path-free", () => {
  assert.ok(DECISIONS_NOT_APPLIED_NOTICE.toLowerCase().includes("ei muuda"));
  assert.ok(DECISIONS_NOT_APPLIED_NOTICE.toLowerCase().includes("avalik"));
});

check("missing-bundle notice exposes generate + validate commands without leaking paths", () => {
  const src = readSource("src/app/admin/(dash)/_components/MissingBundleNotice.tsx");
  assert.ok(src.includes("BUNDLE_GENERATE_COMMAND"));
  assert.ok(src.includes("BUNDLE_VALIDATE_COMMAND"));
  assert.equal(
    BUNDLE_GENERATE_COMMAND,
    "npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1",
  );
  assert.equal(
    BUNDLE_VALIDATE_COMMAND,
    "npm run data:validate-bundle -- --bundle=data/import/bundles/koda_data_bundle_v1",
  );
  for (const command of [BUNDLE_GENERATE_COMMAND, BUNDLE_VALIDATE_COMMAND]) {
    assert.ok(!command.includes("C:\\"));
    assert.ok(!command.includes("/Users/"));
  }
});

check("admin area stays protected: (dash) layout guards + admin APIs require admin", () => {
  const layout = readSource("src/app/admin/(dash)/layout.tsx");
  assert.ok(layout.includes("isAdmin"), "(dash) layout must check isAdmin");
  assert.ok(layout.includes('redirect("/admin/login")'), "(dash) layout must redirect unauthenticated users");
  for (const route of [
    "src/app/api/admin/data-review/[id]/route.ts",
    "src/app/api/admin/data-review/export/route.ts",
    "src/app/api/admin/site-texts/route.ts",
  ]) {
    assert.ok(readSource(route).includes("requireAdmin"), `${route} must call requireAdmin`);
  }
});

check("bundle-dependent admin pages render the friendly missing-bundle notice", () => {
  for (const page of [
    "src/app/admin/(dash)/data-bundle/page.tsx",
    "src/app/admin/(dash)/data-review/page.tsx",
    "src/app/admin/(dash)/content-items/page.tsx",
    "src/app/admin/(dash)/taxonomy/page.tsx",
  ]) {
    assert.ok(readSource(page).includes("MissingBundleNotice"), `${page} is missing the friendly notice`);
  }
});

const syntheticContent: ContentBundleItem[] = [
  {
    externalId: "WEB000001",
    title: "Maksupoliitika muudatused ettevõtjatele",
    canonicalUrl: "https://www.koda.ee/et/uudised/maksud",
    sourceDataset: "web",
    sourceLayer: "koda_news",
    sourceTypeDetail: "meie_uudis",
    isPublic: true,
    needsHumanReview: false,
    valdkonnad: ["maksud-tasud-ja-aruandlus"],
    tegevusalad: [],
    tapsustused: [],
  },
  {
    externalId: "OPINION-0001",
    title: "Koja arvamus eelnõule",
    sourceDataset: "opinions",
    sourceLayer: "opinion_file",
    sourceTypeDetail: "opinion_file",
    isPublic: false,
    needsHumanReview: true,
    valdkonnad: ["maksud-tasud-ja-aruandlus"],
    tegevusalad: [],
    tapsustused: [],
  },
  {
    externalId: "AR-2014-001",
    title: "Aastaaruande kontekst",
    sourceDataset: "annual_reports",
    sourceLayer: "annual_report",
    isPublic: false,
    needsHumanReview: false,
    valdkonnad: [],
    tegevusalad: [],
    tapsustused: [],
  },
];

check("filterContentItems filters by dataset/visibility and does not mutate input", () => {
  const before = JSON.stringify(syntheticContent);

  const web = filterContentItems(syntheticContent, { sourceDataset: "web" });
  assert.equal(web.pagination.total, 1);
  assert.ok(web.rows.every((row) => row.sourceDataset === "web"));

  const publicOnly = filterContentItems(syntheticContent, { isPublic: "true" });
  assert.equal(publicOnly.pagination.total, 1);
  assert.equal(publicOnly.rows[0].externalId, "WEB000001");

  const needsReview = filterContentItems(syntheticContent, { needsHumanReview: "true" });
  assert.equal(needsReview.pagination.total, 1);
  assert.equal(needsReview.rows[0].externalId, "OPINION-0001");

  const byText = filterContentItems(syntheticContent, { q: "aastaaruande" });
  assert.equal(byText.pagination.total, 1);

  // The reader/filter layer is read-only: it must never mutate the source rows.
  assert.equal(JSON.stringify(syntheticContent), before);
});

// ---------------------------------------------------------------------------
// 2) Missing-bundle behaviour — friendly, path-free errors (no private data).
// ---------------------------------------------------------------------------

check("missing bundle files report a friendly error without leaking paths", () => {
  // When the real bundle is present this temporarily hides one file.
  const manifest = bundlePath("manifest.json");
  let tmpDir: string | null = null;
  let movedTo: string | null = null;
  if (existsSync(manifest)) {
    tmpDir = mkdtempSync(join(tmpdir(), "koda-bundle-test-"));
    movedTo = join(tmpDir, "manifest.json");
    renameSync(manifest, movedTo);
  }
  try {
    const missing = missingBundleFiles();
    assert.ok(missing.includes("manifest.json"));
    const message = bundleFriendlyError(missing);
    assert.ok(message.includes("manifest.json"));
    assert.ok(!message.includes("C:\\"));
    assert.ok(!message.includes("/Users/"));
    assert.ok(!message.includes(process.cwd()));

    const overview = readBundleOverview();
    assert.equal(overview.ok, false);
    if (!overview.ok) {
      assert.ok(overview.error.includes("manifest.json"));
      assert.ok(!overview.error.includes("C:\\"));
    }
  } finally {
    if (movedTo) renameSync(movedTo, manifest);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3) Filesystem reader behaviour with a synthetic bundle. Only runs on a clean
//    checkout (no real bundle present) so it never clobbers private data.
// ---------------------------------------------------------------------------

const cleanCheckout = missingBundleFiles().length === REQUIRED_BUNDLE_FILES.length;

if (cleanCheckout) {
  const bundleDir = bundlePath();
  const contentFile = bundlePath("content_items.jsonl");
  const minimal: Record<string, string> = {
    "manifest.json": JSON.stringify({ row_counts: { content_items_rows: 2 }, validation_status: "passed" }),
    "qa_report.json": JSON.stringify({}),
    "achievement_enrichment.jsonl": "",
    "taxonomy.json": JSON.stringify({ categories: [] }),
    "taxonomy_rules.json": JSON.stringify({}),
    "review_candidates.jsonl": [
      JSON.stringify({ candidateId: "WEB000001", contentId: "WEB000001", title: "Maks" }),
    ].join("\n"),
    "tag_dictionary.json": JSON.stringify({}),
  };
  const validContent = [
    JSON.stringify({ externalId: "WEB000001", title: "Maks", sourceDataset: "web" }),
    JSON.stringify({ externalId: "OPINION-0001", title: "Arvamus", sourceDataset: "opinions" }),
  ].join("\n");

  try {
    mkdirSync(bundleDir, { recursive: true });
    for (const [file, body] of Object.entries(minimal)) {
      mkdirSync(dirname(bundlePath(file)), { recursive: true });
      writeFileSync(bundlePath(file), body, "utf8");
    }

    check("malformed JSONL yields a friendly error instead of crashing", () => {
      writeFileSync(contentFile, "{not valid json\n", "utf8");
      const result = readContentItems();
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error.length > 0);
        assert.ok(!result.error.includes("C:\\"));
        assert.ok(!result.error.includes(process.cwd()));
      }
    });

    check("synthetic bundle reads back and joins candidate to content row", () => {
      writeFileSync(contentFile, validContent, "utf8");

      const content = readContentItems();
      assert.equal(content.ok, true);
      if (content.ok) {
        assert.equal(content.data.length, 2);
        assert.ok(content.data.some((row) => row.externalId === "WEB000001"));
      }

      const candidates = readReviewCandidates();
      assert.equal(candidates.ok, true);
      if (candidates.ok) assert.equal(candidates.data.length, 1);

      const candidate = findReviewCandidate("WEB000001");
      assert.equal(candidate.ok, true);
      if (candidate.ok) assert.equal(candidate.data?.candidateId, "WEB000001");

      const joined = findContentItem("WEB000001");
      assert.equal(joined.ok, true);
      if (joined.ok) assert.equal(joined.data?.externalId, "WEB000001");
    });
  } finally {
    rmSync(join(process.cwd(), "data/import/bundles"), { recursive: true, force: true });
  }
} else {
  // A real (private) bundle is present: validate its production invariants.
  check("real bundle exposes the expected generated files and counts", () => {
    const overview = readBundleOverview();
    assert.equal(overview.ok, true);
    if (!overview.ok) return;
    const counts = overview.data.manifest.row_counts as Record<string, number>;
    assert.equal(counts.content_items_rows, 4933);
    assert.equal(counts.achievement_enrichment_rows, 76);
    assert.equal(counts.review_candidates_jsonl_rows, 1159);

    const content = readContentItems();
    assert.equal(content.ok, true);
    if (content.ok) assert.equal(content.data.length, 4933);

    const candidates = readReviewCandidates();
    assert.equal(candidates.ok, true);
    if (candidates.ok) assert.equal(candidates.data.length, 1159);
  });
  skip("synthetic filesystem reader test", "real bundle present — covered by real-bundle test");
}

console.log(`\n[test] ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) process.exitCode = 1;

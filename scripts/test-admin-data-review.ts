import assert from "node:assert";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bundlePath,
  filterContentItems,
  filterReviewCandidates,
  findReviewCandidate,
  missingBundleFiles,
  readBundleOverview,
  readContentItems,
  readReviewCandidates,
} from "../src/lib/admin-bundle";

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

console.log("[test] admin data-review checks:");

check("bundle reader sees the expected generated files and counts", () => {
  const overview = readBundleOverview();
  assert.equal(overview.ok, true);
  if (!overview.ok) return;
  const counts = overview.data.manifest.row_counts as Record<string, number>;
  assert.equal(counts.content_items_rows, 4933);
  assert.equal(counts.web_index_content_rows, 3937);
  assert.equal(counts.opinion_support_rows, 759);
  assert.equal(counts.annual_context_rows, 237);
  assert.equal(counts.achievement_enrichment_rows, 76);
  assert.equal(counts.review_candidates_jsonl_rows, 1159);
});

check("review candidates receive stable candidate IDs and paginate/filter", () => {
  const candidates = readReviewCandidates();
  assert.equal(candidates.ok, true);
  if (!candidates.ok) return;
  assert.equal(candidates.data.length, 1159);
  assert.ok(candidates.data.every((row) => row.candidateId));

  const decisions = new Map([[candidates.data[0].candidateId, "approved"]]);
  const approved = filterReviewCandidates(candidates.data, { decision: "approved" }, decisions);
  assert.equal(approved.pagination.total, 1);
  assert.equal(approved.rows[0].candidateId, candidates.data[0].candidateId);

  const byTitle = filterReviewCandidates(candidates.data, { q: candidates.data[0].title?.slice(0, 12) }, new Map());
  assert.ok(byTitle.pagination.total >= 1);
});

check("candidate lookup can join back to its content row without applying changes", () => {
  const candidate = findReviewCandidate("WEB000001");
  assert.equal(candidate.ok, true);
  if (!candidate.ok) return;
  assert.equal(candidate.data?.candidateId, "WEB000001");

  const content = readContentItems();
  assert.equal(content.ok, true);
  if (!content.ok) return;
  assert.equal(content.data.length, 4933);
  assert.ok(content.data.some((row) => row.externalId === "WEB000001"));
});

check("content browser filters without mutating content rows", () => {
  const content = readContentItems();
  assert.equal(content.ok, true);
  if (!content.ok) return;
  const before = JSON.stringify(content.data[0]);
  const result = filterContentItems(content.data, { sourceDataset: "web", pageSize: 5 });
  assert.equal(result.rows.length, 5);
  assert.ok(result.rows.every((row) => row.sourceDataset === "web"));
  assert.equal(JSON.stringify(content.data[0]), before);
});

check("missing bundle files return a friendly error without exposing paths", () => {
  const manifest = bundlePath("manifest.json");
  if (!existsSync(manifest)) return;
  const tmpDir = mkdtempSync(join(tmpdir(), "koda-bundle-test-"));
  const tmp = join(tmpDir, "manifest.json");
  renameSync(manifest, tmp);
  try {
    const missing = missingBundleFiles();
    assert.ok(missing.includes("manifest.json"));
    const overview = readBundleOverview();
    assert.equal(overview.ok, false);
    if (!overview.ok) {
      assert.ok(overview.error.includes("manifest.json"));
      assert.ok(!overview.error.includes("C:\\"));
      assert.ok(!overview.error.includes("/Users/"));
    }
  } finally {
    renameSync(tmp, manifest);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log(`\n[test] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

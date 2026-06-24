/**
 * Koda.ee ingestion tests.
 *
 *   npm run ingest:test
 *
 * Pure tests run everywhere. A PGlite-backed integration block exercises the
 * real staging writes (dedup, dry-run vs staging, ContentItem never mutated)
 * without any server or network — it skips gracefully if PGlite is unavailable.
 */
import assert from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { contentHash } from "../src/lib/hash";
import { canonicalizeKodaUrl, isAllowedKodaUrl, isLikelyArticlePath } from "../src/lib/ingestion/url";
import { detectSourceTypeFromUrl, extractArticleLinks, parseDateText, parseKodaPage } from "../src/lib/ingestion/parse";
import { classifyParsedPage } from "../src/lib/ingestion/classify";
import {
  applyActionToCounts,
  emptyCounts,
  resolveStagingDecision,
  runIngestion,
} from "../src/lib/ingestion/koda-ee";
import { type StagingViewRow, selectStagingItems } from "../src/lib/ingestion/staging-view";

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

console.log("[test] ingestion checks:");

// ---- URL allowlist + normalization ----
check("canonicalizeKodaUrl normalizes Koda.ee /et/ URLs", () => {
  assert.equal(
    canonicalizeKodaUrl("https://www.koda.ee/et/uudised/lugu-1/?utm=x#frag"),
    "https://www.koda.ee/et/uudised/lugu-1",
  );
  assert.equal(canonicalizeKodaUrl("/et/meie-arvamus/seisukoht-2", "https://koda.ee/et/x"), "https://www.koda.ee/et/meie-arvamus/seisukoht-2");
});

check("external and non-/et/ URLs are rejected", () => {
  assert.equal(canonicalizeKodaUrl("https://evil.com/et/x"), null);
  assert.equal(canonicalizeKodaUrl("https://www.koda.ee/en/something"), null);
  assert.equal(canonicalizeKodaUrl("ftp://www.koda.ee/et/x"), null);
  assert.equal(isAllowedKodaUrl("https://evil.com"), false);
  assert.equal(isAllowedKodaUrl("https://www.koda.ee/et/x"), true);
  assert.equal(isLikelyArticlePath("https://www.koda.ee/et/uudised"), false); // section root
  assert.equal(isLikelyArticlePath("https://www.koda.ee/et/uudised/lugu"), true);
});

check("extractArticleLinks dedupes, drops external + section-root links", () => {
  const html =
    '<a href="/et/uudised/lugu-1">a</a><a href="/et/uudised/lugu-1">dup</a>' +
    '<a href="https://evil.com/et/x">ext</a><a href="/et/uudised">root</a>';
  const links = extractArticleLinks(html, "https://www.koda.ee/et/uudised/meie_uudised");
  assert.deepEqual(links, ["https://www.koda.ee/et/uudised/lugu-1"]);
});

// ---- Parser resilience ----
check("parseKodaPage extracts title/body/type from minimal HTML", () => {
  const p = parseKodaPage(
    "<html><body><h1>Uudise pealkiri</h1><article>See on piisavalt pikk sisu lõik ettevõtjatele, et seda saaks pidada päris kehatekstiks ja mitte ainult lühikeseks vihjeks.</article></body></html>",
    "https://www.koda.ee/et/uudised/lugu",
  );
  assert.equal(p.title, "Uudise pealkiri");
  assert.equal(p.detectedSourceType, "news");
  assert.ok(p.bodyText && p.bodyText.includes("piisavalt pikk sisu"));
});

check("parseKodaPage handles missing title/body/date and bad HTML without crashing", () => {
  const empty = parseKodaPage("<html><body></body></html>", "https://www.koda.ee/et/uudised/x");
  assert.equal(empty.title, null);
  assert.equal(empty.bodyText, null);
  assert.equal(empty.publishedAt, null);
  assert.doesNotThrow(() => parseKodaPage("", "https://www.koda.ee/et/x"));
  assert.doesNotThrow(() => parseKodaPage("<broken<<<>", "https://www.koda.ee/et/x"));
});

check("parseDateText handles ISO/dotted/verbal and rejects junk", () => {
  assert.equal(parseDateText("2025-10-16")?.getUTCFullYear(), 2025);
  assert.equal(parseDateText("16.10.2025")?.getUTCFullYear(), 2025);
  assert.equal(parseDateText("16. oktoober 2025")?.getUTCMonth(), 9);
  assert.equal(parseDateText("not a date"), null);
  assert.equal(parseDateText(""), null);
  assert.equal(parseDateText(null), null);
});

check("detectSourceTypeFromUrl maps known sections", () => {
  assert.equal(detectSourceTypeFromUrl("https://www.koda.ee/et/uudised/x"), "news");
  assert.equal(detectSourceTypeFromUrl("https://www.koda.ee/et/meie-arvamus/x"), "opinion");
  assert.equal(detectSourceTypeFromUrl("https://www.koda.ee/et/meie-moju/meie-toovoidud/x"), "achievement");
  assert.equal(detectSourceTypeFromUrl("https://www.koda.ee/et/midagi-muud/x"), "other");
});

// ---- Classification ----
check("classifyParsedPage does not crash on empty text", () => {
  const c = classifyParsedPage({ title: null, summary: null, bodyText: null, detectedSourceType: "other" });
  assert.deepEqual(c.detectedLaws, []);
  assert.equal(c.classificationConfidence, "low");
});

check("classifyParsedPage detects laws in crawled content text", () => {
  const p = parseKodaPage(
    "<h1>Jäätmeseaduse muudatus</h1><article>Koda esitas arvamuse jäätmeseaduse eelnõu kohta pikalt ja põhjalikult.</article>",
    "https://www.koda.ee/et/meie-arvamus/jaatmeseadus",
  );
  const c = classifyParsedPage(p);
  assert.ok(c.detectedLaws.some((law) => law.slug === "jaatmeseadus"));
  assert.ok(c.detectedValdkonnad.includes("keskkond-kliima-ja-jaatmed"));
});

// ---- Dedup / change-detection decision + counts ----
check("resolveStagingDecision: unchanged skips, changed re-reviews, new/matched classified", () => {
  const h1 = contentHash("T", "body a");
  const h2 = contentHash("T", "body b");
  assert.equal(
    resolveStagingDecision({ existing: { contentHash: h1, reviewStatus: "approved" }, matchedContentItemId: null, newContentHash: h1, detectedSourceType: "news" }).action,
    "skip",
  );
  const changed = resolveStagingDecision({ existing: { contentHash: h1, reviewStatus: "approved" }, matchedContentItemId: null, newContentHash: h2, detectedSourceType: "news" });
  assert.equal(changed.action, "update");
  assert.equal(changed.reviewStatus, "needs_review");
  const matched = resolveStagingDecision({ existing: null, matchedContentItemId: "ci_1", newContentHash: h1, detectedSourceType: "news" });
  assert.deepEqual([matched.action, matched.reviewStatus, matched.matchedContentItemId], ["create", "matched_existing", "ci_1"]);
  assert.equal(resolveStagingDecision({ existing: null, matchedContentItemId: null, newContentHash: h1, detectedSourceType: "other" }).reviewStatus, "needs_review");
  assert.equal(resolveStagingDecision({ existing: null, matchedContentItemId: null, newContentHash: h1, detectedSourceType: "news" }).reviewStatus, "new");
});

check("applyActionToCounts tallies create/update/skip", () => {
  const c = emptyCounts();
  applyActionToCounts(c, "create");
  applyActionToCounts(c, "create");
  applyActionToCounts(c, "update");
  applyActionToCounts(c, "skip");
  assert.equal(c.itemsCreated, 2);
  assert.equal(c.itemsUpdated, 1);
  assert.equal(c.itemsSkipped, 1);
});

// ---- Admin staging view ordering/filtering ----
check("selectStagingItems sorts needs_review/new first, then newest", () => {
  const base = { canonicalUrl: "u", createdAt: new Date("2020-01-01"), detectedSourceType: "news", detectedLaws: [], detectedValdkonnad: [], matchedContentItemId: null, title: "t" };
  const rows: StagingViewRow[] = [
    { ...base, id: "approved-2020", reviewStatus: "approved", publishedAt: new Date("2020-01-01") },
    { ...base, id: "needs-2019", reviewStatus: "needs_review", publishedAt: new Date("2019-01-01") },
    { ...base, id: "new-2025", reviewStatus: "new", publishedAt: new Date("2025-01-01") },
  ];
  assert.deepEqual(selectStagingItems(rows, {}).map((r) => r.id), ["needs-2019", "new-2025", "approved-2020"]);
});

check("selectStagingItems filters by law, valdkond, year and query", () => {
  const base = { canonicalUrl: "https://www.koda.ee/et/x", createdAt: new Date(), reviewStatus: "new", detectedSourceType: "news", matchedContentItemId: null };
  const rows: StagingViewRow[] = [
    { ...base, id: "1", title: "Jäätmed", publishedAt: new Date("2025-03-01"), detectedLaws: [{ slug: "jaatmeseadus" }], detectedValdkonnad: ["keskkond-kliima-ja-jaatmed"] },
    { ...base, id: "2", title: "Maksud", publishedAt: new Date("2024-03-01"), detectedLaws: [{ slug: "kaibemaksuseadus" }], detectedValdkonnad: ["maksud-tasud-ja-aruandlus"] },
  ];
  assert.deepEqual(selectStagingItems(rows, { law: "jaatmeseadus" }).map((r) => r.id), ["1"]);
  assert.deepEqual(selectStagingItems(rows, { valdkond: "maksud-tasud-ja-aruandlus" }).map((r) => r.id), ["2"]);
  assert.deepEqual(selectStagingItems(rows, { year: 2025 }).map((r) => r.id), ["1"]);
  assert.deepEqual(selectStagingItems(rows, { q: "maksud" }).map((r) => r.id), ["2"]);
});

// ---------------------------------------------------------------------------
// PGlite integration: real staging writes, dedup, ContentItem never mutated.
// ---------------------------------------------------------------------------
async function integration() {
  const URL1 = "https://www.koda.ee/et/uudised/lugu-1";
  const URL2 = "https://www.koda.ee/et/meie-arvamus/jaatmeseadus-arvamus";
  const URL3 = "https://www.koda.ee/et/uudised/seotud-lugu";
  const htmlFor = (title: string, body: string) => `<html><body><h1>${title}</h1><time datetime="2025-10-16">16.10.2025</time><article>${body}</article></body></html>`;
  let pages: Record<string, string> = {
    [URL1]: htmlFor("Esimene lugu", "Pikk sisu ettevõtjatele, esimene versioon: piisavalt pikk kehatekst, et ületada parseri 80-tähemärgilist lävendit ja luua stabiilne sisu-räsi."),
    [URL2]: htmlFor("Jäätmeseaduse arvamus", "Koda esitas arvamuse jäätmeseaduse eelnõu kohta, pikk ja põhjalik tekst ettevõtjatele, mis ületab kindlalt parseri kehateksti lävendi."),
  };
  const fetcher = async (url: string) => ({ ok: !!pages[url], status: pages[url] ? 200 : 404, html: pages[url] ?? null });
  const discoverFixed = (urls: string[]) => async () => urls;

  let dir: string | null = null;
  let close: (() => Promise<void>) | null = null;
  let prisma: import("@prisma/client").PrismaClient;
  try {
    const { PGlite } = await import("@electric-sql/pglite");
    const { PrismaPGlite } = await import("pglite-prisma-adapter");
    const { PrismaClient } = await import("@prisma/client");
    dir = mkdtempSync(join(tmpdir(), "koda-ingest-it-"));
    const client = new PGlite(dir);
    await client.waitReady;
    const migrationsDir = resolve(process.cwd(), "prisma", "migrations");
    const names = readdirSync(migrationsDir).filter((e) => statSync(join(migrationsDir, e)).isDirectory()).sort();
    for (const name of names) await client.exec(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma = new PrismaClient({ adapter: new PrismaPGlite(client) as any });
    close = async () => {
      await prisma.$disconnect().catch(() => {});
      await client.close().catch(() => {});
    };
  } catch (error) {
    skipped++;
    console.log(`  skip- PGlite integration (unavailable: ${(error as Error).message})`);
    return;
  }

  // Probe the Prisma query engine. On hosts where it can't load (e.g. this
  // engine-incompatible Windows dev box) skip the DB integration gracefully —
  // it runs in CI / Linux / production where the native engine is present.
  try {
    await prisma.ingestionRun.count();
  } catch (error) {
    skipped++;
    console.log(`  skip- PGlite integration (Prisma query engine unavailable on this host: ${(error as Error).message.split("\n")[0]})`);
    if (close) await close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    return;
  }

  try {
    await check2("dry-run writes no IngestionRun and no staging rows", async () => {
      const summary = await runIngestion(prisma, { mode: "dry_run", discover: discoverFixed([URL1, URL2]), fetcher });
      assert.equal(summary.runId, null);
      assert.equal(summary.itemsCreated, 2);
      assert.equal(await prisma.ingestionRun.count(), 0);
      assert.equal(await prisma.ingestionStagingItem.count(), 0);
      assert.equal(await prisma.contentItem.count(), 0);
    });

    await check2("staging run creates run + staging rows; ContentItem untouched", async () => {
      const summary = await runIngestion(prisma, { mode: "staging", discover: discoverFixed([URL1, URL2]), fetcher });
      assert.ok(summary.runId);
      assert.equal(summary.itemsCreated, 2);
      assert.equal(summary.pagesFetched, 2);
      assert.equal(await prisma.ingestionRun.count(), 1);
      assert.equal(await prisma.ingestionStagingItem.count(), 2);
      assert.equal(await prisma.contentItem.count(), 0);
      const law = await prisma.ingestionStagingItem.findUnique({ where: { urlHash: (await import("../src/lib/hash")).urlHash(URL2) } });
      assert.ok(JSON.stringify(law?.detectedLaws).includes("jaatmeseadus"));
      assert.notEqual(law?.reviewStatus, "approved"); // never auto-approved/public
    });

    await check2("re-running unchanged content skips (dedup), no new staging rows", async () => {
      const summary = await runIngestion(prisma, { mode: "staging", discover: discoverFixed([URL1, URL2]), fetcher });
      assert.equal(summary.itemsSkipped, 2);
      assert.equal(summary.itemsCreated, 0);
      assert.equal(await prisma.ingestionStagingItem.count(), 2);
    });

    await check2("changed content updates the staging row and marks needs_review", async () => {
      pages = { ...pages, [URL1]: htmlFor("Esimene lugu", "Hoopis uus sisu, teine versioon: muudetud kehatekst, mis on samuti üle 80 tähemärgi pikk, nii et sisu-räsi kindlasti muutub.") };
      const summary = await runIngestion(prisma, { mode: "staging", discover: discoverFixed([URL1]), fetcher });
      assert.equal(summary.itemsUpdated, 1);
      assert.equal(await prisma.ingestionStagingItem.count(), 2);
      const row = await prisma.ingestionStagingItem.findUnique({ where: { urlHash: (await import("../src/lib/hash")).urlHash(URL1) } });
      assert.equal(row?.reviewStatus, "needs_review");
    });

    await check2("URL matching an existing ContentItem is flagged matched_existing without mutating it", async () => {
      await prisma.contentItem.create({ data: { title: "Olemasolev sisu", canonicalUrl: URL3 } });
      pages = { ...pages, [URL3]: htmlFor("Seotud lugu", "Seotud loo sisu, piisavalt pikk keha tekst ettevõtjatele lugemiseks.") };
      const summary = await runIngestion(prisma, { mode: "staging", discover: discoverFixed([URL3]), fetcher });
      assert.equal(summary.itemsCreated, 1);
      const row = await prisma.ingestionStagingItem.findUnique({ where: { urlHash: (await import("../src/lib/hash")).urlHash(URL3) } });
      assert.equal(row?.reviewStatus, "matched_existing");
      assert.ok(row?.matchedContentItemId);
      // ContentItem is unchanged: exactly the one we seeded, title intact.
      assert.equal(await prisma.contentItem.count(), 1);
      const ci = await prisma.contentItem.findFirst({ where: { canonicalUrl: URL3 } });
      assert.equal(ci?.title, "Olemasolev sisu");
    });

    await check2("external URLs in discovery are ignored", async () => {
      const summary = await runIngestion(prisma, {
        mode: "dry_run",
        discover: async () => ["https://evil.com/et/x", URL1],
        fetcher,
      });
      assert.equal(summary.pagesDiscovered, 1); // only the allowlisted Koda.ee URL survived
    });
  } finally {
    if (close) await close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// async check wrapper
async function check2(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL- ${name}`);
    console.log("        " + (error as Error).message);
  }
}

integration()
  .catch((error) => {
    failed++;
    console.log("  FAIL- integration harness");
    console.log("        " + (error as Error).message);
  })
  .finally(() => {
    console.log(`\n[test] ${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed > 0) process.exitCode = 1;
  });

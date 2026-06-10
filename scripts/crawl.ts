/**
 * Polite crawler/importer for public koda.ee listing pages.
 *
 * Usage:  npm run crawl
 *
 * - Fetches the configured listing pages plus pagination (?page=N, Drupal style).
 * - Extracts title, date, URL and excerpt from listing teasers.
 * - Optionally fetches article pages to extract full body text.
 * - Deduplicates by canonical URL, normalized title and content hash.
 * - Safe to re-run: existing items are updated, never duplicated.
 *
 * TODO: body extraction selectors are best-effort for the current koda.ee
 *       (Drupal) markup. If the site changes, adjust ARTICLE_BODY_SELECTORS.
 * TODO: can be scheduled later (cron inside the server or a compose service).
 */
import * as cheerio from "cheerio";
import { PrismaClient, SourceType } from "@prisma/client";
import { loadEnv } from "./env";
import { contentHash, normalizeTitle } from "../src/lib/hash";

loadEnv();

const prisma = new PrismaClient();

const USER_AGENT = `KodaLiikmevaartusBot/0.1 (+${process.env.APP_URL || "https://liige.orgusaar.ee"}; viisakas importija)`;

const DELAY_MS = parseInt(process.env.CRAWLER_DELAY_MS || "1000", 10);
const MAX_PAGES = parseInt(process.env.CRAWLER_MAX_PAGES || "5", 10);
const FETCH_BODY = (process.env.CRAWLER_FETCH_BODY || "true") === "true";
const MAX_BODY_FETCHES = parseInt(process.env.CRAWLER_MAX_BODY_FETCHES || "100", 10);

type Source = { url: string; sourceType: SourceType; label: string };

const SOURCES: Source[] = [
  { url: "https://www.koda.ee/et/meie-arvamus", sourceType: "opinion", label: "Meie arvamus" },
  { url: "https://www.koda.ee/et/meie-arvamus/archive", sourceType: "archive_opinion", label: "Arvamuste arhiiv" },
  { url: "https://www.koda.ee/et/uudised/meie_uudised", sourceType: "news", label: "Meie uudised" },
  {
    url: "https://www.koda.ee/et/meie-moju/hetkel-kasil/arhiiv",
    sourceType: "currently_handled",
    label: "Hetkel käsil (arhiiv)",
  },
];

// Links that are clearly navigation, not articles.
const EXCLUDED_PATH_PREFIXES = [
  "/et/meie-arvamus",
  "/et/uudised",
  "/et/meie-moju",
  "/et/liikmelisus",
  "/et/koda",
  "/et/kontakt",
  "/user",
  "/et/sundmused-koolitused",
];

const ARTICLE_BODY_SELECTORS = [
  ".field--name-body",
  ".node__content .field--type-text-with-summary",
  "article .content",
  ".node__content",
  "main .content",
];

const ESTONIAN_MONTHS: Record<string, number> = {
  jaanuar: 1, veebruar: 2, märts: 3, aprill: 4, mai: 5, juuni: 6,
  juuli: 7, august: 8, september: 9, oktoober: 10, november: 11, detsember: 12,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string) {
  console.log(`[crawl ${new Date().toISOString()}] ${msg}`);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      log(`  ! HTTP ${res.status} ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    log(`  ! fetch failed ${url}: ${(e as Error).message}`);
    return null;
  }
}

export function parseEstonianDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();

  // ISO date e.g. 2026-05-12 or 2026-05-12T10:00:00
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  // 12.05.2026
  const dotted = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) return new Date(Date.UTC(+dotted[3], +dotted[2] - 1, +dotted[1]));

  // "12. mai 2026" or "12 mai 2026"
  const verbal = text.match(/(\d{1,2})\.?\s+([a-zõäöü]+)\s+(\d{4})/);
  if (verbal && ESTONIAN_MONTHS[verbal[2]]) {
    return new Date(Date.UTC(+verbal[3], ESTONIAN_MONTHS[verbal[2]] - 1, +verbal[1]));
  }

  return null;
}

function canonicalize(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (!["www.koda.ee", "koda.ee"].includes(url.hostname)) return null;
    url.hash = "";
    url.search = "";
    let path = url.pathname.replace(/\/+$/, "");
    if (!path.startsWith("/et/")) return null;
    return `https://www.koda.ee${path}`;
  } catch {
    return null;
  }
}

function isLikelyArticlePath(url: string): boolean {
  const path = new URL(url).pathname;
  // Article pages are deeper than section roots and not in the excluded list.
  if (EXCLUDED_PATH_PREFIXES.some((p) => path === p || path === `${p}/arhiiv` || path === `${p}/archive`)) {
    return false;
  }
  const segments = path.split("/").filter(Boolean);
  return segments.length >= 2; // /et/<something>...
}

type Teaser = {
  url: string;
  title: string;
  date: Date | null;
  excerpt: string | null;
};

/**
 * Extract article teasers from a Drupal-style listing page.
 * Tries common teaser containers first, falls back to scanning links.
 */
function extractTeasers(html: string, pageUrl: string): Teaser[] {
  const $ = cheerio.load(html);
  const teasers = new Map<string, Teaser>();

  const containers = $(".views-row, article, .node--view-mode-teaser, .teaser, .views-view li");

  containers.each((_, el) => {
    const $el = $(el);
    const link = $el.find("a[href]").filter((_, a) => {
      const canonical = canonicalize($(a).attr("href") || "", pageUrl);
      return !!canonical && isLikelyArticlePath(canonical);
    }).first();
    if (link.length === 0) return;

    const url = canonicalize(link.attr("href")!, pageUrl)!;
    const heading = $el.find("h1, h2, h3, h4").first().text().trim();
    const title = (heading || link.text()).replace(/\s+/g, " ").trim();
    if (!title || title.length < 8) return;

    const timeAttr = $el.find("time[datetime]").attr("datetime");
    const dateText = $el.find("time, .date, .views-field-created, .field--name-created").first().text();
    const date = parseEstonianDate(timeAttr) || parseEstonianDate(dateText) || parseEstonianDate($el.text());

    let excerpt =
      $el.find("p, .field--type-text-with-summary, .views-field-body").first().text().replace(/\s+/g, " ").trim() ||
      null;
    if (excerpt && excerpt.length > 400) excerpt = excerpt.slice(0, 397) + "…";
    if (excerpt === title) excerpt = null;

    if (!teasers.has(url)) teasers.set(url, { url, title, date, excerpt });
  });

  // Fallback: bare link scan when no teaser containers matched.
  if (teasers.size === 0) {
    $("main a[href], .layout-content a[href], body a[href]").each((_, a) => {
      const url = canonicalize($(a).attr("href") || "", pageUrl);
      if (!url || !isLikelyArticlePath(url)) return;
      const title = $(a).text().replace(/\s+/g, " ").trim();
      if (!title || title.length < 20) return; // skip nav/short links
      if (!teasers.has(url)) teasers.set(url, { url, title, date: null, excerpt: null });
    });
  }

  return [...teasers.values()];
}

function extractBody(html: string): { body: string | null; date: Date | null; title: string | null } {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer").remove();

  let body: string | null = null;
  for (const selector of ARTICLE_BODY_SELECTORS) {
    const text = $(selector).first().text().replace(/\s+/g, " ").trim();
    if (text && text.length > 200) {
      body = text;
      break;
    }
  }
  if (!body) {
    // Last resort: join paragraph texts from the page.
    const paragraphs = $("main p, article p")
      .map((_, p) => $(p).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t.length > 40);
    if (paragraphs.length > 0) body = paragraphs.join("\n\n");
  }
  if (body && body.length > 50000) body = body.slice(0, 50000);

  const date =
    parseEstonianDate($("time[datetime]").attr("datetime")) ||
    parseEstonianDate($(".date, .field--name-created, time").first().text());

  const title = $("h1").first().text().replace(/\s+/g, " ").trim() || null;

  return { body, date, title };
}

async function main() {
  if ((process.env.CRAWLER_ENABLED || "true") !== "true") {
    log("CRAWLER_ENABLED is not 'true' – exiting.");
    return;
  }

  log(`Starting crawl: ${SOURCES.length} sources, max ${MAX_PAGES} listing pages each, delay ${DELAY_MS}ms`);

  // Existing normalized titles for title-based dedup across different URLs.
  const existing = await prisma.contentItem.findMany({
    select: { id: true, title: true, canonicalUrl: true, contentHash: true, bodyText: true },
  });
  const titleIndex = new Map(existing.map((e) => [normalizeTitle(e.title), e.id]));
  const urlIndex = new Map(existing.map((e) => [e.canonicalUrl, e]));
  const hashIndex = new Map(existing.filter((e) => e.contentHash).map((e) => [e.contentHash!, e.id]));

  let created = 0;
  let updated = 0;
  let skippedDup = 0;
  let bodyFetches = 0;

  for (const source of SOURCES) {
    log(`Source: ${source.label} (${source.url})`);

    const allTeasers: Teaser[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const pageUrl = page === 0 ? source.url : `${source.url}?page=${page}`;
      const html = await fetchHtml(pageUrl);
      await sleep(DELAY_MS);
      if (!html) break;

      const teasers = extractTeasers(html, pageUrl).filter(
        (t) => !allTeasers.some((existing) => existing.url === t.url)
      );
      log(`  page ${page + 1}: ${teasers.length} new teasers`);
      if (teasers.length === 0) break; // end of pagination
      allTeasers.push(...teasers);
    }

    for (const teaser of allTeasers) {
      const existingItem = urlIndex.get(teaser.url);
      const normTitle = normalizeTitle(teaser.title);

      // Title-based dedup: same article listed under a different URL.
      if (!existingItem && titleIndex.has(normTitle)) {
        skippedDup++;
        continue;
      }

      // Optionally fetch the article body (for new items, or old items without a body).
      let body: string | null = existingItem?.bodyText ?? null;
      let date = teaser.date;
      let title = teaser.title;
      if (FETCH_BODY && !body && bodyFetches < MAX_BODY_FETCHES) {
        const html = await fetchHtml(teaser.url);
        bodyFetches++;
        await sleep(DELAY_MS);
        if (html) {
          const extracted = extractBody(html);
          body = extracted.body;
          if (!date) date = extracted.date;
          if (extracted.title && extracted.title.length >= 8) title = extracted.title;
        }
      }

      const hash = contentHash(title, body || teaser.excerpt);

      // Content-hash dedup: identical content under a different URL.
      const hashOwner = hashIndex.get(hash);
      if (!existingItem && hashOwner) {
        skippedDup++;
        continue;
      }

      const excerpt = teaser.excerpt || (body ? body.slice(0, 280) + (body.length > 280 ? "…" : "") : null);

      const item = await prisma.contentItem.upsert({
        where: { canonicalUrl: teaser.url },
        create: {
          sourceUrl: teaser.url,
          canonicalUrl: teaser.url,
          title,
          date,
          sourceType: source.sourceType,
          bodyText: body,
          excerpt,
          contentHash: hash,
          language: "et",
        },
        update: {
          // Refresh fields the importer owns; never touch admin-edited fields.
          title,
          date: date ?? undefined,
          bodyText: body ?? undefined,
          excerpt: excerpt ?? undefined,
          contentHash: hash,
          scrapedAt: new Date(),
        },
      });

      if (existingItem) updated++;
      else {
        created++;
        urlIndex.set(teaser.url, { id: item.id, title, canonicalUrl: teaser.url, contentHash: hash, bodyText: body });
        titleIndex.set(normTitle, item.id);
        hashIndex.set(hash, item.id);
      }
    }

    log(`  done: ${allTeasers.length} teasers processed`);
  }

  log(`Finished. created=${created} updated=${updated} skipped_duplicates=${skippedDup} body_fetches=${bodyFetches}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

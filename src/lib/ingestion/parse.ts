/**
 * Conservative, resilient parser for public Koda.ee pages. Never throws on bad
 * input: missing title/date/body and invalid HTML all degrade to safe defaults.
 * Server-only (uses cheerio). Does not execute page scripts.
 */
import * as cheerio from "cheerio";
import { canonicalizeKodaUrl, isLikelyArticlePath } from "./url";

export type DetectedSourceType = "news" | "opinion" | "achievement" | "event" | "other";

export type ParsedPage = {
  canonicalUrl: string;
  title: string | null;
  publishedAt: Date | null;
  summary: string | null;
  bodyText: string | null;
  detectedSourceType: DetectedSourceType;
  rawMetadata: Record<string, unknown>;
};

const BODY_SELECTORS = [
  ".field--name-body",
  ".node__content .field--type-text-with-summary",
  "article .content",
  ".node__content",
  "main .content",
  "article",
  "main",
];

const MAX_BODY_CHARS = 20000;

const ESTONIAN_MONTHS: Record<string, number> = {
  jaanuar: 1, veebruar: 2, märts: 3, marts: 3, aprill: 4, mai: 5, juuni: 6,
  juuli: 7, august: 8, september: 9, oktoober: 10, november: 11, detsember: 12,
};

/** Parse an ISO / dotted / Estonian-verbal date string; null if unrecognized. */
export function parseDateText(raw: string | null | undefined): Date | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return safeDate(+iso[1], +iso[2], +iso[3]);
  const dotted = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) return safeDate(+dotted[3], +dotted[2], +dotted[1]);
  const verbal = text.match(/(\d{1,2})\.?\s+([a-zõäöü]+)\s+(\d{4})/);
  if (verbal && ESTONIAN_MONTHS[verbal[2]]) return safeDate(+verbal[3], ESTONIAN_MONTHS[verbal[2]], +verbal[1]);
  return null;
}

function safeDate(year: number, month: number, day: number): Date | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Source type from the canonical URL path (primary, reliable signal). */
export function detectSourceTypeFromUrl(canonicalUrl: string): DetectedSourceType {
  let path = "";
  try {
    path = new URL(canonicalUrl).pathname.toLowerCase();
  } catch {
    return "other";
  }
  if (path.includes("/meie-toovoid") || path.includes("toovoid")) return "achievement";
  if (path.includes("/uudis")) return "news";
  if (path.includes("/meie-arvamus") || path.includes("arvamus") || path.includes("seisukoh") || path.includes("raagi-kaasa"))
    return "opinion";
  if (path.includes("sundmus") || path.includes("koolitus") || path.includes("/kalender")) return "event";
  return "other";
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Extract canonical, article-like Koda.ee links from a listing page. */
export function extractArticleLinks(html: string, pageUrl: string): string[] {
  const found = new Set<string>();
  try {
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      const canonical = canonicalizeKodaUrl($(el).attr("href") || "", pageUrl);
      if (canonical && isLikelyArticlePath(canonical)) found.add(canonical);
    });
  } catch {
    // invalid HTML → no links
  }
  return [...found];
}

/** Parse a public Koda.ee content page. Always returns a ParsedPage. */
export function parseKodaPage(html: string, canonicalUrl: string): ParsedPage {
  const base: ParsedPage = {
    canonicalUrl,
    title: null,
    publishedAt: null,
    summary: null,
    bodyText: null,
    detectedSourceType: detectSourceTypeFromUrl(canonicalUrl),
    rawMetadata: {},
  };
  if (typeof html !== "string" || !html.trim()) return base;

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return base;
  }

  // Strip non-content chrome so body extraction is clean.
  $("script, style, noscript, nav, header, footer, .menu, .breadcrumb, form").remove();

  const titleFromH1 = clean($("h1").first().text());
  const ogTitle = clean($('meta[property="og:title"]').attr("content") || "");
  const docTitle = clean($("title").first().text()).replace(/\s*[|–-]\s*Eesti Kaubandus.*$/i, "").trim();
  const title = titleFromH1 || ogTitle || docTitle || null;

  const dateAttr =
    $("time[datetime]").first().attr("datetime") ||
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[itemprop="datePublished"]').attr("content") ||
    $("time").first().text() ||
    "";
  const publishedAt = parseDateText(dateAttr);

  const metaDesc = clean($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "");

  let bodyText: string | null = null;
  for (const selector of BODY_SELECTORS) {
    const text = clean($(selector).first().text());
    if (text.length > 80) {
      bodyText = text.slice(0, MAX_BODY_CHARS);
      break;
    }
  }

  const summary = metaDesc || (bodyText ? bodyText.slice(0, 300) : null);

  return {
    canonicalUrl,
    title,
    publishedAt,
    summary: summary || null,
    bodyText,
    detectedSourceType: base.detectedSourceType,
    rawMetadata: {
      ogType: clean($('meta[property="og:type"]').attr("content") || "") || null,
      hasH1: Boolean(titleFromH1),
      bodyChars: bodyText?.length ?? 0,
      hadDateAttr: Boolean(dateAttr),
    },
  };
}

/**
 * Koda.ee live ingestion orchestrator (v1, staging only).
 *
 * Safety guarantees:
 *  - only allowlisted https://www.koda.ee /et/ pages are ever fetched;
 *  - external domains are rejected before any request;
 *  - a page limit and per-request timeout are always applied;
 *  - dry-run writes NOTHING; staging writes only IngestionRun + IngestionStagingItem;
 *  - ContentItem rows are never created, updated or deleted here;
 *  - new pages are never made public — they land in the review staging layer.
 *
 * The fetch/discover functions are injectable so the pipeline is testable without
 * any network access.
 */
import { type PrismaClient, Prisma } from "@prisma/client";
import { contentHash, urlHash } from "../hash";
import { canonicalizeKodaUrl, isAllowedKodaUrl } from "./url";
import { type DetectedSourceType, extractArticleLinks, parseDateText, parseKodaPage } from "./parse";
import { classifyParsedPage } from "./classify";

export const DEFAULT_SOURCE = "koda_ee";
export const DEFAULT_LIMIT = 50;
export const DEFAULT_MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = "KodaIngestBot/1.0 (+https://www.koda.ee; staging review, not production import)";

/** Conservative default listing pages to discover article links from. */
export const DEFAULT_SOURCE_PAGES = [
  "https://www.koda.ee/et/uudised/meie_uudised",
  "https://www.koda.ee/et/meie-arvamus",
  "https://www.koda.ee/et/meie-moju/meie-toovoidud",
];

export type FetchResult = { ok: boolean; status: number; html: string | null };
export type Fetcher = (url: string) => Promise<FetchResult>;

export type IngestOptions = {
  mode: "dry_run" | "staging";
  source?: string;
  limit?: number;
  maxPages?: number;
  since?: string | null;
  sourcePages?: string[];
  fetcher?: Fetcher;
  /** Override discovery entirely (tests supply a fixed URL list). */
  discover?: (ctx: { sourcePages: string[]; maxPages: number; limit: number; fetcher: Fetcher }) => Promise<string[]>;
};

export type RunCounts = {
  pagesDiscovered: number;
  pagesFetched: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  itemsFailed: number;
};

export type IngestSummary = RunCounts & {
  runId: string | null;
  source: string;
  mode: "dry_run" | "staging";
  status: "completed" | "failed";
  errors: string[];
};

export function emptyCounts(): RunCounts {
  return { pagesDiscovered: 0, pagesFetched: 0, itemsCreated: 0, itemsUpdated: 0, itemsSkipped: 0, itemsFailed: 0 };
}

export type StagingAction = "create" | "update" | "skip";
export type ReviewStatus = "new" | "matched_existing" | "needs_review" | "approved" | "rejected" | "ignored";
export type StagingDecision = { action: StagingAction; reviewStatus: ReviewStatus; matchedContentItemId: string | null };

/**
 * Pure dedup/change-detection decision:
 *  - same URL + same content hash  → skip (unchanged), keep prior review status;
 *  - same URL + changed hash       → update, back to needs_review;
 *  - new URL matching a ContentItem→ create as matched_existing (ContentItem untouched);
 *  - new URL, unknown type         → create as needs_review; otherwise create as new.
 */
export function resolveStagingDecision(input: {
  existing: { contentHash: string | null; reviewStatus: string } | null;
  matchedContentItemId: string | null;
  newContentHash: string;
  detectedSourceType: DetectedSourceType;
}): StagingDecision {
  const { existing, matchedContentItemId, newContentHash, detectedSourceType } = input;
  if (existing) {
    if (existing.contentHash && existing.contentHash === newContentHash) {
      return { action: "skip", reviewStatus: existing.reviewStatus as ReviewStatus, matchedContentItemId };
    }
    return { action: "update", reviewStatus: "needs_review", matchedContentItemId };
  }
  if (matchedContentItemId) {
    return { action: "create", reviewStatus: "matched_existing", matchedContentItemId };
  }
  return {
    action: "create",
    reviewStatus: detectedSourceType === "other" ? "needs_review" : "new",
    matchedContentItemId: null,
  };
}

export function applyActionToCounts(counts: RunCounts, action: StagingAction): void {
  if (action === "create") counts.itemsCreated++;
  else if (action === "update") counts.itemsUpdated++;
  else counts.itemsSkipped++;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

/** Network fetcher — guards the allowlist before every request. */
export const defaultFetcher: Fetcher = async (url) => {
  if (!isAllowedKodaUrl(url)) return { ok: false, status: 0, html: null };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status, html: null };
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return { ok: false, status: res.status, html: null };
    return { ok: true, status: res.status, html: await res.text() };
  } catch {
    return { ok: false, status: 0, html: null };
  }
};

async function discoverKodaUrls(ctx: {
  sourcePages: string[];
  maxPages: number;
  limit: number;
  fetcher: Fetcher;
  errors: string[];
}): Promise<string[]> {
  const out = new Set<string>();
  let listingsFetched = 0;
  for (const source of ctx.sourcePages) {
    if (listingsFetched >= ctx.maxPages || out.size >= ctx.limit) break;
    const target = canonicalizeKodaUrl(source);
    if (!target) {
      ctx.errors.push(`skip non-allowlisted source page: ${source}`);
      continue;
    }
    const res = await ctx.fetcher(target);
    listingsFetched++;
    if (!res.ok || !res.html) {
      ctx.errors.push(`discover fetch failed (${res.status}): ${target}`);
      continue;
    }
    for (const link of extractArticleLinks(res.html, target)) {
      out.add(link);
      if (out.size >= ctx.limit) break;
    }
  }
  return [...out];
}

export async function runIngestion(prisma: PrismaClient, options: IngestOptions): Promise<IngestSummary> {
  const mode = options.mode;
  const source = options.source ?? DEFAULT_SOURCE;
  const limit = clamp(options.limit, 1, 500, DEFAULT_LIMIT);
  const maxPages = clamp(options.maxPages, 1, 50, DEFAULT_MAX_PAGES);
  const fetcher = options.fetcher ?? defaultFetcher;
  const sourcePages = options.sourcePages ?? DEFAULT_SOURCE_PAGES;
  const since = options.since ? parseDateText(options.since) : null;
  const counts = emptyCounts();
  const errors: string[] = [];

  const discovered = options.discover
    ? await options.discover({ sourcePages, maxPages, limit, fetcher })
    : await discoverKodaUrls({ sourcePages, maxPages, limit, fetcher, errors });
  const urls = [...new Set(discovered.filter(isAllowedKodaUrl))].slice(0, limit);
  counts.pagesDiscovered = urls.length;

  let runId: string | null = null;
  if (mode === "staging") {
    const run = await prisma.ingestionRun.create({ data: { source, mode, status: "started" } });
    runId = run.id;
  }

  let status: IngestSummary["status"] = "completed";
  try {
    for (const url of urls) {
      try {
        const res = await fetcher(url);
        if (!res.ok || !res.html) {
          counts.itemsFailed++;
          errors.push(`fetch failed (${res.status}): ${url}`);
          continue;
        }
        counts.pagesFetched++;
        const parsed = parseKodaPage(res.html, url);
        if (since && parsed.publishedAt && parsed.publishedAt.getTime() < since.getTime()) {
          counts.itemsSkipped++;
          continue;
        }
        const classification = classifyParsedPage(parsed);
        const newContentHash = contentHash(parsed.title ?? url, parsed.bodyText ?? parsed.summary ?? "");
        const uHash = urlHash(url);

        const existing = await prisma.ingestionStagingItem.findUnique({
          where: { urlHash: uHash },
          select: { contentHash: true, reviewStatus: true },
        });
        const matched = await prisma.contentItem.findFirst({
          where: { OR: [{ canonicalUrl: url }, { sourceUrl: url }] },
          select: { id: true },
        });
        const decision = resolveStagingDecision({
          existing,
          matchedContentItemId: matched?.id ?? null,
          newContentHash,
          detectedSourceType: parsed.detectedSourceType,
        });
        applyActionToCounts(counts, decision.action);

        if (mode === "staging" && decision.action !== "skip") {
          const data = {
            source,
            canonicalUrl: url,
            urlHash: uHash,
            contentHash: newContentHash,
            title: parsed.title,
            summary: parsed.summary,
            bodyText: parsed.bodyText,
            publishedAt: parsed.publishedAt,
            detectedSourceType: parsed.detectedSourceType,
            detectedValdkonnad: classification.detectedValdkonnad as Prisma.InputJsonValue,
            detectedTegevusalad: classification.detectedTegevusalad as Prisma.InputJsonValue,
            detectedTapsustused: classification.detectedTapsustused as Prisma.InputJsonValue,
            detectedLaws: classification.detectedLaws as unknown as Prisma.InputJsonValue,
            classificationConfidence: classification.classificationConfidence,
            reviewStatus: decision.reviewStatus,
            matchedContentItemId: decision.matchedContentItemId,
            rawMetadata: parsed.rawMetadata as Prisma.InputJsonValue,
            fetchStatus: "ok",
            errorMessage: null,
          };
          await prisma.ingestionStagingItem.upsert({
            where: { urlHash: uHash },
            create: { ...data, runId },
            update: { ...data, runId },
          });
        }
      } catch (error) {
        counts.itemsFailed++;
        errors.push(`${url}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    status = "failed";
    errors.push((error as Error).message);
  }

  const errorSummary = errors.length ? errors.slice(0, 50).join("\n") : null;
  if (mode === "staging" && runId) {
    await prisma.ingestionRun.update({
      where: { id: runId },
      data: { status, finishedAt: new Date(), ...counts, errorSummary },
    });
  }

  return { runId, source, mode, status, ...counts, errors };
}

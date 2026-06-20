/**
 * Koda.ee live ingestion CLI (manual run only — nothing schedules this).
 *
 *   npm run ingest:koda-ee -- --dry-run --limit=20
 *   npm run ingest:koda-ee -- --staging --limit=50
 *
 * Default mode is DRY-RUN (no database writes). Staging mode writes only
 * IngestionRun + IngestionStagingItem; it never touches ContentItem and never
 * publishes anything. See docs/ingestion-koda-ee.md.
 */
import { loadEnv } from "./env";
import { makePrismaClient } from "./lib/prisma-client";
import { DEFAULT_LIMIT, runIngestion } from "../src/lib/ingestion/koda-ee";

loadEnv();

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function intOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function main() {
  const staging = hasFlag("staging");
  const dryRun = hasFlag("dry-run") || !staging; // default: dry-run
  const mode: "dry_run" | "staging" = staging && !hasFlag("dry-run") ? "staging" : "dry_run";
  const source = argValue("source") || "koda_ee";
  const limit = intOrUndefined(argValue("limit"));
  const maxPages = intOrUndefined(argValue("max-pages"));
  const since = argValue("since") || null;

  console.log(`[ingest] source=${source} mode=${mode} limit=${limit ?? DEFAULT_LIMIT}${since ? ` since=${since}` : ""}`);
  console.log(
    mode === "staging"
      ? "[ingest] staging mode: writes IngestionRun + IngestionStagingItem only (never ContentItem, never public)."
      : "[ingest] dry-run: fetch/parse/classify and print a summary; no database writes.",
  );
  void dryRun;

  const { prisma, close } = await makePrismaClient();
  try {
    const summary = await runIngestion(prisma, { mode, source, limit, maxPages, since });
    console.log("[ingest] summary:");
    console.log(`  runId            : ${summary.runId ?? "(dry-run, none)"}`);
    console.log(`  status           : ${summary.status}`);
    console.log(`  pagesDiscovered  : ${summary.pagesDiscovered}`);
    console.log(`  pagesFetched     : ${summary.pagesFetched}`);
    console.log(`  itemsCreated     : ${summary.itemsCreated}`);
    console.log(`  itemsUpdated     : ${summary.itemsUpdated}`);
    console.log(`  itemsSkipped     : ${summary.itemsSkipped}`);
    console.log(`  itemsFailed      : ${summary.itemsFailed}`);
    if (summary.errors.length) {
      console.log(`  errors (${summary.errors.length}, first 10):`);
      for (const error of summary.errors.slice(0, 10)) console.log(`    - ${error}`);
    }
    if (summary.status === "failed") process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

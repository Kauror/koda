/**
 * Stand up a clean local PGlite database (PostgreSQL/WASM) and apply the real
 * Prisma migration SQL files in order, from zero.
 *
 *   KODA_DB_DRIVER=pglite npm run db:setup:pglite
 *
 * This is a local verification harness for machines without Docker/Postgres
 * (e.g. Windows on ARM, where Prisma ships no native query engine). It proves
 * that prisma/migrations/<...>/migration.sql apply cleanly on an empty database
 * and leaves a ready-to-use DB in KODA_PGLITE_DIR for the import scripts.
 *
 * It is NOT used in production: production runs `npm run prisma:deploy` against
 * a real PostgreSQL.
 */
import { readFileSync, readdirSync, rmSync, statSync } from "fs";
import { resolve } from "path";
import { loadEnv } from "./env";
import { PGLITE_DIR } from "./lib/prisma-client";

loadEnv();

const MIGRATIONS_DIR = resolve(process.cwd(), "prisma", "migrations");

function migrationFiles(): { name: string; sql: string }[] {
  const entries = readdirSync(MIGRATIONS_DIR)
    .filter((e) => statSync(resolve(MIGRATIONS_DIR, e)).isDirectory())
    .sort(); // timestamp-prefixed names sort chronologically
  return entries.map((name) => ({
    name,
    sql: readFileSync(resolve(MIGRATIONS_DIR, name, "migration.sql"), "utf8"),
  }));
}

async function main() {
  console.log(`[db-setup] Resetting PGlite data dir: ${PGLITE_DIR}`);
  rmSync(PGLITE_DIR, { recursive: true, force: true });

  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(PGLITE_DIR);
  await db.waitReady;
  const version = (await db.query<{ v: string }>("select version() as v")).rows[0]?.v ?? "?";
  console.log(`[db-setup] PGlite ready: ${version.split(" on ")[0]}`);

  const files = migrationFiles();
  console.log(`[db-setup] Applying ${files.length} migration(s) from zero:`);
  for (const { name, sql } of files) {
    try {
      await db.exec(sql);
      console.log(`  ok  - ${name}`);
    } catch (e) {
      console.error(`  FAIL- ${name}`);
      console.error("        " + (e as Error).message);
      await db.close();
      process.exitCode = 1;
      return;
    }
  }

  // Sanity: the core tables exist.
  const tables = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema='public' order by table_name"
  );
  const names = tables.rows.map((r) => r.table_name);
  console.log(`[db-setup] Tables created (${names.length}): ${names.join(", ")}`);
  const required = ["ContentItem", "Tag", "ContentEvidenceLink", "AchievementEnrichment"];
  const missing = required.filter((t) => !names.includes(t));
  await db.close();

  if (missing.length) {
    console.error(`[db-setup] FAIL: missing expected tables: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("[db-setup] PASS — migrations apply cleanly from zero.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

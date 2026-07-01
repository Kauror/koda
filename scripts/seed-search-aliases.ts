import { readFileSync } from "fs";
import { resolve } from "path";
import type { Prisma } from "@prisma/client";
import { loadEnv } from "./env";
import { makePrismaClient } from "./lib/prisma-client";
import { normalizeAliasText, type SearchAliasRecord } from "../src/lib/search-aliases";

loadEnv();

const SEED_PATH = resolve(process.cwd(), "data", "search", "koda_search_alias_seed_v0_2.json");

function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid alias seed row ${String(row.id ?? "?")}: missing ${key}`);
  }
  return value.trim();
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalJson(row: Record<string, unknown>, key: string): Prisma.InputJsonValue | undefined {
  const value = row[key];
  if (value == null) return undefined;
  return value as Prisma.InputJsonValue;
}

function loadSeed(): { rows: SearchAliasRecord[]; skippedDuplicates: number } {
  const raw = JSON.parse(readFileSync(SEED_PATH, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`Expected ${SEED_PATH} to contain a JSON array`);

  const ids = new Set<string>();
  const byNormalized = new Map<string, SearchAliasRecord>();
  let skippedDuplicates = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new Error("Invalid alias seed row: expected object");
    const row = item as Record<string, unknown>;
    const id = requireString(row, "id");
    const alias = requireString(row, "alias");
    const normalizedAlias = normalizeAliasText(alias);
    if (!normalizedAlias) throw new Error(`Invalid alias seed row ${id}: alias normalizes to empty`);
    if (ids.has(id)) throw new Error(`Duplicate alias id in seed: ${id}`);
    ids.add(id);

    const weight = Number(row.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 10) {
      throw new Error(`Invalid alias seed row ${id}: weight must be an integer from 1 to 10`);
    }

    const parsed = {
      id,
      alias,
      normalizedAlias,
      canonicalLabel: requireString(row, "canonicalLabel"),
      type: requireString(row, "type"),
      targetSlug: optionalString(row, "targetSlug"),
      targetKind: requireString(row, "targetKind"),
      weight,
      language: optionalString(row, "language") ?? "et",
      sourceBasis: optionalJson(row, "sourceBasis"),
      notes: optionalString(row, "notes"),
      isPublic: typeof row.isPublic === "boolean" ? row.isPublic : true,
      intent: optionalString(row, "intent"),
      expandedTerms: optionalJson(row, "expandedTerms"),
    };
    const current = byNormalized.get(normalizedAlias);
    if (!current || parsed.weight > current.weight || (parsed.weight === current.weight && parsed.id < current.id)) {
      if (current) skippedDuplicates++;
      byNormalized.set(normalizedAlias, parsed);
    } else {
      skippedDuplicates++;
    }
  }
  return { rows: [...byNormalized.values()].sort((a, b) => a.id.localeCompare(b.id)), skippedDuplicates };
}

async function main() {
  const { rows, skippedDuplicates } = loadSeed();
  const { prisma, close } = await makePrismaClient();
  const counts = new Map<string, number>();
  let pruned = 0;

  try {
    for (const row of rows) {
      counts.set(row.targetKind, (counts.get(row.targetKind) ?? 0) + 1);
      await prisma.searchAlias.upsert({
        where: { id: row.id },
        create: {
          id: row.id,
          alias: row.alias,
          normalizedAlias: row.normalizedAlias!,
          canonicalLabel: row.canonicalLabel,
          type: row.type,
          targetSlug: row.targetSlug,
          targetKind: row.targetKind,
          weight: row.weight,
          language: row.language ?? "et",
          sourceBasis: row.sourceBasis as Prisma.InputJsonValue | undefined,
          notes: row.notes,
          isPublic: row.isPublic ?? true,
          intent: row.intent,
          expandedTerms: row.expandedTerms as Prisma.InputJsonValue | undefined,
        },
        update: {
          alias: row.alias,
          normalizedAlias: row.normalizedAlias!,
          canonicalLabel: row.canonicalLabel,
          type: row.type,
          targetSlug: row.targetSlug,
          targetKind: row.targetKind,
          weight: row.weight,
          language: row.language ?? "et",
          sourceBasis: row.sourceBasis as Prisma.InputJsonValue | undefined,
          notes: row.notes,
          isPublic: row.isPublic ?? true,
          intent: row.intent,
          expandedTerms: row.expandedTerms as Prisma.InputJsonValue | undefined,
        },
      });
    }

    // Prune: the seed file is authoritative, so remove any SearchAlias rows that
    // are no longer present in it (upsert alone would leave deleted aliases —
    // e.g. retired artificial prompt phrases — lingering in the DB).
    const seedIds = rows.map((r) => r.id);
    const result = await prisma.searchAlias.deleteMany({ where: { id: { notIn: seedIds } } });
    pruned = result.count;
  } finally {
    await close();
  }

  const summary = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind}=${count}`).join(", ");
  console.log(`[search-aliases] upserted=${rows.length} pruned=${pruned} skippedNormalizedDuplicates=${skippedDuplicates} ${summary}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

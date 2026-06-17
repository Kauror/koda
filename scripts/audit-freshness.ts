import { loadEnv } from "./env";
import { isPublicSearchEligible } from "../src/lib/eligibility";
import { sourceLabel } from "../src/lib/labels";

loadEnv();

type Row = {
  id: string;
  externalId: string | null;
  title: string;
  date: Date | null;
  year: number | null;
  reportYear: number | null;
  sourceDataset: string | null;
  sourceLayer: string | null;
  sourceTypeDetail: string | null;
  isPublic: boolean;
  isHidden: boolean;
  needsHumanReview: boolean;
  importStatus: string | null;
  publicDisplayStatus: string | null;
  adminVisibilityOverride: boolean | null;
};

function itemYear(row: Row): number | null {
  return row.date?.getUTCFullYear() ?? row.year ?? row.reportYear ?? null;
}

function isLate2025(row: Row): boolean {
  if (row.date) return row.date >= new Date("2025-10-01T00:00:00.000Z") && row.date < new Date("2026-01-01T00:00:00.000Z");
  return row.year === 2025 || row.reportYear === 2025;
}

function latest(rows: Row[], predicate: (row: Row) => boolean): Row | null {
  return rows
    .filter(predicate)
    .sort((a, b) => (b.date?.getTime() ?? b.year ?? b.reportYear ?? 0) - (a.date?.getTime() ?? a.year ?? a.reportYear ?? 0))[0] ?? null;
}

function printRow(label: string, row: Row | null) {
  if (!row) {
    console.log(`${label}: none`);
    return;
  }
  const when = row.date?.toISOString().slice(0, 10) ?? row.year ?? row.reportYear ?? "no date";
  console.log(`${label}: ${when} | ${row.externalId ?? row.id} | ${sourceLabel(row.sourceLayer, row.sourceTypeDetail)} | ${row.title}`);
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const rows: Row[] = await prisma.contentItem.findMany({
    select: {
      id: true,
      externalId: true,
      title: true,
      date: true,
      year: true,
      reportYear: true,
      sourceDataset: true,
      sourceLayer: true,
      sourceTypeDetail: true,
      isPublic: true,
      isHidden: true,
      needsHumanReview: true,
      importStatus: true,
      publicDisplayStatus: true,
      adminVisibilityOverride: true,
    },
  });

  const publicRows = rows.filter(isPublicSearchEligible);
  const publicByYear = new Map<number, number>();
  const publicBySourceYear = new Map<string, number>();
  for (const row of publicRows) {
    const year = itemYear(row);
    if (!year) continue;
    publicByYear.set(year, (publicByYear.get(year) ?? 0) + 1);
    const source = sourceLabel(row.sourceLayer, row.sourceTypeDetail);
    const key = `${year} | ${source}`;
    publicBySourceYear.set(key, (publicBySourceYear.get(key) ?? 0) + 1);
  }

  const hiddenRecent = rows.filter((row) => {
    const year = itemYear(row);
    return (year === 2026 || isLate2025(row)) && !isPublicSearchEligible(row);
  });

  console.log(`[freshness] rows=${rows.length} public=${publicRows.length}`);
  printRow("latest public achievement", latest(publicRows, (row) => row.sourceTypeDetail === "toovoit" || row.sourceLayer === "koda_achievement"));
  printRow("latest public news", latest(publicRows, (row) => row.sourceTypeDetail === "meie_uudis" || row.sourceLayer === "koda_news"));
  printRow("latest public opinion/article", latest(publicRows, (row) => row.sourceTypeDetail === "meie_arvamus_article" || row.sourceLayer === "koda_public_opinion"));
  printRow("latest annual context", latest(publicRows, (row) => row.sourceDataset === "annual_reports" || row.sourceLayer === "annual_report"));
  console.log(`public rows in 2026: ${publicRows.filter((row) => itemYear(row) === 2026).length}`);
  console.log(`public rows in late 2025: ${publicRows.filter(isLate2025).length}`);
  console.log(`recent hidden/review-only rows: ${hiddenRecent.length}`);

  console.log("[freshness] public rows by year:");
  for (const [year, count] of [...publicByYear.entries()].sort((a, b) => b[0] - a[0])) {
    console.log(`  ${year}: ${count}`);
  }

  console.log("[freshness] public rows by source/year:");
  for (const [key, count] of [...publicBySourceYear.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    console.log(`  ${key}: ${count}`);
  }

  await prisma.$disconnect().catch(() => {});
}

main().catch((error) => {
  console.error("[freshness] audit failed:", error);
  process.exitCode = 1;
});

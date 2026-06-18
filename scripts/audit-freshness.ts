import { loadEnv } from "./env";
import { isPublicSearchEligible } from "../src/lib/eligibility";
import { sourceLabel } from "../src/lib/labels";
import {
  type Candidate,
  getSectorRelevance,
  hasGenericSectorTag,
  parseSearchParams,
  scoreCandidate,
} from "../src/lib/search-core";

loadEnv();

type Row = {
  id: string;
  externalId: string | null;
  title: string;
  displayTitle: string | null;
  adminDisplayTitleOverride: string | null;
  summary: string | null;
  adminSummaryOverride: string | null;
  companyRelevance: string | null;
  kodaPosition: string | null;
  sourceEvidence: string | null;
  excerpt: string | null;
  bodyText: string | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
  date: Date | null;
  year: number | null;
  reportYear: number | null;
  sourceDataset: string | null;
  sourceLayer: string | null;
  sourceTypeDetail: string | null;
  outcomeStatus: string | null;
  publicPriority: string | null;
  manualWeight: number;
  isEvergreen: boolean;
  canonicalContentId: string | null;
  duplicateStatus: string | null;
  contentHash: string | null;
  isPublic: boolean;
  isHidden: boolean;
  needsHumanReview: boolean;
  importStatus: string | null;
  publicDisplayStatus: string | null;
  adminVisibilityOverride: boolean | null;
  tags: { tag: { type: string; slug: string; name: string } }[];
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

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() || null : null;
}

function isOpinion(row: Row): boolean {
  return row.sourceTypeDetail === "meie_arvamus_article" || row.sourceLayer === "koda_public_opinion";
}

function isContext(row: Row): boolean {
  return row.sourceDataset === "annual_reports" || row.sourceLayer === "annual_report";
}

function groupOf(row: Row): string {
  if (row.sourceTypeDetail === "toovoit" || row.sourceLayer === "koda_achievement") return "toovoit";
  if (isContext(row) || row.sourceLayer === "koda_workgroup_context") return "kontekst";
  if (row.sourceTypeDetail === "meie_uudis" || row.sourceLayer === "koda_news") return "uudis";
  return "arvamus";
}

function tagSlugs(row: Row, type: string): string[] {
  return row.tags.filter((ct) => ct.tag.type === type).map((ct) => ct.tag.slug);
}

function hasSector(row: Row, sector: string): boolean {
  return tagSlugs(row, "tegevusala").includes(sector);
}

function toCandidate(row: Row): Candidate {
  const byType = (type: string) =>
    row.tags.filter((ct) => ct.tag.type === type).map((ct) => ({ slug: ct.tag.slug, name: ct.tag.name }));
  return {
    id: row.id,
    externalId: row.externalId,
    title: row.title,
    displayTitle: row.displayTitle,
    adminDisplayTitleOverride: row.adminDisplayTitleOverride,
    summary: row.summary,
    adminSummaryOverride: row.adminSummaryOverride,
    companyRelevance: row.companyRelevance,
    kodaPosition: row.kodaPosition,
    sourceEvidence: row.sourceEvidence,
    excerpt: row.excerpt,
    bodyText: row.bodyText,
    canonicalUrl: row.canonicalUrl,
    sourceUrl: row.sourceUrl,
    sourceDataset: row.sourceDataset,
    sourceLayer: row.sourceLayer,
    sourceTypeDetail: row.sourceTypeDetail,
    publicDisplayStatus: row.publicDisplayStatus,
    outcomeStatus: row.outcomeStatus,
    publicPriority: row.publicPriority,
    manualWeight: row.manualWeight,
    isEvergreen: row.isEvergreen,
    date: row.date,
    canonicalContentId: row.canonicalContentId,
    duplicateStatus: row.duplicateStatus,
    contentHash: row.contentHash,
    valdkonnad: byType("valdkond"),
    tegevusalad: byType("tegevusala"),
    tapsustused: byType("tapsustus"),
  };
}

function countBy(rows: Row[], pick: (row: Row) => string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row) || "(empty)";
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function printMap(label: string, map: Map<string, number>) {
  console.log(label);
  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${key}: ${count}`);
  }
}

async function main() {
  const sector = argValue("tegevusala") ?? argValue("sector");
  const { prisma } = await import("../src/lib/db");
  const rows: Row[] = await prisma.contentItem.findMany({
    select: {
      id: true,
      externalId: true,
      title: true,
      displayTitle: true,
      adminDisplayTitleOverride: true,
      summary: true,
      adminSummaryOverride: true,
      companyRelevance: true,
      kodaPosition: true,
      sourceEvidence: true,
      excerpt: true,
      bodyText: true,
      canonicalUrl: true,
      sourceUrl: true,
      date: true,
      year: true,
      reportYear: true,
      sourceDataset: true,
      sourceLayer: true,
      sourceTypeDetail: true,
      outcomeStatus: true,
      publicPriority: true,
      manualWeight: true,
      isEvergreen: true,
      canonicalContentId: true,
      duplicateStatus: true,
      contentHash: true,
      isPublic: true,
      isHidden: true,
      needsHumanReview: true,
      importStatus: true,
      publicDisplayStatus: true,
      adminVisibilityOverride: true,
      tags: { select: { tag: { select: { type: true, slug: true, name: true } } } },
    },
  });

  const publicRows = rows.filter(isPublicSearchEligible);
  const publicNews = publicRows.filter((row) => row.sourceTypeDetail === "meie_uudis" || row.sourceLayer === "koda_news");
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
  console.log(`public Koda news rows: ${publicNews.length}`);
  console.log(`public Koda news rows in 2026: ${publicNews.filter((row) => itemYear(row) === 2026).length}`);
  console.log(`public Koda news rows in late 2025: ${publicNews.filter(isLate2025).length}`);
  console.log(
    `public Koda news rows with tegevusala tags: ${
      publicNews.filter((row) => tagSlugs(row, "tegevusala").length > 0).length
    }`
  );
  console.log(
    `public Koda news rows with only generic tegevusala: ${
      publicNews.filter((row) => {
        const sectors = tagSlugs(row, "tegevusala");
        return sectors.length > 0 && sectors.every((slug) => slug.includes("koik-tegevusalad") || slug.includes("valdkondadeulene"));
      }).length
    }`
  );

  console.log("[freshness] public rows by year:");
  for (const [year, count] of [...publicByYear.entries()].sort((a, b) => b[0] - a[0])) {
    console.log(`  ${year}: ${count}`);
  }

  console.log("[freshness] public rows by source/year:");
  for (const [key, count] of [...publicBySourceYear.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    console.log(`  ${key}: ${count}`);
  }

  printMap("[freshness] public rows by sourceTypeDetail:", countBy(publicRows, (row) => row.sourceTypeDetail));

  if (sector) {
    const sectorRows = rows.filter((row) => hasSector(row, sector));
    const publicSectorRows = sectorRows.filter(isPublicSearchEligible);
    const broaderRelatedRows = publicRows.filter(
      (row) => !hasSector(row, sector) && getSectorRelevance(toCandidate(row), [sector]).matches > 0
    );
    const hiddenRelatedRows = rows.filter(
      (row) => !isPublicSearchEligible(row) && getSectorRelevance(toCandidate(row), [sector]).matches > 0
    );
    const hiddenSectorNews = sectorRows.filter(
      (row) =>
        (row.sourceTypeDetail === "meie_uudis" || row.sourceLayer === "koda_news") &&
        !isPublicSearchEligible(row)
    );
    console.log(`[sector:${sector}] total tagged rows=${sectorRows.length} public=${publicSectorRows.length}`);
    printMap(`[sector:${sector}] eligible by sourceDataset:`, countBy(publicSectorRows, (row) => row.sourceDataset));
    printMap(`[sector:${sector}] eligible by sourceLayer:`, countBy(publicSectorRows, (row) => row.sourceLayer));
    printMap(
      `[sector:${sector}] eligible by sourceTypeDetail:`,
      countBy(publicSectorRows, (row) => row.sourceTypeDetail)
    );
    printMap(`[sector:${sector}] eligible by result group:`, countBy(publicSectorRows, groupOf));
    printRow(`[sector:${sector}] latest news`, latest(publicSectorRows, (row) => row.sourceTypeDetail === "meie_uudis" || row.sourceLayer === "koda_news"));
    printRow(`[sector:${sector}] latest opinion`, latest(publicSectorRows, isOpinion));
    printRow(`[sector:${sector}] latest achievement`, latest(publicSectorRows, (row) => row.sourceTypeDetail === "toovoit" || row.sourceLayer === "koda_achievement"));
    printRow(`[sector:${sector}] latest context`, latest(publicSectorRows, isContext));
    console.log(`[sector:${sector}] Koda news rows: ${publicSectorRows.filter((row) => row.sourceTypeDetail === "meie_uudis" || row.sourceLayer === "koda_news").length}`);
    console.log(`[sector:${sector}] opinion rows: ${publicSectorRows.filter(isOpinion).length}`);
    console.log(`[sector:${sector}] achievement rows: ${publicSectorRows.filter((row) => row.sourceTypeDetail === "toovoit" || row.sourceLayer === "koda_achievement").length}`);
    console.log(`[sector:${sector}] annual/context rows: ${publicSectorRows.filter(isContext).length}`);
    console.log(`[sector:${sector}] hidden/review news rows: ${hiddenSectorNews.length}`);
    console.log(`[sector:${sector}] broader related public candidates: ${broaderRelatedRows.length}`);
    console.log(
      `[sector:${sector}] broader related generic-sector candidates: ${
        broaderRelatedRows.filter((row) => hasGenericSectorTag(toCandidate(row))).length
      }`
    );
    console.log(
      `[sector:${sector}] broader related Koda news candidates: ${
        broaderRelatedRows.filter((row) => row.sourceTypeDetail === "meie_uudis" || row.sourceLayer === "koda_news").length
      }`
    );
    console.log(`[sector:${sector}] broader related hidden/review candidates: ${hiddenRelatedRows.length}`);

    const q = parseSearchParams({ tegevusala: sector });
    const exactTop = publicSectorRows
      .map((row) => ({ row, score: scoreCandidate(toCandidate(row), q).total }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    console.log(`[sector:${sector}] top exact-tagged rows:`);
    for (const { row, score } of exactTop) {
      console.log(
        `  ${score} | ${groupOf(row)} | ${row.date?.toISOString().slice(0, 10) ?? "no date"} | ${
          row.sourceTypeDetail ?? "(empty)"
        } | ${row.sourceLayer ?? "(empty)"} | ${row.title}`
      );
    }

    console.log(`[sector:${sector}] broader related examples:`);
    for (const row of broaderRelatedRows.slice(0, 10)) {
      const rel = getSectorRelevance(toCandidate(row), [sector]);
      console.log(
        `  ${rel.topicMatches}/${rel.keywordMatches} | ${groupOf(row)} | ${
          row.date?.toISOString().slice(0, 10) ?? "no date"
        } | ${row.sourceTypeDetail ?? "(empty)"} | ${row.sourceLayer ?? "(empty)"} | ${row.title}`
      );
    }

    const { search } = await import("../src/lib/search");
    const results = await search(q);
    const top = [...results.achievements, ...results.positions, ...results.news, ...results.context]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    console.log(`[sector:${sector}] top 20 search rows:`);
    for (const row of top) {
      const raw = rows.find((r) => r.externalId === row.detailId || r.id === row.detailId || r.id === row.id);
      console.log(
        `  ${row.score} | ${row.kind} | ${row.date?.slice(0, 10) ?? "no date"} | ${
          raw?.sourceTypeDetail ?? "(empty)"
        } | ${raw?.sourceLayer ?? "(empty)"} | ${raw?.publicDisplayStatus ?? "(empty)"} | ${row.title}`
      );
    }
  }

  await prisma.$disconnect().catch(() => {});
}

main().catch((error) => {
  console.error("[freshness] audit failed:", error);
  process.exitCode = 1;
});

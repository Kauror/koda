/**
 * Read-only audit for public detail summaries. It reports public rows where
 * imported snippets look truncated or where the public detail page would fall
 * back to the source CTA because no safe summary can be selected.
 */
import { isPublicSearchEligible } from "../src/lib/eligibility";
import {
  firstCleanPublicParagraph,
  getPublicDetailSummary,
  isObviouslyTruncatedText,
} from "../src/lib/content-display";
import { loadEnv } from "./env";
import { makePrismaClient } from "./lib/prisma-client";

loadEnv();

async function main() {
  const { prisma, close } = await makePrismaClient();
  try {
    const rows = await prisma.contentItem.findMany({
      where: { OR: [{ isPublic: true }, { adminVisibilityOverride: true }] },
      select: {
        id: true,
        externalId: true,
        title: true,
        summary: true,
        adminSummaryOverride: true,
        companyRelevance: true,
        kodaPosition: true,
        sourceEvidence: true,
        excerpt: true,
        bodyText: true,
        canonicalUrl: true,
        sourceUrl: true,
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
      orderBy: [{ externalId: "asc" }, { title: "asc" }],
    });

    const findings = rows
      .filter(isPublicSearchEligible)
      .map((row) => {
        const truncatedFields = ["summary", "excerpt"]
          .filter((field) => isObviouslyTruncatedText(row[field as "summary" | "excerpt"]))
          .join(", ");
        const safeBodyParagraph = firstCleanPublicParagraph(row.bodyText);
        const safeSummary = getPublicDetailSummary(row);
        const issues = [
          truncatedFields && `truncated ${truncatedFields}`,
          !safeBodyParagraph && "missing/unsafe body paragraph",
          row.sourceDataset === "web" && row.canonicalUrl && !safeBodyParagraph && "public web URL has no safe body paragraph",
          !safeSummary && "detail falls back to source CTA only",
        ].filter(Boolean);
        return { row, safeSummary, issues };
      })
      .filter((item) => item.issues.length > 0);

    console.log(`[summary-audit] Checked ${rows.length} candidate row(s); findings: ${findings.length}`);
    for (const item of findings.slice(0, 80)) {
      const id = item.row.externalId ?? item.row.id;
      console.log(`- ${id}: ${item.row.title}`);
      console.log(`  issues: ${item.issues.join("; ")}`);
      console.log(`  safeSummary: ${item.safeSummary ? "yes" : "no"}`);
    }
    if (findings.length > 80) {
      console.log(`[summary-audit] ${findings.length - 80} more finding(s) omitted.`);
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

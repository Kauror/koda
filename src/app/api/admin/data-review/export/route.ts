import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminRoute";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const format = new URL(req.url).searchParams.get("format") || "jsonl";
  const rows = await prisma.dataReviewDecision.findMany({ orderBy: [{ reviewedAt: "desc" }, { updatedAt: "desc" }] });

  if (format === "csv") {
    const csv = [
      [
        "candidateId",
        "contentExternalId",
        "decision",
        "approvedValdkonnad",
        "approvedTegevusalad",
        "approvedTapsustused",
        "approvedPublicPriority",
        "approvedSectorWeight",
        "approvedTopicWeight",
        "approvedGeneralWeight",
        "reviewerName",
        "reviewerNote",
        "reviewedAt",
      ].join(","),
      ...rows.map((row) =>
        [
          row.candidateId,
          row.contentExternalId,
          row.decision,
          jsonText(row.approvedValdkonnad),
          jsonText(row.approvedTegevusalad),
          jsonText(row.approvedTapsustused),
          row.approvedPublicPriority,
          row.approvedSectorWeight,
          row.approvedTopicWeight,
          row.approvedGeneralWeight,
          row.reviewerName,
          row.reviewerNote,
          row.reviewedAt?.toISOString() ?? "",
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\n");
    return new NextResponse(`${csv}\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="koda-data-review-decisions.csv"',
      },
    });
  }

  const jsonl = rows
    .map((row) =>
      JSON.stringify({
        candidateId: row.candidateId,
        contentExternalId: row.contentExternalId,
        contentTitle: row.contentTitle,
        contentUrl: row.contentUrl,
        decision: row.decision,
        approvedValdkonnad: row.approvedValdkonnad,
        approvedTegevusalad: row.approvedTegevusalad,
        approvedTapsustused: row.approvedTapsustused,
        approvedPublicPriority: row.approvedPublicPriority,
        approvedSectorWeight: row.approvedSectorWeight,
        approvedTopicWeight: row.approvedTopicWeight,
        approvedGeneralWeight: row.approvedGeneralWeight,
        reviewerName: row.reviewerName,
        reviewerNote: row.reviewerNote,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
      }),
    )
    .join("\n");

  return new NextResponse(jsonl ? `${jsonl}\n` : "", {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": 'attachment; filename="koda-data-review-decisions.jsonl"',
    },
  });
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function jsonText(value: unknown): string {
  return value === null || value === undefined ? "" : JSON.stringify(value);
}

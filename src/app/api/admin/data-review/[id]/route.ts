import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { redirectTo, requireAdmin, str } from "@/lib/adminRoute";
import { findReviewCandidate, numberValue, stringValue } from "@/lib/admin-bundle";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = new Set(["approved", "rejected", "needs_review"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const candidateId = decodeURIComponent(id);
  const candidate = findReviewCandidate(candidateId);
  if (!candidate.ok) {
    return NextResponse.json({ error: candidate.error }, { status: 400 });
  }
  if (!candidate.data) {
    return NextResponse.json({ error: "Review candidate not found" }, { status: 404 });
  }

  const form = await req.formData();
  const decision = str(form, "decision") ?? "";
  if (!VALID_DECISIONS.has(decision)) {
    return NextResponse.json({ error: "Invalid review decision" }, { status: 400 });
  }

  await prisma.dataReviewDecision.upsert({
    where: { candidateId },
    create: {
      candidateId,
      contentExternalId: str(form, "contentExternalId") || candidate.data.contentId || null,
      contentTitle: str(form, "contentTitle") || candidate.data.title || null,
      contentUrl: str(form, "contentUrl") || candidate.data.url || null,
      decision,
      approvedValdkonnad: parseLines(form, "approvedValdkonnad"),
      approvedTegevusalad: parseLines(form, "approvedTegevusalad"),
      approvedTapsustused: parseLines(form, "approvedTapsustused"),
      approvedPublicPriority: intOrNull(form, "approvedPublicPriority"),
      approvedSectorWeight: numberValue(str(form, "approvedSectorWeight")),
      approvedTopicWeight: numberValue(str(form, "approvedTopicWeight")),
      approvedGeneralWeight: numberValue(str(form, "approvedGeneralWeight")),
      reviewerName: str(form, "reviewerName"),
      reviewerNote: str(form, "reviewerNote"),
      sourceCandidateJson: candidate.data as Prisma.InputJsonValue,
      reviewedAt: new Date(),
    },
    update: {
      contentExternalId: str(form, "contentExternalId") || candidate.data.contentId || null,
      contentTitle: str(form, "contentTitle") || candidate.data.title || null,
      contentUrl: str(form, "contentUrl") || candidate.data.url || null,
      decision,
      approvedValdkonnad: parseLines(form, "approvedValdkonnad"),
      approvedTegevusalad: parseLines(form, "approvedTegevusalad"),
      approvedTapsustused: parseLines(form, "approvedTapsustused"),
      approvedPublicPriority: intOrNull(form, "approvedPublicPriority"),
      approvedSectorWeight: numberValue(str(form, "approvedSectorWeight")),
      approvedTopicWeight: numberValue(str(form, "approvedTopicWeight")),
      approvedGeneralWeight: numberValue(str(form, "approvedGeneralWeight")),
      reviewerName: str(form, "reviewerName"),
      reviewerNote: str(form, "reviewerNote"),
      sourceCandidateJson: candidate.data as Prisma.InputJsonValue,
      reviewedAt: new Date(),
    },
  });

  return redirectTo(req, `/admin/data-review/${encodeURIComponent(candidateId)}?saved=1`);
}

function parseLines(form: FormData, key: string): Prisma.InputJsonValue {
  const value = stringValue(form.get(key));
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function intOrNull(form: FormData, key: string): number | null {
  const value = str(form, key);
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

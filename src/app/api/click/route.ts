import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/click { sessionId, contentItemId?, topicGroupId? }
 * Stores an anonymous result click for analytics.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "sessionId required" }, { status: 400 });
    }
    await prisma.searchResultClick.create({
      data: {
        searchSessionId: sessionId,
        contentItemId: typeof body.contentItemId === "string" ? body.contentItemId : null,
        topicGroupId: typeof body.topicGroupId === "string" ? body.topicGroupId : null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Failed to store click", e);
    // Analytics failures should not surface as user-visible errors.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { anonymizeIp, hashUserAgent } from "@/lib/hash";
import { parseSearchParams, search } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=maksud&valdkond=...&tegevusala=...&tapsustus=...&type=toovoit
 * Returns grouped, ranked merge-ready results (achievements / positions / context).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = Object.fromEntries(sp.entries());
  const query = parseSearchParams(params);

  let sessionId: string | null = null;
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const session = await prisma.searchSession.create({
      data: {
        // Reuse existing analytics columns: topics -> interests, sectors -> activities.
        selectedSector: query.tegevusala.join(",") || null,
        selectedInterests: query.valdkond,
        selectedActivities: query.tegevusala,
        anonymizedIpHash: anonymizeIp(ip),
        userAgentHash: hashUserAgent(req.headers.get("user-agent")),
      },
    });
    sessionId = session.id;
  } catch (e) {
    console.error("Failed to store search session", e);
  }

  const results = await search(query);
  return NextResponse.json({ sessionId, ...results });
}

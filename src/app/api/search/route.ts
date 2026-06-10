import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { anonymizeIp, hashUserAgent } from "@/lib/hash";
import { parseFilters, search } from "@/lib/ranking";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?sektor=toostus&suurus=10-49&huvid=maksud,energia&tegevused=eksport
 * Returns ranked topic groups and standalone items for the given filters.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = parseFilters({
    sektor: sp.get("sektor") ?? undefined,
    suurus: sp.get("suurus") ?? undefined,
    huvid: sp.get("huvid") ?? undefined,
    tegevused: sp.get("tegevused") ?? undefined,
  });

  let sessionId: string | null = null;
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const session = await prisma.searchSession.create({
      data: {
        selectedSector: filters.sectors.join(",") || null,
        selectedSize: filters.size,
        selectedInterests: filters.interests,
        selectedActivities: filters.activities,
        anonymizedIpHash: anonymizeIp(ip),
        userAgentHash: hashUserAgent(req.headers.get("user-agent")),
      },
    });
    sessionId = session.id;
  } catch (e) {
    console.error("Failed to store search session", e);
  }

  const results = await search(filters);
  return NextResponse.json({ sessionId, ...results });
}

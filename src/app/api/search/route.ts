import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { anonymizeIp, hashUserAgent } from "@/lib/hash";
import { parseSearchParams, search, type ResultCard } from "@/lib/search";

export const dynamic = "force-dynamic";

/** Internal ranking score must not be exposed to public API consumers. */
function publicCard({ score, ...rest }: ResultCard): Omit<ResultCard, "score"> {
  void score;
  return rest;
}

/**
 * GET /api/search?q=maksud&valdkond=...&tegevusala=...&tapsustus=...&type=toovoit
 * Returns grouped, ranked merge-ready results (achievements / positions / context).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // Preserve repeated params (e.g. ?tegevusala=a&tegevusala=b) as arrays;
  // Object.fromEntries would drop all but the last value.
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    params[key] = all.length > 1 ? all : all[0];
  }
  const query = parseSearchParams(params);

  const sessionPromise = (async () => {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    return prisma.searchSession.create({
      data: {
        // Reuse existing analytics columns: topics -> interests, sectors -> activities.
        selectedSector: query.tegevusala.join(",") || null,
        selectedInterests: query.valdkond,
        selectedActivities: query.tegevusala,
        anonymizedIpHash: anonymizeIp(ip),
        userAgentHash: hashUserAgent(req.headers.get("user-agent")),
      },
    });
  })().catch((e) => {
    console.error("Failed to store search session", e);
    return null;
  });

  const [session, results] = await Promise.all([sessionPromise, search(query)]);
  const sessionId = session?.id ?? null;
  return NextResponse.json({
    sessionId,
    ...results,
    achievements: results.achievements.map(publicCard),
    positions: results.positions.map(publicCard),
    news: results.news.map(publicCard),
    context: results.context.map(publicCard),
  });
}

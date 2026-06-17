import { prisma } from "./db";
import {
  SITE_TEXT_DEFAULTS,
  defaultSiteTextMap,
  missingSiteTextDefaults,
  resolveSiteTexts,
  type SiteTextMap,
} from "./site-text-defaults";

export async function getHomepageSiteTexts(): Promise<SiteTextMap> {
  try {
    const rows = await prisma.siteText.findMany({
      where: { key: { in: SITE_TEXT_DEFAULTS.map((item) => item.key) } },
      select: { key: true, valueEt: true },
    });
    return resolveSiteTexts(rows);
  } catch {
    console.warn("Failed to load site texts; using defaults.");
    return defaultSiteTextMap();
  }
}

export async function seedMissingSiteTexts({ overwrite = false } = {}): Promise<{
  created: number;
  updated: number;
  skipped: number;
}> {
  if (overwrite) {
    const existing = new Set((await prisma.siteText.findMany({ select: { key: true } })).map((row) => row.key));
    const results = await Promise.all(
      SITE_TEXT_DEFAULTS.map((item) =>
        prisma.siteText.upsert({
          where: { key: item.key },
          create: {
            key: item.key,
            valueEt: item.valueEt,
            description: item.description,
            group: item.group,
          },
          update: {
            valueEt: item.valueEt,
            description: item.description,
            group: item.group,
          },
        })
      )
    );
    return {
      created: results.filter((row) => !existing.has(row.key)).length,
      updated: results.filter((row) => existing.has(row.key)).length,
      skipped: 0,
    };
  }

  const existing = await prisma.siteText.findMany({ select: { key: true } });
  const missing = missingSiteTextDefaults(existing.map((row) => row.key));
  if (missing.length) {
    await prisma.siteText.createMany({
      data: missing.map((item) => ({
        key: item.key,
        valueEt: item.valueEt,
        description: item.description,
        group: item.group,
      })),
      skipDuplicates: true,
    });
  }
  return {
    created: missing.length,
    updated: 0,
    skipped: SITE_TEXT_DEFAULTS.length - missing.length,
  };
}

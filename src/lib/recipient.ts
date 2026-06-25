/**
 * Recipient / ministry metadata normalization (taxonomy v2.1.6).
 *
 * The recipient/ministry of a Koda opinion is METADATA, not topic taxonomy: it
 * is an advanced filter dimension and must never set or override topic_primary.
 * This helper normalizes historical/current/abbreviated ministry names to a
 * stable filter group, while the raw value is always preserved separately.
 *
 * Pure (no Prisma / no I/O).
 */
import { slugify } from "./slug";

export type RecipientType = "ministry" | "agency" | "parliament" | "government" | "eu" | "other";

export type NormalizedRecipient = {
  /** Verbatim input, preserved for display/audit. */
  raw: string;
  /** Canonical current name (best effort), else the cleaned raw value. */
  normalized: string;
  /** Stable bucket used for filtering (slug of the normalized name). */
  filterGroup: string | null;
  type: RecipientType;
  /** True when the normalization is uncertain and a human should confirm it. */
  reviewRequired: boolean;
};

/**
 * Canonical current ministry names keyed by a normalized lookup token. Includes
 * historical names and common abbreviations folded to the current ministry.
 * Extend as data requires — unknown values are kept verbatim and flagged for
 * review rather than guessed.
 */
const MINISTRY_CANONICAL: { canonical: string; aliases: string[] }[] = [
  {
    canonical: "Majandus- ja Kommunikatsiooniministeerium",
    aliases: ["mkm", "majandus- ja kommunikatsiooniministeerium", "majandusministeerium", "majandus- ja taristuministeerium", "ettevotlus- ja infotehnoloogiaminister", "majandus- ja kommunikatsiooniministeerium"],
  },
  {
    canonical: "Rahandusministeerium",
    aliases: ["rahandusministeerium", "rahmin", "rm"],
  },
  {
    canonical: "Justiits- ja Digiministeerium",
    aliases: ["justiitsministeerium", "justiits- ja digiministeerium", "jm", "justiitsminister"],
  },
  {
    canonical: "Kliimaministeerium",
    aliases: ["kliimaministeerium", "keskkonnaministeerium", "keskkonnaminister"],
  },
  {
    canonical: "Sotsiaalministeerium",
    aliases: ["sotsiaalministeerium", "sm", "sotsiaalkaitseminister", "tervise- ja toominister"],
  },
  {
    canonical: "Haridus- ja Teadusministeerium",
    aliases: ["haridus- ja teadusministeerium", "htm", "haridusministeerium"],
  },
  {
    canonical: "Siseministeerium",
    aliases: ["siseministeerium", "sisemin"],
  },
  {
    canonical: "Kaitseministeerium",
    aliases: ["kaitseministeerium", "kmin"],
  },
  {
    canonical: "Regionaal- ja Põllumajandusministeerium",
    aliases: ["regionaal- ja pollumajandusministeerium", "maaeluministeerium", "pollumajandusministeerium"],
  },
  {
    canonical: "Välisministeerium",
    aliases: ["valisministeerium", "vm"],
  },
  {
    canonical: "Kultuuriministeerium",
    aliases: ["kultuuriministeerium", "km"],
  },
  {
    canonical: "Riigikogu",
    aliases: ["riigikogu", "rk"],
  },
  {
    canonical: "Vabariigi Valitsus",
    aliases: ["vabariigi valitsus", "valitsus", "riigikantselei"],
  },
];

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const m of MINISTRY_CANONICAL) {
  for (const a of m.aliases) ALIAS_TO_CANONICAL.set(a.trim().toLowerCase(), m.canonical);
  ALIAS_TO_CANONICAL.set(m.canonical.trim().toLowerCase(), m.canonical);
}

function classify(name: string): RecipientType {
  const n = name.toLowerCase();
  if (n.includes("ministeerium") || n.includes("minister")) return "ministry";
  if (n.includes("riigikogu")) return "parliament";
  if (n.includes("valitsus") || n.includes("riigikantselei")) return "government";
  if (n.includes("amet") || n.includes("inspektsioon") || n.includes("keskus")) return "agency";
  if (n.includes("euroopa") || n.includes("komisjon") || n.startsWith("el ")) return "eu";
  return "other";
}

/**
 * Normalize a raw recipient string. If `explicit` overrides are supplied (from
 * recipient_normalized / recipient_filter_group / recipient_type columns), they
 * win over the derived values; otherwise the values are derived here.
 */
export function normalizeRecipient(
  raw: string | null | undefined,
  explicit?: { normalized?: string | null; filterGroup?: string | null; type?: string | null }
): NormalizedRecipient | null {
  const cleaned = (raw ?? "").trim();
  if (!cleaned && !explicit?.normalized) return null;

  const key = cleaned.toLowerCase();
  const mapped = ALIAS_TO_CANONICAL.get(key) ?? null;
  const normalized = (explicit?.normalized?.trim() || mapped || cleaned).trim();
  const filterGroup = explicit?.filterGroup?.trim()
    ? slugify(explicit.filterGroup)
    : normalized
      ? slugify(normalized)
      : null;
  const type = (explicit?.type?.trim()?.toLowerCase() as RecipientType) || classify(normalized);
  // Review needed when we could not confidently map a non-empty raw value and
  // no explicit normalized value was provided.
  const reviewRequired = !explicit?.normalized && !mapped && cleaned.length > 0;

  return { raw: cleaned, normalized, filterGroup, type, reviewRequired };
}

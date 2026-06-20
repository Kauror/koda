/**
 * Classification for staged Koda.ee pages. Reuses the app's existing law matcher
 * (law-match) rather than inventing a parallel taxonomy. Valdkond suggestions are
 * derived from the detected laws' related topics. Sector/täpsustus auto-detection
 * is intentionally deferred to human review (the curated taxonomy lives in the
 * data bundle / admin review), so those are returned empty for v1.
 *
 * Pure and null-safe: empty text never crashes.
 */
import { extractLawMentions, type LawMention } from "../law-match";
import { getLawBySlug } from "../law-dictionary";
import type { ParsedPage } from "./parse";

export type Classification = {
  detectedValdkonnad: string[];
  detectedTegevusalad: string[];
  detectedTapsustused: string[];
  detectedLaws: LawMention[];
  classificationConfidence: "high" | "medium" | "low";
};

export function classifyParsedPage(
  parsed: Pick<ParsedPage, "title" | "summary" | "bodyText" | "detectedSourceType">
): Classification {
  const laws = extractLawMentions({
    title: parsed.title,
    summary: parsed.summary,
    bodyText: parsed.bodyText,
  });

  // Confirmed (non-weak) laws suggest related valdkonnad.
  const valdkonnad = [
    ...new Set(
      laws
        .filter((law) => law.confidence !== "low")
        .flatMap((law) => getLawBySlug(law.slug)?.relatedValdkond ?? [])
    ),
  ];

  const hasStrongLaw = laws.some((law) => law.confidence !== "low");
  const knownType = parsed.detectedSourceType !== "other";
  const hasContent = Boolean(parsed.title && parsed.bodyText);

  let classificationConfidence: Classification["classificationConfidence"];
  if (knownType && hasContent) {
    classificationConfidence = hasStrongLaw ? "high" : "medium";
  } else if (knownType || hasContent) {
    classificationConfidence = "medium";
  } else {
    classificationConfidence = "low";
  }

  return {
    detectedValdkonnad: valdkonnad,
    detectedTegevusalad: [],
    detectedTapsustused: [],
    detectedLaws: laws,
    classificationConfidence,
  };
}

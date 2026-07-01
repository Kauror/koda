/**
 * User-friendly Estonian labels for the raw merge-ready field values. Pure,
 * source-based wording only (no AI-generated certainty). Reused by the public
 * detail page, result cards and evidence sections.
 */

/** Source-type label from sourceLayer / sourceTypeDetail. */
export function sourceLabel(layer: string | null, type: string | null): string {
  if (type === "toovoit" || layer === "koda_achievement") return "Töövõit";
  if (type === "meie_uudis" || layer === "koda_news") return "Koja uudis";
  if (type === "meie_arvamus_article" || layer === "koda_public_opinion") return "Koja seisukoht";
  if (type === "tooruhmad" || layer === "koda_workgroup_context") return "Töörühma taust";
  if (layer === "opinion_file") return "Koja arvamus";
  if (layer === "annual_report" || (type && type.startsWith("annual_report")))
    return "Aastaaruande kontekst";
  if (type === "listing_page" || type === "rss_feed" || layer === "koda_listing_or_archive")
    return "Koja veebileht";
  return "Koja materjal";
}

/** Dataset label. */
export function datasetLabel(dataset: string | null): string {
  switch (dataset) {
    case "web":
      return "Koda.ee veebisisu";
    case "opinions":
      return "Koja arvamuskiri";
    case "annual_reports":
      return "Koja aastaaruanne";
    case "toovoidud":
      return "Koja töövõit";
    default:
      return "Koja materjal";
  }
}

/** Outcome label. Returns null for values not worth surfacing to the user. */
export function outcomeLabel(status: string | null): string | null {
  switch (status) {
    case "achieved":
      return "Saavutatud";
    case "partially_achieved":
      return "Osaliselt saavutatud";
    case "ongoing":
      return "Töös";
    case "opposed":
      return "Koda oli vastu";
    case "warning":
      return "Koda juhtis riskile tähelepanu";
    case "proposed":
      return "Koda tegi ettepaneku";
    case "explanatory_context":
      return "Selgitav taust";
    case "service_context":
      return "Teenuse taust";
    default:
      return null; // outcome_unknown and unmapped → show nothing
  }
}

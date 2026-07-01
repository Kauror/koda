/**
 * Import opinion source-document (pöördumine PDF) mappings.
 *
 *   npm run import:source-documents
 *   npx tsx scripts/import-source-documents.ts \
 *     --manifest data/source-documents/opinions/source_documents_manifest.json \
 *     --pdf-root public/source-documents/opinions/pdf
 *
 * Reads the extraction manifest, verifies each PDF exists on disk, matches every
 * PDF to an opinion ContentItem (tiered, never guessing — see
 * src/lib/source-documents.ts), upserts SourceDocument rows keyed by the stable
 * source_document_id, and writes a transparent import report. Idempotent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { loadEnv } from "./env";
import { makePrismaClient } from "./lib/prisma-client";
import { matchDocument, isSupplementaryFilename, type OpinionRef } from "../src/lib/source-documents";

loadEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const MANIFEST_PATH = resolve(
  process.cwd(),
  arg("manifest") || process.env.SOURCE_DOCS_MANIFEST || "data/source-documents/opinions/source_documents_manifest.json"
);
const PDF_ROOT = resolve(
  process.cwd(),
  arg("pdf-root") || process.env.SOURCE_DOCS_PDF_ROOT || "public/source-documents/opinions/pdf"
);
const REPORT_DIR = resolve(process.cwd(), process.env.SOURCE_DOCS_REPORT_DIR || "data/source-documents/reports");
const PUBLIC_URL_BASE = "/source-documents/opinions/pdf";

type ManifestRow = {
  source_document_id: string;
  original_filename: string;
  pdf_filename: string;
  txt_filename?: string | null;
  pdf_relative_path: string;
  txt_relative_path?: string | null;
  pdf_sha256?: string | null;
  pdf_size_bytes?: number | null;
  page_count?: number | null;
  text_length?: number | null;
  extraction_status?: string | null;
  text_quality?: string | null;
  language?: string | null;
};

const csv = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(path: string, header: string[], rows: (string | number | null | undefined)[][]): void {
  const body = [header.join(","), ...rows.map((r) => r.map(csv).join(","))].join("\n") + "\n";
  writeFileSync(path, body, "utf8");
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ManifestRow[];
  if (!Array.isArray(manifest)) throw new Error("Manifest must be a JSON array");
  mkdirSync(REPORT_DIR, { recursive: true });

  const { prisma, close } = await makePrismaClient();
  const stats = {
    manifestRows: manifest.length,
    opinions: 0,
    exact: 0,
    parsed: 0,
    fuzzyLow: 0,
    ambiguous: 0,
    unmatchedManifest: 0,
    missingFiles: 0,
    linked: 0,
    created: 0,
    updated: 0,
    pruned: 0,
  };
  const matchRows: (string | number | null)[][] = [];
  const ambiguousRows: (string | number | null)[][] = [];
  const unmatchedManifestRows: (string | number | null)[][] = [];

  try {
    const opinionRows = await prisma.contentItem.findMany({
      where: { sourceDataset: "opinions" },
      select: { externalId: true, sourceFileName: true, title: true, date: true, recipientNormalized: true, recipientRaw: true },
    });
    const opinions: OpinionRef[] = opinionRows
      .filter((o): o is typeof o & { externalId: string } => !!o.externalId)
      .map((o) => ({
        externalId: o.externalId,
        sourceFileName: o.sourceFileName,
        title: o.title,
        date: o.date,
        recipientNormalized: o.recipientNormalized,
        recipientRaw: o.recipientRaw,
      }));
    stats.opinions = opinions.length;

    const existingIds = new Set((await prisma.sourceDocument.findMany({ select: { id: true } })).map((r) => r.id));
    const linkedExternalIds = new Set<string>();

    for (const row of manifest) {
      const filePath = join(PDF_ROOT, row.pdf_filename);
      const fileVerified = existsSync(filePath);
      if (!fileVerified) stats.missingFiles++;

      const result = matchDocument(row.original_filename, opinions);
      // Only high/medium confidence auto-links; low (fuzzy) and ambiguous are
      // reported for review and NOT linked — we never guess.
      let contentExternalId: string | null = null;
      let matchMethod = "none";
      let matchConfidence = "none";

      if (result.status === "matched") {
        matchMethod = result.method;
        matchConfidence = result.confidence;
        if (result.confidence === "high" || result.confidence === "medium") {
          contentExternalId = result.opinion.externalId;
          linkedExternalIds.add(result.opinion.externalId);
          stats.linked++;
          if (result.method === "exact_filename") stats.exact++;
          else stats.parsed++;
          matchRows.push([row.source_document_id, row.original_filename, result.opinion.externalId, result.method, result.confidence, fileVerified ? "yes" : "MISSING"]);
        } else {
          stats.fuzzyLow++;
          ambiguousRows.push([row.source_document_id, row.original_filename, "low_confidence_fuzzy", result.opinion.externalId, ""]);
        }
      } else if (result.status === "ambiguous") {
        stats.ambiguous++;
        matchMethod = result.tier;
        ambiguousRows.push([row.source_document_id, row.original_filename, `ambiguous_${result.tier}`, result.candidates.map((c) => c.externalId).join(" | "), ""]);
      } else {
        stats.unmatchedManifest++;
        unmatchedManifestRows.push([row.source_document_id, row.original_filename, fileVerified ? "yes" : "MISSING"]);
      }

      const data = {
        contentExternalId,
        kind: "opinion_pdf",
        originalFilename: row.original_filename,
        pdfFilename: row.pdf_filename,
        txtFilename: row.txt_filename ?? null,
        pdfUrl: `${PUBLIC_URL_BASE}/${row.pdf_filename}`,
        pdfRelativePath: row.pdf_relative_path,
        txtRelativePath: row.txt_relative_path ?? null,
        pdfSha256: row.pdf_sha256 ?? null,
        pdfSizeBytes: row.pdf_size_bytes ?? null,
        pageCount: row.page_count ?? null,
        textLength: row.text_length ?? null,
        extractionStatus: row.extraction_status ?? null,
        textQuality: row.text_quality ?? null,
        language: row.language ?? null,
        matchMethod,
        matchConfidence,
        isPrimary: !isSupplementaryFilename(row.original_filename),
        fileVerified,
      };
      await prisma.sourceDocument.upsert({ where: { id: row.source_document_id }, create: { id: row.source_document_id, ...data }, update: data });
      if (existingIds.has(row.source_document_id)) stats.updated++;
      else stats.created++;
    }

    // Prune opinion_pdf rows no longer in the manifest (manifest is authoritative).
    const manifestIds = manifest.map((r) => r.source_document_id);
    stats.pruned = (await prisma.sourceDocument.deleteMany({ where: { kind: "opinion_pdf", id: { notIn: manifestIds } } })).count;

    // Opinions with no linked PDF.
    const unmatchedOpinions = opinions.filter((o) => !linkedExternalIds.has(o.externalId));

    writeCsv(join(REPORT_DIR, "source_document_import_matches.csv"),
      ["source_document_id", "original_filename", "opinion_external_id", "match_method", "confidence", "file"], matchRows);
    writeCsv(join(REPORT_DIR, "source_document_import_ambiguous_matches.csv"),
      ["source_document_id", "original_filename", "reason", "candidate_external_ids", "notes"], ambiguousRows);
    writeCsv(join(REPORT_DIR, "source_document_import_unmatched_manifest.csv"),
      ["source_document_id", "original_filename", "file"], unmatchedManifestRows);
    writeCsv(join(REPORT_DIR, "source_document_import_unmatched_opinions.csv"),
      ["opinion_external_id", "title", "date", "recipient"],
      unmatchedOpinions.map((o) => [o.externalId, o.title, o.date ? o.date.toISOString().slice(0, 10) : "", o.recipientNormalized ?? o.recipientRaw ?? ""]));

    const md = [
      "# Opinion source-document import report", "",
      `Generated: ${new Date().toISOString()}`, "",
      "## Totals", "",
      `- Manifest rows: ${stats.manifestRows}`,
      `- Opinion content items: ${stats.opinions}`,
      `- Exact-filename matches: ${stats.exact}`,
      `- Parsed date/recipient/title matches: ${stats.parsed}`,
      `- Linked (high/medium, auto): ${stats.linked}`,
      `- Low-confidence fuzzy (review, not linked): ${stats.fuzzyLow}`,
      `- Ambiguous (review, not linked): ${stats.ambiguous}`,
      `- Unmatched PDFs: ${stats.unmatchedManifest}`,
      `- Unmatched opinions: ${unmatchedOpinions.length}`,
      `- Broken/missing PDF files: ${stats.missingFiles}`,
      `- SourceDocument rows created: ${stats.created}`,
      `- SourceDocument rows updated: ${stats.updated}`,
      `- SourceDocument rows pruned: ${stats.pruned}`, "",
      "## Report files", "",
      "- `source_document_import_matches.csv`",
      "- `source_document_import_ambiguous_matches.csv`",
      "- `source_document_import_unmatched_manifest.csv`",
      "- `source_document_import_unmatched_opinions.csv`", "",
      `PDF root: \`${PDF_ROOT}\`${stats.missingFiles ? "  ⚠ some PDFs missing" : ""}`, "",
    ].join("\n");
    writeFileSync(join(REPORT_DIR, "source_document_import_report.md"), md, "utf8");

    console.log(
      `[source-documents] manifest=${stats.manifestRows} opinions=${stats.opinions} linked=${stats.linked} ` +
        `(exact=${stats.exact} parsed=${stats.parsed}) fuzzyLow=${stats.fuzzyLow} ambiguous=${stats.ambiguous} ` +
        `unmatchedPDFs=${stats.unmatchedManifest} unmatchedOpinions=${unmatchedOpinions.length} missingFiles=${stats.missingFiles} ` +
        `created=${stats.created} updated=${stats.updated} pruned=${stats.pruned}`
    );
    console.log(`[source-documents] report → ${REPORT_DIR}`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

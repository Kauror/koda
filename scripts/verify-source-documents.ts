/**
 * PGlite end-to-end verification for opinion source-document (PDF) linking.
 *
 *   KODA_DB_DRIVER=pglite KODA_PGLITE_DIR=.pglite-sd npm run db:setup:pglite
 *   KODA_DB_DRIVER=pglite KODA_PGLITE_DIR=.pglite-sd npm run source-docs:verify
 *
 * Self-contained: seeds its own opinion rows + SourceDocument rows (no import or
 * PDF files needed), asserts the public read path (detail + search card), then
 * cleans up. Proves: "Vaata pöördumist" shows for a matched+verified opinion,
 * uses the public PDF url (not txt), is separate from related content, and is
 * absent for an unmatched opinion or an unverified file (never a broken link).
 */
import { prisma } from "../src/lib/db";
import { getContentDetail } from "../src/lib/content-detail";
import { search } from "../src/lib/search";

let failed = 0;
function ok(name: string, cond: boolean) {
  console.log(`  ${cond ? "ok  " : "FAIL"}- ${name}`);
  if (!cond) failed++;
}

const IDS = ["SDVERIFY-LINKED", "SDVERIFY-UNVERIFIED", "SDVERIFY-NONE"];

async function cleanup() {
  await prisma.sourceDocument.deleteMany({ where: { id: { startsWith: "SDVERIFY-DOC" } } });
  await prisma.contentItem.deleteMany({ where: { externalId: { in: IDS } } });
}

async function main() {
  await cleanup();

  // Three public opinions: one with a verified PDF, one whose PDF is missing on
  // disk (unverified), one with no source document at all.
  await prisma.contentItem.createMany({
    data: IDS.map((externalId, i) => ({
      externalId,
      title: `Arvamus varjumiskoha teemal ${i}`,
      summary: "Koja seisukoht.",
      isPublic: true,
      sourceDataset: "opinions" as const,
      sourceLayer: "koda_public_opinion",
      sourceTypeDetail: "meie_arvamus_article",
      sourceType: "opinion" as const,
      date: new Date("2024-01-0" + (i + 1)),
    })),
  });

  const baseDoc = {
    kind: "opinion_pdf",
    originalFilename: "2024-01-01 - Ministeerium - Arvamus.pdf",
    pdfRelativePath: "pdf/X.pdf",
    matchMethod: "exact_filename",
    matchConfidence: "high",
    isPrimary: true,
  };
  await prisma.sourceDocument.create({
    data: { id: "SDVERIFY-DOC-1", contentExternalId: "SDVERIFY-LINKED", pdfFilename: "SDVERIFY-1.pdf", pdfUrl: "/source-documents/opinions/pdf/SDVERIFY-1.pdf", txtFilename: "SDVERIFY-1.txt", fileVerified: true, ...baseDoc },
  });
  await prisma.sourceDocument.create({
    data: { id: "SDVERIFY-DOC-2", contentExternalId: "SDVERIFY-UNVERIFIED", pdfFilename: "SDVERIFY-2.pdf", pdfUrl: "/source-documents/opinions/pdf/SDVERIFY-2.pdf", fileVerified: false, ...baseDoc },
  });

  // Detail page (matched + verified).
  const linked = await getContentDetail("SDVERIFY-LINKED");
  ok("detail resolves for the opinion", !!linked);
  ok("shows Vaata pöördumist url (public pdf path)", linked?.sourcePdf?.url === "/source-documents/opinions/pdf/SDVERIFY-1.pdf");
  ok("uses the PDF, not the TXT", !!linked?.sourcePdf && !linked.sourcePdf.url.endsWith(".txt"));
  ok("PDF is NOT in the related/evidence layer", !JSON.stringify(linked?.evidence).includes("SDVERIFY-1.pdf"));

  // Unverified file → never a broken link.
  const unverified = await getContentDetail("SDVERIFY-UNVERIFIED");
  ok("unverified (missing on disk) → no sourcePdf", unverified?.sourcePdf == null);

  // No source document → no link.
  const none = await getContentDetail("SDVERIFY-NONE");
  ok("opinion without a PDF → no sourcePdf (no broken link)", none?.sourcePdf == null);

  // Search cards.
  const res = await search({ q: "varjumiskoha", valdkond: [], tegevusala: [], tapsustus: [], recipient: [], type: [] });
  const cards = [...res.opinionNews, ...res.positions];
  const linkedCard = cards.find((c) => c.detailId === "SDVERIFY-LINKED");
  const unverifiedCard = cards.find((c) => c.detailId === "SDVERIFY-UNVERIFIED");
  ok("opinion card carries sourcePdfUrl for a verified PDF", linkedCard?.sourcePdfUrl === "/source-documents/opinions/pdf/SDVERIFY-1.pdf");
  ok("opinion card has no sourcePdfUrl when unverified", !unverifiedCard || !unverifiedCard.sourcePdfUrl);

  await cleanup();
  console.log(failed === 0 ? "\n[verify] source-documents: PASS" : `\n[verify] source-documents: FAIL (${failed})`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});

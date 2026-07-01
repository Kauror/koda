-- Public source-document (opinion pöördumine PDF) linked to an opinion by the
-- stable externalId (no FK to ContentItem), so it survives the destructive
-- content re-import. Populated by scripts/import-source-documents.ts.

CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "contentExternalId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'opinion_pdf',
    "originalFilename" TEXT NOT NULL,
    "pdfFilename" TEXT NOT NULL,
    "txtFilename" TEXT,
    "pdfUrl" TEXT NOT NULL,
    "pdfRelativePath" TEXT NOT NULL,
    "txtRelativePath" TEXT,
    "pdfSha256" TEXT,
    "pdfSizeBytes" INTEGER,
    "pageCount" INTEGER,
    "textLength" INTEGER,
    "extractionStatus" TEXT,
    "textQuality" TEXT,
    "language" TEXT,
    "matchMethod" TEXT,
    "matchConfidence" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "fileVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceDocument_contentExternalId_idx" ON "SourceDocument"("contentExternalId");
CREATE INDEX "SourceDocument_kind_idx" ON "SourceDocument"("kind");
CREATE INDEX "SourceDocument_pdfSha256_idx" ON "SourceDocument"("pdfSha256");

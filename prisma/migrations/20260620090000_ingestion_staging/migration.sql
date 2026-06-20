-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionStagingItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "source" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "contentHash" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "bodyText" TEXT,
    "publishedAt" TIMESTAMP(3),
    "detectedSourceType" TEXT,
    "detectedValdkonnad" JSONB,
    "detectedTegevusalad" JSONB,
    "detectedTapsustused" JSONB,
    "detectedLaws" JSONB,
    "classificationConfidence" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'new',
    "matchedContentItemId" TEXT,
    "rawMetadata" JSONB,
    "fetchStatus" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionStagingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionRun_source_idx" ON "IngestionRun"("source");
CREATE INDEX "IngestionRun_status_idx" ON "IngestionRun"("status");
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionStagingItem_urlHash_key" ON "IngestionStagingItem"("urlHash");
CREATE INDEX "IngestionStagingItem_reviewStatus_idx" ON "IngestionStagingItem"("reviewStatus");
CREATE INDEX "IngestionStagingItem_detectedSourceType_idx" ON "IngestionStagingItem"("detectedSourceType");
CREATE INDEX "IngestionStagingItem_publishedAt_idx" ON "IngestionStagingItem"("publishedAt");
CREATE INDEX "IngestionStagingItem_runId_idx" ON "IngestionStagingItem"("runId");
CREATE INDEX "IngestionStagingItem_canonicalUrl_idx" ON "IngestionStagingItem"("canonicalUrl");

-- AddForeignKey
ALTER TABLE "IngestionStagingItem" ADD CONSTRAINT "IngestionStagingItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

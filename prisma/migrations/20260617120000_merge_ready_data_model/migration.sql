-- CreateEnum
CREATE TYPE "SourceDataset" AS ENUM ('web', 'opinions', 'annual_reports');

-- CreateEnum
CREATE TYPE "EvidenceLinkType" AS ENUM ('supporting_opinion', 'annual_context', 'topic_history', 'duplicate_canonical', 'achievement_enrichment');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TagType" ADD VALUE 'valdkond';
ALTER TYPE "TagType" ADD VALUE 'tegevusala';
ALTER TYPE "TagType" ADD VALUE 'tapsustus';

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "canonicalContentId" TEXT,
ADD COLUMN     "companyRelevance" TEXT,
ADD COLUMN     "duplicateStatus" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "extractionQuality" TEXT,
ADD COLUMN     "importStatus" TEXT,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kodaPosition" TEXT,
ADD COLUMN     "mergeNotes" TEXT,
ADD COLUMN     "mergeReadiness" TEXT,
ADD COLUMN     "needsHumanReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outcomeStatus" TEXT,
ADD COLUMN     "primaryCategory" TEXT,
ADD COLUMN     "publicDisplayStatus" TEXT,
ADD COLUMN     "publicPriority" TEXT,
ADD COLUMN     "reportYear" INTEGER,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "secondaryCategories" TEXT,
ADD COLUMN     "sourceDataset" "SourceDataset",
ADD COLUMN     "sourceEvidence" TEXT,
ADD COLUMN     "sourceFileName" TEXT,
ADD COLUMN     "sourceLayer" TEXT,
ADD COLUMN     "sourcePageLocation" TEXT,
ADD COLUMN     "sourceSection" TEXT,
ADD COLUMN     "sourceTypeDetail" TEXT,
ADD COLUMN     "topicGroupCandidate" TEXT,
ADD COLUMN     "year" INTEGER,
ALTER COLUMN "sourceUrl" DROP NOT NULL,
ALTER COLUMN "canonicalUrl" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ContentEvidenceLink" (
    "id" TEXT NOT NULL,
    "fromContentId" TEXT NOT NULL,
    "toContentId" TEXT NOT NULL,
    "linkType" "EvidenceLinkType" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementEnrichment" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "standaloneAchievementId" TEXT,
    "matchKey" TEXT,
    "matchPriority" TEXT,
    "enrichmentStatus" TEXT,
    "rowMergeRole" TEXT,
    "numericImpactStatement" TEXT,
    "kodaRole" TEXT,
    "valueType" TEXT,
    "affectedCompanyTypes" TEXT,
    "affectedBusinessFunctions" TEXT,
    "regulatoryArea" TEXT,
    "primaryTopic" TEXT,
    "secondaryTopics" TEXT,
    "outcomeStatus" TEXT,
    "confidence" TEXT,
    "sourceEvidence" TEXT,
    "indexNote" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AchievementEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentEvidenceLink_toContentId_idx" ON "ContentEvidenceLink"("toContentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentEvidenceLink_fromContentId_toContentId_linkType_key" ON "ContentEvidenceLink"("fromContentId", "toContentId", "linkType");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementEnrichment_contentItemId_key" ON "AchievementEnrichment"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_externalId_key" ON "ContentItem"("externalId");

-- CreateIndex
CREATE INDEX "ContentItem_isPublic_idx" ON "ContentItem"("isPublic");

-- CreateIndex
CREATE INDEX "ContentItem_sourceDataset_idx" ON "ContentItem"("sourceDataset");

-- CreateIndex
CREATE INDEX "ContentItem_sourceLayer_idx" ON "ContentItem"("sourceLayer");

-- AddForeignKey
ALTER TABLE "ContentEvidenceLink" ADD CONSTRAINT "ContentEvidenceLink_fromContentId_fkey" FOREIGN KEY ("fromContentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentEvidenceLink" ADD CONSTRAINT "ContentEvidenceLink_toContentId_fkey" FOREIGN KEY ("toContentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementEnrichment" ADD CONSTRAINT "AchievementEnrichment_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New structured v0.9.4/v0.9.1 content package.
ALTER TYPE "SourceDataset" ADD VALUE 'toovoidud';
ALTER TYPE "TagType" ADD VALUE 'oigusakt';

ALTER TABLE "ContentItem"
ADD COLUMN "importAction" TEXT,
ADD COLUMN "publicDisplayAllowed" BOOLEAN,
ADD COLUMN "publicDisplayRole" TEXT,
ADD COLUMN "numericClaimNeedsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sourceQualityFlag" TEXT,
ADD COLUMN "classificationConfidence" TEXT,
ADD COLUMN "topicPrimary" TEXT,
ADD COLUMN "topicSecondary" TEXT,
ADD COLUMN "activityPrimary" TEXT,
ADD COLUMN "activitySecondary" TEXT,
ADD COLUMN "sectorScope" TEXT,
ADD COLUMN "situationTags" TEXT,
ADD COLUMN "lawTagsConfirmed" TEXT,
ADD COLUMN "lawTagsCandidate" TEXT,
ADD COLUMN "lawSearchAllowed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ContentItem_importAction_idx" ON "ContentItem"("importAction");
CREATE INDEX "ContentItem_publicDisplayAllowed_idx" ON "ContentItem"("publicDisplayAllowed");
CREATE INDEX "ContentItem_lawSearchAllowed_idx" ON "ContentItem"("lawSearchAllowed");

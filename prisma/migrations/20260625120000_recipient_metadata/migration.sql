-- Recipient / ministry metadata (taxonomy v2.1.6). Additive, nullable columns:
-- metadata-only advanced-filter dimension that never affects topic classification.
ALTER TABLE "ContentItem"
ADD COLUMN "recipientRaw" TEXT,
ADD COLUMN "recipientNormalized" TEXT,
ADD COLUMN "recipientFilterGroup" TEXT,
ADD COLUMN "recipientType" TEXT,
ADD COLUMN "recipientSecondary" TEXT,
ADD COLUMN "recipientNormalizationReviewRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ContentItem_recipientFilterGroup_idx" ON "ContentItem"("recipientFilterGroup");

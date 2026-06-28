-- v1.2 töövõidud nesting / timeline fields.
-- All columns are nullable so existing rows (and non-töövõit layers) are unaffected.

ALTER TABLE "ContentItem" ADD COLUMN "rowOrigin" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "displayType" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "parentToovoitId" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "parentCandidateId" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "policyThreadKey" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "policyThreadTitle" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "timelineYear" INTEGER;
ALTER TABLE "ContentItem" ADD COLUMN "timelineStage" TEXT;

CREATE INDEX "ContentItem_parentToovoitId_idx" ON "ContentItem"("parentToovoitId");
CREATE INDEX "ContentItem_policyThreadKey_idx" ON "ContentItem"("policyThreadKey");

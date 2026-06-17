-- AlterTable: admin-owned override fields. The merge-ready import never writes
-- these, so admin edits survive re-imports (source-owned vs admin-owned split).
ALTER TABLE "ContentItem" ADD COLUMN     "adminDisplayTitleOverride" TEXT,
ADD COLUMN     "adminSummaryOverride" TEXT,
ADD COLUMN     "adminVisibilityOverride" BOOLEAN,
ADD COLUMN     "adminReviewNote" TEXT;

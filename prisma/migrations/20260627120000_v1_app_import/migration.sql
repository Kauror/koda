-- v1 app-import data model (koda_*_v1 slim sheets + koda_content_links_v1.xlsx).
-- All additive, nullable columns + new EvidenceLinkType enum values + link metadata.

-- New cross-layer relation types used by public_related_links.
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'same_policy_thread';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'public_explanation';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'achieved_result';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'source_evidence';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'related_work_win';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'related_opinion';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'related_news';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'background_context';

-- v1 ContentItem fields.
ALTER TABLE "ContentItem"
ADD COLUMN "contentRoleFinal" TEXT,
ADD COLUMN "publicActivityFilterTags" TEXT,
ADD COLUMN "publicActivityDisplayTags" TEXT,
ADD COLUMN "publicSectorPageAllowed" TEXT,
ADD COLUMN "sectorResultEligibility" TEXT,
ADD COLUMN "generalSearchEligibility" TEXT,
ADD COLUMN "recommendedAppVisibilityFinal" TEXT,
ADD COLUMN "publicSectorRankScore" INTEGER,
ADD COLUMN "generalSearchRankScore" INTEGER,
ADD COLUMN "displayDatePrecision" TEXT,
ADD COLUMN "dateConfidence" TEXT,
ADD COLUMN "dateBasis" TEXT,
ADD COLUMN "effectiveDate" TIMESTAMP(3),
ADD COLUMN "deadlineDate" TIMESTAMP(3),
ADD COLUMN "whatChangedEt" TEXT,
ADD COLUMN "kodaRoleEt" TEXT,
ADD COLUMN "businessValueEt" TEXT,
ADD COLUMN "beforeAfterEt" TEXT,
ADD COLUMN "workWinTypePrimary" TEXT,
ADD COLUMN "workWinTypeSecondary" TEXT,
ADD COLUMN "canonicalPolicyThreadId" TEXT,
ADD COLUMN "policyThreadId" TEXT;

CREATE INDEX "ContentItem_canonicalPolicyThreadId_idx" ON "ContentItem"("canonicalPolicyThreadId");

-- v1 ContentEvidenceLink relation metadata.
ALTER TABLE "ContentEvidenceLink"
ADD COLUMN "relationRole" TEXT,
ADD COLUMN "relationLabelEt" TEXT,
ADD COLUMN "linkConfidence" TEXT,
ADD COLUMN "linkBasis" TEXT,
ADD COLUMN "canonicalPolicyThreadId" TEXT,
ADD COLUMN "sortPriority" INTEGER;

CREATE INDEX "ContentEvidenceLink_canonicalPolicyThreadId_idx" ON "ContentEvidenceLink"("canonicalPolicyThreadId");

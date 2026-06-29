-- v1/v1.2 app-import contract, admin draft/publish workflow and related-link metadata.

ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'related_opinion';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'related_work_win';
ALTER TYPE "EvidenceLinkType" ADD VALUE IF NOT EXISTS 'related_news';

ALTER TABLE "ContentItem"
  ADD COLUMN IF NOT EXISTS "contentRoleFinal" TEXT,
  ADD COLUMN IF NOT EXISTS "publicActivityFilterTags" TEXT,
  ADD COLUMN IF NOT EXISTS "publicActivityDisplayTags" TEXT,
  ADD COLUMN IF NOT EXISTS "publicSectorPageAllowed" TEXT,
  ADD COLUMN IF NOT EXISTS "sectorResultEligibility" TEXT,
  ADD COLUMN IF NOT EXISTS "generalSearchEligibility" TEXT,
  ADD COLUMN IF NOT EXISTS "recommendedAppVisibilityFinal" TEXT,
  ADD COLUMN IF NOT EXISTS "publicSectorRankScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "generalSearchRankScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "displayDatePrecision" TEXT,
  ADD COLUMN IF NOT EXISTS "dateConfidence" TEXT,
  ADD COLUMN IF NOT EXISTS "dateBasis" TEXT,
  ADD COLUMN IF NOT EXISTS "effectiveDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deadlineDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatChangedEt" TEXT,
  ADD COLUMN IF NOT EXISTS "kodaRoleEt" TEXT,
  ADD COLUMN IF NOT EXISTS "businessValueEt" TEXT,
  ADD COLUMN IF NOT EXISTS "beforeAfterEt" TEXT,
  ADD COLUMN IF NOT EXISTS "workWinTypePrimary" TEXT,
  ADD COLUMN IF NOT EXISTS "workWinTypeSecondary" TEXT,
  ADD COLUMN IF NOT EXISTS "canonicalPolicyThreadId" TEXT,
  ADD COLUMN IF NOT EXISTS "policyThreadId" TEXT,
  ADD COLUMN IF NOT EXISTS "rowOrigin" TEXT,
  ADD COLUMN IF NOT EXISTS "displayType" TEXT,
  ADD COLUMN IF NOT EXISTS "parentToovoitId" TEXT,
  ADD COLUMN IF NOT EXISTS "parentCandidateId" TEXT,
  ADD COLUMN IF NOT EXISTS "policyThreadKey" TEXT,
  ADD COLUMN IF NOT EXISTS "policyThreadTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "timelineYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "timelineStage" TEXT,
  ADD COLUMN IF NOT EXISTS "adminTextOverride" TEXT,
  ADD COLUMN IF NOT EXISTS "adminHiddenReason" TEXT;

ALTER TABLE "ContentEvidenceLink"
  ADD COLUMN IF NOT EXISTS "relationLabelEt" TEXT,
  ADD COLUMN IF NOT EXISTS "relationRole" TEXT,
  ADD COLUMN IF NOT EXISTS "linkConfidence" TEXT,
  ADD COLUMN IF NOT EXISTS "linkBasis" TEXT,
  ADD COLUMN IF NOT EXISTS "canonicalPolicyThreadId" TEXT,
  ADD COLUMN IF NOT EXISTS "sortPriority" INTEGER;

CREATE TABLE IF NOT EXISTS "AdminContentOverride" (
  "id" TEXT NOT NULL,
  "contentExternalId" TEXT NOT NULL,
  "contentItemId" TEXT,
  "titleOverride" TEXT,
  "summaryOverride" TEXT,
  "textOverride" TEXT,
  "visibilityOverride" BOOLEAN,
  "hiddenReason" TEXT,
  "topicPrimary" TEXT,
  "topicSecondary" TEXT,
  "activityPrimary" TEXT,
  "activitySecondary" TEXT,
  "publicActivityFilterTags" TEXT,
  "publicActivityDisplayTags" TEXT,
  "publicSectorPageAllowed" TEXT,
  "updatedBy" TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminContentOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminContentDraft" (
  "id" TEXT NOT NULL,
  "contentExternalId" TEXT NOT NULL,
  "contentItemId" TEXT,
  "titleOverride" TEXT,
  "summaryOverride" TEXT,
  "textOverride" TEXT,
  "visibilityOverride" BOOLEAN,
  "hiddenReason" TEXT,
  "topicPrimary" TEXT,
  "topicSecondary" TEXT,
  "activityPrimary" TEXT,
  "activitySecondary" TEXT,
  "publicActivityFilterTags" TEXT,
  "publicActivityDisplayTags" TEXT,
  "publicSectorPageAllowed" TEXT,
  "reviewerNote" TEXT,
  "updatedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminContentDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminPublishRun" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'started',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "actor" TEXT,
  "validationJson" JSONB,
  "reportJson" JSONB,
  "backupName" TEXT,
  "errorSummary" TEXT,
  CONSTRAINT "AdminPublishRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "contentExternalId" TEXT,
  "contentItemId" TEXT,
  "oldValues" JSONB,
  "newValues" JSONB,
  "actor" TEXT,
  "publishRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminContentOverride_contentExternalId_key" ON "AdminContentOverride"("contentExternalId");
CREATE INDEX IF NOT EXISTS "AdminContentOverride_contentExternalId_idx" ON "AdminContentOverride"("contentExternalId");
CREATE INDEX IF NOT EXISTS "AdminContentOverride_visibilityOverride_idx" ON "AdminContentOverride"("visibilityOverride");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminContentDraft_contentExternalId_key" ON "AdminContentDraft"("contentExternalId");
CREATE INDEX IF NOT EXISTS "AdminContentDraft_contentExternalId_idx" ON "AdminContentDraft"("contentExternalId");
CREATE INDEX IF NOT EXISTS "AdminContentDraft_publishedAt_idx" ON "AdminContentDraft"("publishedAt");

CREATE INDEX IF NOT EXISTS "AdminPublishRun_kind_idx" ON "AdminPublishRun"("kind");
CREATE INDEX IF NOT EXISTS "AdminPublishRun_status_idx" ON "AdminPublishRun"("status");
CREATE INDEX IF NOT EXISTS "AdminPublishRun_startedAt_idx" ON "AdminPublishRun"("startedAt");

CREATE INDEX IF NOT EXISTS "AdminAuditLog_contentExternalId_idx" ON "AdminAuditLog"("contentExternalId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_publishRunId_idx" ON "AdminAuditLog"("publishRunId");

CREATE INDEX IF NOT EXISTS "ContentItem_canonicalPolicyThreadId_idx" ON "ContentItem"("canonicalPolicyThreadId");
CREATE INDEX IF NOT EXISTS "ContentItem_policyThreadKey_idx" ON "ContentItem"("policyThreadKey");
CREATE INDEX IF NOT EXISTS "ContentItem_parentToovoitId_idx" ON "ContentItem"("parentToovoitId");
CREATE INDEX IF NOT EXISTS "ContentItem_parentCandidateId_idx" ON "ContentItem"("parentCandidateId");
CREATE INDEX IF NOT EXISTS "ContentItem_displayType_idx" ON "ContentItem"("displayType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AdminContentDraft_contentItemId_fkey'
  ) THEN
    ALTER TABLE "AdminContentDraft"
      ADD CONSTRAINT "AdminContentDraft_contentItemId_fkey"
      FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AdminAuditLog_publishRunId_fkey'
  ) THEN
    ALTER TABLE "AdminAuditLog"
      ADD CONSTRAINT "AdminAuditLog_publishRunId_fkey"
      FOREIGN KEY ("publishRunId") REFERENCES "AdminPublishRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

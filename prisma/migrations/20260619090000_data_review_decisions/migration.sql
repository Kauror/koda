CREATE TABLE "DataReviewDecision" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "contentExternalId" TEXT,
    "contentTitle" TEXT,
    "contentUrl" TEXT,
    "decision" TEXT NOT NULL,
    "approvedValdkonnad" JSONB,
    "approvedTegevusalad" JSONB,
    "approvedTapsustused" JSONB,
    "approvedPublicPriority" INTEGER,
    "approvedSectorWeight" DOUBLE PRECISION,
    "approvedTopicWeight" DOUBLE PRECISION,
    "approvedGeneralWeight" DOUBLE PRECISION,
    "reviewerName" TEXT,
    "reviewerNote" TEXT,
    "sourceCandidateJson" JSONB NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataReviewDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataReviewDecision_candidateId_key" ON "DataReviewDecision"("candidateId");
CREATE INDEX "DataReviewDecision_decision_idx" ON "DataReviewDecision"("decision");
CREATE INDEX "DataReviewDecision_contentExternalId_idx" ON "DataReviewDecision"("contentExternalId");
CREATE INDEX "DataReviewDecision_reviewedAt_idx" ON "DataReviewDecision"("reviewedAt");

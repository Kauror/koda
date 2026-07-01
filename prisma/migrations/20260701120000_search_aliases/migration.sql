CREATE TABLE "SearchAlias" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "canonicalLabel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetSlug" TEXT,
    "targetKind" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'et',
    "sourceBasis" JSONB,
    "notes" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "intent" TEXT,
    "expandedTerms" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchAlias_normalizedAlias_key" ON "SearchAlias"("normalizedAlias");
CREATE INDEX "SearchAlias_targetKind_idx" ON "SearchAlias"("targetKind");
CREATE INDEX "SearchAlias_targetSlug_idx" ON "SearchAlias"("targetSlug");
CREATE INDEX "SearchAlias_type_idx" ON "SearchAlias"("type");
CREATE INDEX "SearchAlias_weight_idx" ON "SearchAlias"("weight");
CREATE INDEX "SearchAlias_isPublic_idx" ON "SearchAlias"("isPublic");

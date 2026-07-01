-- Admin-managed topic threads / timeline groups.
-- These tables are intentionally NOT touched by the merge-ready import, so admin
-- threads survive re-imports. Members reference the stable ContentItem.externalId
-- (no FK to ContentItem — the import deletes+recreates ContentItem rows).

CREATE TABLE "ContentThread" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "primaryTopic" TEXT,
    "primarySector" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortPriority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentThreadItem" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "contentExternalId" TEXT NOT NULL,
    "role" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAnchor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentThreadItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentThread_slug_key" ON "ContentThread"("slug");
CREATE INDEX "ContentThread_status_idx" ON "ContentThread"("status");

CREATE UNIQUE INDEX "ContentThreadItem_threadId_contentExternalId_key" ON "ContentThreadItem"("threadId", "contentExternalId");
CREATE INDEX "ContentThreadItem_contentExternalId_idx" ON "ContentThreadItem"("contentExternalId");
CREATE INDEX "ContentThreadItem_threadId_idx" ON "ContentThreadItem"("threadId");

ALTER TABLE "ContentThreadItem" ADD CONSTRAINT "ContentThreadItem_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ContentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('opinion', 'archive_opinion', 'news', 'currently_handled', 'service', 'event', 'unknown');

-- CreateEnum
CREATE TYPE "TagType" AS ENUM ('sector', 'interest', 'size', 'activity', 'region', 'service');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('main', 'history', 'related');

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "displayTitle" TEXT,
    "date" TIMESTAMP(3),
    "sourceType" "SourceType" NOT NULL DEFAULT 'unknown',
    "bodyText" TEXT,
    "excerpt" TEXT,
    "summary" TEXT,
    "contentHash" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isEvergreen" BOOLEAN NOT NULL DEFAULT false,
    "manualWeight" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'et',
    "embedding" DOUBLE PRECISION[],
    "aiSummary" TEXT,
    "aiRelevanceReason" TEXT,
    "aiKeywords" TEXT[],
    "aiLastGeneratedAt" TIMESTAMP(3),
    "aiModel" TEXT,
    "aiReviewStatus" TEXT,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicGroup" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "mainContentItemId" TEXT,
    "manualWeight" INTEGER NOT NULL DEFAULT 0,
    "isEvergreen" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "whyItMattersText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "type" "TagType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTag" (
    "contentItemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "ContentTag_pkey" PRIMARY KEY ("contentItemId","tagId")
);

-- CreateTable
CREATE TABLE "TopicGroupTag" (
    "topicGroupId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "TopicGroupTag_pkey" PRIMARY KEY ("topicGroupId","tagId")
);

-- CreateTable
CREATE TABLE "ContentTopicGroup" (
    "contentItemId" TEXT NOT NULL,
    "topicGroupId" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL DEFAULT 'related',

    CONSTRAINT "ContentTopicGroup_pkey" PRIMARY KEY ("contentItemId","topicGroupId")
);

-- CreateTable
CREATE TABLE "SearchSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selectedSector" TEXT,
    "selectedSize" TEXT,
    "selectedInterests" TEXT[],
    "selectedActivities" TEXT[],
    "anonymizedIpHash" TEXT,
    "userAgentHash" TEXT,

    CONSTRAINT "SearchSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchResultClick" (
    "id" TEXT NOT NULL,
    "searchSessionId" TEXT NOT NULL,
    "contentItemId" TEXT,
    "topicGroupId" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchResultClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_canonicalUrl_key" ON "ContentItem"("canonicalUrl");

-- CreateIndex
CREATE INDEX "ContentItem_contentHash_idx" ON "ContentItem"("contentHash");

-- CreateIndex
CREATE INDEX "ContentItem_date_idx" ON "ContentItem"("date");

-- CreateIndex
CREATE INDEX "ContentItem_isHidden_idx" ON "ContentItem"("isHidden");

-- CreateIndex
CREATE UNIQUE INDEX "TopicGroup_slug_key" ON "TopicGroup"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_type_slug_key" ON "Tag"("type", "slug");

-- CreateIndex
CREATE INDEX "SearchSession_createdAt_idx" ON "SearchSession"("createdAt");

-- AddForeignKey
ALTER TABLE "TopicGroup" ADD CONSTRAINT "TopicGroup_mainContentItemId_fkey" FOREIGN KEY ("mainContentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTag" ADD CONSTRAINT "ContentTag_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTag" ADD CONSTRAINT "ContentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicGroupTag" ADD CONSTRAINT "TopicGroupTag_topicGroupId_fkey" FOREIGN KEY ("topicGroupId") REFERENCES "TopicGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicGroupTag" ADD CONSTRAINT "TopicGroupTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTopicGroup" ADD CONSTRAINT "ContentTopicGroup_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTopicGroup" ADD CONSTRAINT "ContentTopicGroup_topicGroupId_fkey" FOREIGN KEY ("topicGroupId") REFERENCES "TopicGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResultClick" ADD CONSTRAINT "SearchResultClick_searchSessionId_fkey" FOREIGN KEY ("searchSessionId") REFERENCES "SearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResultClick" ADD CONSTRAINT "SearchResultClick_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResultClick" ADD CONSTRAINT "SearchResultClick_topicGroupId_fkey" FOREIGN KEY ("topicGroupId") REFERENCES "TopicGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

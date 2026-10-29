
-- CreateEnum
CREATE TYPE "PageVersionKind" AS ENUM ('EDIT', 'EXTERNAL', 'SESSION_DRAFT', 'MERGE', 'RESTORE');

-- AlterTable
ALTER TABLE "page_versions" ADD COLUMN     "kind" "PageVersionKind" NOT NULL DEFAULT 'EDIT';

-- CreateTable
CREATE TABLE "pending_page_changes" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "baseBody" TEXT NOT NULL,
    "externalVersionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_page_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_page_changes_pageId_key" ON "pending_page_changes"("pageId");

-- AddForeignKey
ALTER TABLE "pending_page_changes" ADD CONSTRAINT "pending_page_changes_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_page_changes" ADD CONSTRAINT "pending_page_changes_externalVersionId_fkey" FOREIGN KEY ("externalVersionId") REFERENCES "page_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: existing restore rows
UPDATE "page_versions" SET "kind" = 'RESTORE' WHERE "changeDescription" LIKE 'Restored to version %';

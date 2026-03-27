-- CreateEnum
CREATE TYPE "RestrictionType" AS ENUM ('VIEW', 'EDIT');

-- AlterTable
ALTER TABLE "wiki_spaces" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "page_restrictions" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "type" "RestrictionType" NOT NULL,
    "userId" TEXT,
    "teamRoleMin" "TeamRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_restrictions_pageId_idx" ON "page_restrictions"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "page_restrictions_pageId_type_userId_key" ON "page_restrictions"("pageId", "type", "userId");

-- AddForeignKey
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

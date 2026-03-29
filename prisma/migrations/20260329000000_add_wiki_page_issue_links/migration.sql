-- CreateEnum
CREATE TYPE "WikiIssueLinkType" AS ENUM ('MENTION', 'EMBED');

-- CreateTable
CREATE TABLE "wiki_page_issue_links" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "linkType" "WikiIssueLinkType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "wiki_page_issue_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wiki_page_issue_links_pageId_idx" ON "wiki_page_issue_links"("pageId");

-- CreateIndex
CREATE INDEX "wiki_page_issue_links_issueId_idx" ON "wiki_page_issue_links"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_page_issue_links_pageId_issueId_linkType_key" ON "wiki_page_issue_links"("pageId", "issueId", "linkType");

-- AddForeignKey
ALTER TABLE "wiki_page_issue_links" ADD CONSTRAINT "wiki_page_issue_links_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_issue_links" ADD CONSTRAINT "wiki_page_issue_links_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_issue_links" ADD CONSTRAINT "wiki_page_issue_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

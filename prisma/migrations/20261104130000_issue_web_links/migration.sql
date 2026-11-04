-- CreateTable
CREATE TABLE "issue_web_links" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_web_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_web_links_issueId_idx" ON "issue_web_links"("issueId");

-- AddForeignKey
ALTER TABLE "issue_web_links" ADD CONSTRAINT "issue_web_links_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_web_links" ADD CONSTRAINT "issue_web_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

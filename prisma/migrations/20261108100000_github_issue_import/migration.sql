-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "externalAuthorLogin" TEXT;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "externalAuthorLogin" TEXT;

-- AlterTable
ALTER TABLE "github_repo_links" ADD COLUMN     "importIssues" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "github_issue_imports" (
    "id" TEXT NOT NULL,
    "repoLinkId" TEXT NOT NULL,
    "githubIssueNumber" INTEGER NOT NULL,
    "githubIssueId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "mirroredTitle" TEXT NOT NULL,
    "mirroredBodyHash" TEXT NOT NULL,
    "mirroredLabels" TEXT[],
    "linkCommentId" TEXT,
    "linkCommentClaimedAt" TIMESTAMP(3),
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastImportedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_issue_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_imported_comments" (
    "githubCommentId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "mirroredBodyHash" TEXT NOT NULL,
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_imported_comments_pkey" PRIMARY KEY ("githubCommentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_issue_imports_issueId_key" ON "github_issue_imports"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "github_issue_imports_repoLinkId_githubIssueNumber_key" ON "github_issue_imports"("repoLinkId", "githubIssueNumber");

-- CreateIndex
CREATE UNIQUE INDEX "github_imported_comments_commentId_key" ON "github_imported_comments"("commentId");

-- CreateIndex
CREATE INDEX "github_imported_comments_importId_idx" ON "github_imported_comments"("importId");

-- AddForeignKey
ALTER TABLE "github_issue_imports" ADD CONSTRAINT "github_issue_imports_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_issue_imports" ADD CONSTRAINT "github_issue_imports_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_imported_comments" ADD CONSTRAINT "github_imported_comments_importId_fkey" FOREIGN KEY ("importId") REFERENCES "github_issue_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_imported_comments" ADD CONSTRAINT "github_imported_comments_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


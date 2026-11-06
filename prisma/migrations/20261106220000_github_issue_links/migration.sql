-- CreateEnum
CREATE TYPE "GithubLinkTarget" AS ENUM ('BRANCH', 'PULL_REQUEST', 'COMMIT');

-- CreateEnum
CREATE TYPE "GithubLinkSource" AS ENUM ('BRANCH_NAME', 'PR_TITLE', 'PR_BODY', 'COMMIT_MESSAGE');

-- CreateTable
CREATE TABLE "github_issue_links" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "repoLinkId" TEXT NOT NULL,
    "targetType" "GithubLinkTarget" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "sources" "GithubLinkSource"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_issue_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_issue_links_repoLinkId_targetType_targetKey_idx" ON "github_issue_links"("repoLinkId", "targetType", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "github_issue_links_issueId_targetType_targetKey_key" ON "github_issue_links"("issueId", "targetType", "targetKey");

-- AddForeignKey
ALTER TABLE "github_issue_links" ADD CONSTRAINT "github_issue_links_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_issue_links" ADD CONSTRAINT "github_issue_links_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

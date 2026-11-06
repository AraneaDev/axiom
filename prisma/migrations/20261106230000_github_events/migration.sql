-- CreateEnum
CREATE TYPE "GithubPrState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateTable
CREATE TABLE "github_branches" (
    "id" TEXT NOT NULL,
    "repoLinkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_pull_requests" (
    "id" TEXT NOT NULL,
    "repoLinkId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" "GithubPrState" NOT NULL,
    "draft" BOOLEAN NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "authorUserId" TEXT,
    "headRef" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "mergeableState" TEXT,
    "mergeCommitSha" TEXT,
    "requestedReviewers" JSONB NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_reviews" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "authorUserId" TEXT,
    "state" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_commits" (
    "repoLinkId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorLogin" TEXT,
    "authorUserId" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_commits_pkey" PRIMARY KEY ("repoLinkId","sha")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_branches_repoLinkId_name_key" ON "github_branches"("repoLinkId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "github_pull_requests_repoLinkId_number_key" ON "github_pull_requests"("repoLinkId", "number");

-- CreateIndex
CREATE INDEX "github_reviews_pullRequestId_idx" ON "github_reviews"("pullRequestId");

-- AddForeignKey
ALTER TABLE "github_branches" ADD CONSTRAINT "github_branches_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_reviews" ADD CONSTRAINT "github_reviews_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "github_pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_commits" ADD CONSTRAINT "github_commits_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;


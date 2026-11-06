-- CreateTable
CREATE TABLE "github_check_runs" (
    "id" TEXT NOT NULL,
    "repoLinkId" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "status" TEXT NOT NULL,
    "conclusion" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedStep" TEXT,
    "logTail" TEXT,
    "logTruncated" BOOLEAN NOT NULL DEFAULT false,
    "logUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_check_runs_repoLinkId_headSha_idx" ON "github_check_runs"("repoLinkId", "headSha");

-- AddForeignKey
ALTER TABLE "github_check_runs" ADD CONSTRAINT "github_check_runs_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

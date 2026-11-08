-- CreateEnum
CREATE TYPE "GithubImportRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "github_import_runs" (
    "id" TEXT NOT NULL,
    "repoLinkId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "GithubImportRunStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "nextPage" INTEGER NOT NULL DEFAULT 1,
    "pass" INTEGER NOT NULL DEFAULT 1,
    "doneBeforePage" INTEGER NOT NULL DEFAULT 0,
    "failedNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "resumeAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "github_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_import_runs_repoLinkId_createdAt_idx" ON "github_import_runs"("repoLinkId", "createdAt");

-- CreateIndex
CREATE INDEX "github_import_runs_status_idx" ON "github_import_runs"("status");

-- AddForeignKey
ALTER TABLE "github_import_runs" ADD CONSTRAINT "github_import_runs_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;


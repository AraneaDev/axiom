-- CreateEnum
CREATE TYPE "CommitRefType" AS ENUM ('CLOSES', 'FIXES', 'REFS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILURE', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('PUSH', 'PULL_REQUEST', 'MANUAL', 'SCHEDULE');

-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN     "ciStatus" "RunStatus";

-- CreateTable
CREATE TABLE "issue_commits" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "refType" "CommitRefType" NOT NULL DEFAULT 'REFS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_pull_requests" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "refType" "CommitRefType" NOT NULL DEFAULT 'REFS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_branches" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releases" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "tagName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "isPrerelease" BOOLEAN NOT NULL DEFAULT false,
    "targetBranch" TEXT NOT NULL,
    "commitSha" TEXT,
    "authorId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "yamlContent" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "triggerRef" TEXT NOT NULL,
    "commitSha" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_jobs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "pipeline_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_steps" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "output" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "exitCode" INTEGER,

    CONSTRAINT "pipeline_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "issue_commits_issueId_sha_key" ON "issue_commits"("issueId", "sha");

-- CreateIndex
CREATE UNIQUE INDEX "issue_pull_requests_issueId_prId_key" ON "issue_pull_requests"("issueId", "prId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_branches_issueId_repoId_branchName_key" ON "issue_branches"("issueId", "repoId", "branchName");

-- CreateIndex
CREATE UNIQUE INDEX "releases_repoId_tagName_key" ON "releases"("repoId", "tagName");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_repoId_slug_key" ON "pipelines"("repoId", "slug");

-- AddForeignKey
ALTER TABLE "issue_commits" ADD CONSTRAINT "issue_commits_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_commits" ADD CONSTRAINT "issue_commits_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_pull_requests" ADD CONSTRAINT "issue_pull_requests_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_pull_requests" ADD CONSTRAINT "issue_pull_requests_prId_fkey" FOREIGN KEY ("prId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_branches" ADD CONSTRAINT "issue_branches_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_branches" ADD CONSTRAINT "issue_branches_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_branches" ADD CONSTRAINT "issue_branches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "pipeline_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

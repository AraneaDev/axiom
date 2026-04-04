-- CreateEnum
CREATE TYPE "RunnerStatus" AS ENUM ('OFFLINE', 'IDLE', 'ACTIVE');

-- CreateEnum
CREATE TYPE "RunnerScope" AS ENUM ('ORG', 'TEAM', 'PROJECT');

-- CreateTable
CREATE TABLE "runners" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "RunnerStatus" NOT NULL DEFAULT 'IDLE',
    "labels" JSONB NOT NULL DEFAULT '[]',
    "version" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3),
    "scopeType" "RunnerScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_registration_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopeType" "RunnerScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "usedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runner_registration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_tasks" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT,
    "automationRuleId" TEXT,
    "issueId" TEXT,
    "workflowSource" TEXT NOT NULL,
    "workflowRef" TEXT NOT NULL,
    "workflowContent" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "gitRef" TEXT NOT NULL DEFAULT 'HEAD',
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "context" JSONB NOT NULL DEFAULT '{}',
    "labels" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runner_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_task_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runner_task_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "runners_uuid_key" ON "runners"("uuid");

-- CreateIndex
CREATE INDEX "runners_scopeType_scopeId_idx" ON "runners"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "runners_status_idx" ON "runners"("status");

-- CreateIndex
CREATE UNIQUE INDEX "runner_registration_tokens_tokenHash_key" ON "runner_registration_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "runner_registration_tokens_scopeType_scopeId_idx" ON "runner_registration_tokens"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "runner_tasks_status_idx" ON "runner_tasks"("status");

-- CreateIndex
CREATE INDEX "runner_tasks_runnerId_idx" ON "runner_tasks"("runnerId");

-- CreateIndex
CREATE INDEX "runner_tasks_issueId_idx" ON "runner_tasks"("issueId");

-- CreateIndex
CREATE INDEX "runner_tasks_repoId_idx" ON "runner_tasks"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "runner_task_logs_taskId_lineIndex_key" ON "runner_task_logs"("taskId", "lineIndex");

-- CreateIndex
CREATE INDEX "runner_task_logs_taskId_idx" ON "runner_task_logs"("taskId");

-- AddForeignKey
ALTER TABLE "runner_tasks" ADD CONSTRAINT "runner_tasks_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "runners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_tasks" ADD CONSTRAINT "runner_tasks_automationRuleId_fkey" FOREIGN KEY ("automationRuleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_tasks" ADD CONSTRAINT "runner_tasks_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_tasks" ADD CONSTRAINT "runner_tasks_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_task_logs" ADD CONSTRAINT "runner_task_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "runner_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

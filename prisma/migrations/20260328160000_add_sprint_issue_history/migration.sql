-- CreateEnum
CREATE TYPE "SprintIssueAction" AS ENUM ('ADDED', 'REMOVED');

-- AlterTable
ALTER TABLE "sprints" ADD COLUMN "committedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sprint_issue_history" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "action" "SprintIssueAction" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprint_issue_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprint_issue_history_sprintId_idx" ON "sprint_issue_history"("sprintId");

-- CreateIndex
CREATE INDEX "sprint_issue_history_issueId_idx" ON "sprint_issue_history"("issueId");

-- AddForeignKey
ALTER TABLE "sprint_issue_history" ADD CONSTRAINT "sprint_issue_history_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_issue_history" ADD CONSTRAINT "sprint_issue_history_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

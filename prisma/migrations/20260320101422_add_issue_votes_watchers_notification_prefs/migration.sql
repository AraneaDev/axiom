/*
  Warnings:

  - You are about to drop the column `emailEnabled` on the `notification_preferences` table. All the data in the column will be lost.
  - You are about to drop the column `inAppEnabled` on the `notification_preferences` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `notification_preferences` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "emailEnabled",
DROP COLUMN "inAppEnabled",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "email" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inApp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "workflow_rules" ALTER COLUMN "requiredFields" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "activities_userId_idx" ON "activities"("userId");

-- CreateIndex
CREATE INDEX "board_columns_projectId_idx" ON "board_columns"("projectId");

-- CreateIndex
CREATE INDEX "comments_issueId_idx" ON "comments"("issueId");

-- CreateIndex
CREATE INDEX "issues_assigneeId_idx" ON "issues"("assigneeId");

-- CreateIndex
CREATE INDEX "issues_creatorId_idx" ON "issues"("creatorId");

-- CreateIndex
CREATE INDEX "page_comments_pageId_idx" ON "page_comments"("pageId");

-- CreateIndex
CREATE INDEX "pipeline_runs_pipelineId_idx" ON "pipeline_runs"("pipelineId");

-- CreateIndex
CREATE INDEX "pipeline_runs_repoId_idx" ON "pipeline_runs"("repoId");

-- CreateIndex
CREATE INDEX "pr_comments_prId_idx" ON "pr_comments"("prId");

-- CreateIndex
CREATE INDEX "pr_reviews_prId_idx" ON "pr_reviews"("prId");

-- CreateIndex
CREATE INDEX "sprints_projectId_idx" ON "sprints"("projectId");

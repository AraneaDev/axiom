-- AlterTable: Add issueTemplates to projects
ALTER TABLE "projects" ADD COLUMN "issueTemplates" JSONB;

-- AlterTable: Add description to labels
ALTER TABLE "labels" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- AlterTable: Add createdAt to workflow_rules
ALTER TABLE "workflow_rules" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: Unique constraint on workflow_rules
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_rules_projectId_fromColumnId_toColumnId_key" ON "workflow_rules"("projectId", "fromColumnId", "toColumnId");

-- CreateTable
CREATE TABLE "github_automation_marks" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_automation_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_automation_marks_createdAt_idx" ON "github_automation_marks"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "github_automation_marks_issueId_trigger_subjectKey_headSha_key" ON "github_automation_marks"("issueId", "trigger", "subjectKey", "headSha");

-- AddForeignKey
ALTER TABLE "github_automation_marks" ADD CONSTRAINT "github_automation_marks_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

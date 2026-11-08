-- AlterTable
ALTER TABLE "github_repo_links" ADD COLUMN     "importEnabledAt" TIMESTAMP(3);

-- An import row outlives its link: it keeps the project and the repository it was made for
ALTER TABLE "github_issue_imports" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "repoId" BIGINT;

UPDATE "github_issue_imports" AS i
SET "projectId" = l."projectId", "repoId" = l."repoId"
FROM "github_repo_links" AS l
WHERE l."id" = i."repoLinkId";

ALTER TABLE "github_issue_imports" ALTER COLUMN "projectId" SET NOT NULL,
ALTER COLUMN "repoId" SET NOT NULL,
ALTER COLUMN "repoLinkId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "github_issue_imports" DROP CONSTRAINT "github_issue_imports_repoLinkId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "github_issue_imports_projectId_repoId_githubIssueNumber_key" ON "github_issue_imports"("projectId", "repoId", "githubIssueNumber");

-- CreateIndex
CREATE INDEX "github_issue_imports_repoLinkId_linkCommentClaimedAt_idx" ON "github_issue_imports"("repoLinkId", "linkCommentClaimedAt");

-- AddForeignKey
ALTER TABLE "github_issue_imports" ADD CONSTRAINT "github_issue_imports_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_issue_imports" ADD CONSTRAINT "github_issue_imports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A link importing already was switched on at its latest run (or, without one, at the link)
UPDATE "github_repo_links" AS l
SET "importEnabledAt" = COALESCE(
  (SELECT max(r."createdAt") FROM "github_import_runs" AS r WHERE r."repoLinkId" = l."id"),
  l."createdAt"
)
WHERE l."importIssues";

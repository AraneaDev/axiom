-- AlterTable
ALTER TABLE "github_repo_links" ADD COLUMN     "importCommentsSeenAt" TIMESTAMP(3),
ADD COLUMN     "importIssuesSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "github_import_caps" ADD COLUMN     "skippedIssueNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[];


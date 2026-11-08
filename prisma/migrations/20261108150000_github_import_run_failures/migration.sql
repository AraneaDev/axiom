-- AlterTable
ALTER TABLE "github_issue_imports" ADD COLUMN     "linkCommentFailures" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "github_import_runs" ADD COLUMN     "errorTicks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "progressAt" TIMESTAMP(3);


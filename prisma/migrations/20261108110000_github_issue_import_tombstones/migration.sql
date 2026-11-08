-- DropForeignKey
ALTER TABLE "github_issue_imports" DROP CONSTRAINT "github_issue_imports_issueId_fkey";

-- DropForeignKey
ALTER TABLE "github_imported_comments" DROP CONSTRAINT "github_imported_comments_commentId_fkey";

-- DropIndex
DROP INDEX "github_imported_comments_importId_idx";

-- AlterTable
ALTER TABLE "github_issue_imports" ADD COLUMN     "commentsImportedAt" TIMESTAMP(3),
ADD COLUMN     "linkCommentGivenUpAt" TIMESTAMP(3),
ALTER COLUMN "issueId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "github_imported_comments" DROP CONSTRAINT "github_imported_comments_pkey",
ALTER COLUMN "commentId" DROP NOT NULL,
ADD CONSTRAINT "github_imported_comments_pkey" PRIMARY KEY ("importId", "githubCommentId");

-- AddForeignKey
ALTER TABLE "github_issue_imports" ADD CONSTRAINT "github_issue_imports_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_imported_comments" ADD CONSTRAINT "github_imported_comments_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


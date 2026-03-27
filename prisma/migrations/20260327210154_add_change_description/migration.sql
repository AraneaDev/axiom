-- AlterTable
ALTER TABLE "page_versions" ADD COLUMN     "changeDescription" TEXT;

-- CreateIndex
CREATE INDEX "pr_comments_authorId_idx" ON "pr_comments"("authorId");

-- CreateIndex
CREATE INDEX "pr_reviews_reviewerId_idx" ON "pr_reviews"("reviewerId");

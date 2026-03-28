-- AlterTable
ALTER TABLE "pr_comments" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "pr_comments_parentId_idx" ON "pr_comments"("parentId");

-- AddForeignKey
ALTER TABLE "pr_comments" ADD CONSTRAINT "pr_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "pr_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

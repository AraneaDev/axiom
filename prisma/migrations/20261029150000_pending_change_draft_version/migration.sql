-- AlterTable
ALTER TABLE "pending_page_changes" ADD COLUMN "draftVersionId" TEXT;

-- AddForeignKey
ALTER TABLE "pending_page_changes" ADD CONSTRAINT "pending_page_changes_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "page_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

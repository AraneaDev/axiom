
-- DropForeignKey
ALTER TABLE "pending_page_changes" DROP CONSTRAINT "pending_page_changes_externalVersionId_fkey";

-- AddForeignKey
ALTER TABLE "pending_page_changes" ADD CONSTRAINT "pending_page_changes_externalVersionId_fkey" FOREIGN KEY ("externalVersionId") REFERENCES "page_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


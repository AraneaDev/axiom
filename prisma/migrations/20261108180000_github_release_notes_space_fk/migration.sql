-- A setting that names a space that is gone names none
UPDATE "github_repo_links" SET "releaseNotesSpaceId" = NULL
WHERE "releaseNotesSpaceId" IS NOT NULL
  AND "releaseNotesSpaceId" NOT IN (SELECT "id" FROM "wiki_spaces");

-- AddForeignKey
ALTER TABLE "github_repo_links" ADD CONSTRAINT "github_repo_links_releaseNotesSpaceId_fkey" FOREIGN KEY ("releaseNotesSpaceId") REFERENCES "wiki_spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

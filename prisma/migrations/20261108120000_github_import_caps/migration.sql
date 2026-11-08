-- CreateTable
CREATE TABLE "github_import_caps" (
    "repoLinkId" TEXT NOT NULL,
    "hourStart" TIMESTAMP(3) NOT NULL,
    "issues" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "skippedIssues" INTEGER NOT NULL DEFAULT 0,
    "skippedComments" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "github_import_caps_pkey" PRIMARY KEY ("repoLinkId","hourStart")
);

-- AddForeignKey
ALTER TABLE "github_import_caps" ADD CONSTRAINT "github_import_caps_repoLinkId_fkey" FOREIGN KEY ("repoLinkId") REFERENCES "github_repo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "github_repo_links" ADD COLUMN "reconcileLeaseToken" TEXT,
ADD COLUMN "lastReconcileNote" TEXT;

-- AlterTable
ALTER TABLE "github_installations" ADD COLUMN "removedAt" TIMESTAMP(3);

-- An installation marked suspended by a deletion or a vanished listing was removed, not suspended;
-- the two could not be told apart before, so a suspension GitHub itself reported stays one.

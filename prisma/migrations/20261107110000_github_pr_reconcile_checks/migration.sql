-- AlterTable
ALTER TABLE "github_pull_requests" ADD COLUMN "reconcileCheckedAt" TIMESTAMP(3),
ADD COLUMN "reconcileMisses" INTEGER NOT NULL DEFAULT 0;

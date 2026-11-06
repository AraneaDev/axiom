-- AlterTable
ALTER TABLE "github_check_runs" ADD COLUMN "logUnavailableReason" TEXT,
ADD COLUMN "logCheckedAt" TIMESTAMP(3);

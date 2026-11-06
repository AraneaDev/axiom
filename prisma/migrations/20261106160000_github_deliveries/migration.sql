-- CreateEnum
CREATE TYPE "GithubDeliveryStatus" AS ENUM ('PENDING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "github_deliveries" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "installationId" INTEGER,
    "repoId" INTEGER,
    "status" "GithubDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "github_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_deliveries_status_nextAttemptAt_idx" ON "github_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "github_deliveries_repoId_receivedAt_idx" ON "github_deliveries"("repoId", "receivedAt");

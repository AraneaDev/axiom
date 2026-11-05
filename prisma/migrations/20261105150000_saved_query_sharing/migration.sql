-- CreateEnum
CREATE TYPE "SavedVisibility" AS ENUM ('PRIVATE', 'TEAM', 'ORG');

-- AlterTable: existing rows stay private; their query JSON is left as it is
ALTER TABLE "saved_filters" ADD COLUMN     "description" TEXT,
ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "teamId" TEXT,
ADD COLUMN     "visibility" "SavedVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE INDEX "saved_filters_teamId_idx" ON "saved_filters"("teamId");

-- CreateIndex
CREATE INDEX "saved_filters_orgId_idx" ON "saved_filters"("orgId");

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

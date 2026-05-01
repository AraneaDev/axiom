-- CreateTable
CREATE TABLE "roadmap_buckets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmap_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roadmap_buckets_projectId_idx" ON "roadmap_buckets"("projectId");

-- AddForeignKey
ALTER TABLE "roadmap_buckets" ADD CONSTRAINT "roadmap_buckets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "issues" ADD COLUMN "timeEstimate" INTEGER;
ALTER TABLE "issues" ADD COLUMN "timeSpent" INTEGER;
ALTER TABLE "issues" ADD COLUMN "roadmapBucketId" TEXT;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_roadmapBucketId_fkey" FOREIGN KEY ("roadmapBucketId") REFERENCES "roadmap_buckets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "branch_protections" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "requiredReviews" INTEGER NOT NULL DEFAULT 1,
    "requireCI" BOOLEAN NOT NULL DEFAULT false,
    "noForcePush" BOOLEAN NOT NULL DEFAULT true,
    "noDirectPush" BOOLEAN NOT NULL DEFAULT false,
    "requireLinear" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_protections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_protections_repoId_pattern_key" ON "branch_protections"("repoId", "pattern");

-- AddForeignKey
ALTER TABLE "branch_protections" ADD CONSTRAINT "branch_protections_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

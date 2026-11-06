-- CreateTable
CREATE TABLE "github_repo_links" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repoId" BIGINT NOT NULL,
    "installationId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "lastReconcileError" TEXT,
    "reconcileLeaseUntil" TIMESTAMP(3),

    CONSTRAINT "github_repo_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_repo_links_projectId_key" ON "github_repo_links"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "github_repo_links_repoId_key" ON "github_repo_links"("repoId");

-- AddForeignKey
ALTER TABLE "github_repo_links" ADD CONSTRAINT "github_repo_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

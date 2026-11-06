-- CreateTable
CREATE TABLE "github_apps" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "appId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_setup_states" (
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_setup_states_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "id" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_setup_states_expiresAt_idx" ON "github_setup_states"("expiresAt");

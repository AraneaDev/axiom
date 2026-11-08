-- CreateEnum
CREATE TYPE "ServiceAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ServiceAccountSuspension" AS ENUM ('ORPHANED', 'MANUAL');

-- AlterEnum
ALTER TYPE "UserKind" ADD VALUE 'SERVICE';

-- CreateTable
CREATE TABLE "service_accounts" (
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdById" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ServiceAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspendedReason" "ServiceAccountSuspension",
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "service_account_owners" (
    "serviceAccountId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_account_owners_pkey" PRIMARY KEY ("serviceAccountId","ownerId")
);

-- CreateIndex
CREATE INDEX "service_accounts_orgId_idx" ON "service_accounts"("orgId");

-- CreateIndex
CREATE INDEX "service_account_owners_ownerId_idx" ON "service_account_owners"("ownerId");

-- AddForeignKey
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_account_owners" ADD CONSTRAINT "service_account_owners_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "service_accounts"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_account_owners" ADD CONSTRAINT "service_account_owners_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


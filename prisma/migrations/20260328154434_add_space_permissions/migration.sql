-- CreateEnum
CREATE TYPE "SpacePermissionLevel" AS ENUM ('VIEW', 'EDIT', 'ADMIN');

-- CreateTable
CREATE TABLE "space_permissions" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "teamRole" TEXT,
    "level" "SpacePermissionLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_permissions_spaceId_idx" ON "space_permissions"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "space_permissions_spaceId_userId_key" ON "space_permissions"("spaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "space_permissions_spaceId_teamRole_key" ON "space_permissions"("spaceId", "teamRole");

-- AddForeignKey
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

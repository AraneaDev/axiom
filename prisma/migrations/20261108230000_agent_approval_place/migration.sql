-- AlterTable
ALTER TABLE "agent_approvals" ADD COLUMN "placeSpaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "placeTeamIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: store who was asked to approve, so only they can vote
ALTER TABLE "approval_requests" ADD COLUMN "approverIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

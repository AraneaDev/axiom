-- AlterTable
ALTER TABLE "agent_approvals" ADD COLUMN "placeOrgLevel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "placePageIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A bot's request made before places were recorded in full names no place, and an unknown place
-- is nobody's to decide: cancel what still waits, so its owners and the agent read why
UPDATE "agent_approvals"
SET "status" = 'CANCELLED',
    "decidedAt" = CURRENT_TIMESTAMP,
    "error" = '{"status": 409, "code": "CANCELLED", "message": "Made before requests recorded where they act: ask again"}'::jsonb
WHERE "status" = 'PENDING'
  AND "userId" IN (SELECT "id" FROM "users" WHERE "kind" = 'SERVICE');

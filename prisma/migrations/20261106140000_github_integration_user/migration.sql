-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('PERSON', 'INTEGRATION');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kind" "UserKind" NOT NULL DEFAULT 'PERSON';

-- The built-in GitHub user: the author of GitHub events no Axiom user maps to. '!' is no bcrypt hash,
-- so no password matches it, and it is a member of nothing.
INSERT INTO "users" ("id", "email", "username", "displayName", "passwordHash", "kind", "createdAt", "updatedAt")
VALUES ('github-integration', 'github-integration@users.invalid', 'github-integration', 'GitHub', '!', 'INTEGRATION', NOW(), NOW())
ON CONFLICT DO NOTHING;

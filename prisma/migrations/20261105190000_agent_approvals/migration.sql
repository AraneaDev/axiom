-- CreateEnum
CREATE TYPE "AgentApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'FAILED');

-- CreateTable
CREATE TABLE "agent_approvals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiTokenId" TEXT,
    "apiTokenName" TEXT,
    "channel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "preview" TEXT NOT NULL,
    "status" "AgentApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" JSONB,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_approvals_userId_status_idx" ON "agent_approvals"("userId", "status");

-- CreateIndex
CREATE INDEX "agent_approvals_status_expiresAt_idx" ON "agent_approvals"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "agent_approvals_decidedAt_idx" ON "agent_approvals"("decidedAt");

-- AddForeignKey
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

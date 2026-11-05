-- CreateTable
CREATE TABLE "agent_policies" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "rules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_policies_one_owner" CHECK (("orgId" IS NULL) <> ("userId" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_policies_orgId_key" ON "agent_policies"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_policies_userId_key" ON "agent_policies"("userId");

-- AddForeignKey
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

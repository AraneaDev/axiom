-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "stagedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "upload_intents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiTokenId" TEXT,
    "target" JSONB,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "maxBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attachmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upload_intents_expiresAt_idx" ON "upload_intents"("expiresAt");

-- CreateIndex
CREATE INDEX "attachments_uploaderId_stagedAt_idx" ON "attachments"("uploaderId", "stagedAt");

-- CreateIndex
CREATE INDEX "attachments_stagedAt_idx" ON "attachments"("stagedAt");

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

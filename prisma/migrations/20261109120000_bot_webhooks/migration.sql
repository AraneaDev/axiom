-- CreateEnum
CREATE TYPE "BotWebhookStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "BotEventStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DROPPED');

-- CreateTable
CREATE TABLE "bot_webhooks" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "status" "BotWebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_events" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "botId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "BotEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_webhooks_botId_key" ON "bot_webhooks"("botId");

-- CreateIndex
CREATE INDEX "bot_events_botId_status_seq_idx" ON "bot_events"("botId", "status", "seq");

-- CreateIndex
CREATE INDEX "bot_events_status_nextAttemptAt_idx" ON "bot_events"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "bot_webhooks" ADD CONSTRAINT "bot_webhooks_botId_fkey" FOREIGN KEY ("botId") REFERENCES "service_accounts"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_events" ADD CONSTRAINT "bot_events_botId_fkey" FOREIGN KEY ("botId") REFERENCES "service_accounts"("userId") ON DELETE CASCADE ON UPDATE CASCADE;


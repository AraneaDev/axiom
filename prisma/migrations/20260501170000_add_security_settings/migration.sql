-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN "registration_mode" TEXT NOT NULL DEFAULT 'INVITE_ONLY';
ALTER TABLE "site_settings" ADD COLUMN "enforce_2fa" BOOLEAN NOT NULL DEFAULT false;

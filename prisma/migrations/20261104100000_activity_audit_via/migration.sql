-- Which API token made a change, and its name at the time ("via").
ALTER TABLE "activities" ADD COLUMN "apiTokenId" TEXT, ADD COLUMN "via" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "apiTokenId" TEXT, ADD COLUMN "via" TEXT;

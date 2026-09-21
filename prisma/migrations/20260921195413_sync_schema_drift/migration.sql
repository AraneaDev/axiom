-- This migration is idempotent because the schema it describes may already exist.
-- Environments that ran the old CMD applied these tables and columns with
-- prisma db push before this migration was written. IF NOT EXISTS guards and
-- duplicate_object exception handlers let migrate deploy succeed both on a
-- fresh database and on a database that was already brought up to date by
-- db push, with no manual migrate resolve step required.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "FormAuthMode" AS ENUM ('PUBLIC', 'TOKEN_GATED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "FormSpamProtection" AS ENUM ('NONE', 'CAPTCHA', 'RATE_LIMIT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "FormFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'SELECT', 'MULTISELECT', 'CHECKBOX', 'RADIO', 'DATE', 'FILE', 'HEADING', 'DESCRIPTION');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SPAM');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "condition" TEXT,
ALTER COLUMN "conditions" DROP NOT NULL;

-- AlterTable
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "roadmapBucketId" TEXT,
ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_gates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromColumnId" TEXT NOT NULL,
    "toColumnId" TEXT NOT NULL,
    "minApprovals" INTEGER NOT NULL DEFAULT 1,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_requests" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "approvalGateId" TEXT NOT NULL,
    "targetColumnId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_votes" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Form" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "authMode" "FormAuthMode" NOT NULL DEFAULT 'PUBLIC',
    "sharedSecret" TEXT,
    "spamProtection" "FormSpamProtection" NOT NULL DEFAULT 'NONE',
    "rateLimitPerHour" INTEGER,
    "successMessage" TEXT,
    "redirectUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FormPage" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "conditionFieldId" TEXT,
    "conditionOperator" TEXT,
    "conditionValue" TEXT,

    CONSTRAINT "FormPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FormField" (
    "id" TEXT NOT NULL,
    "formPageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "FormFieldType" NOT NULL,
    "label" TEXT NOT NULL,
    "placeholder" TEXT,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "issueFieldMapping" TEXT,
    "validationRules" JSONB,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FormSubmission" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "data" JSONB NOT NULL,
    "submitterEmail" TEXT,
    "submitterName" TEXT,
    "submitterIp" TEXT NOT NULL,
    "issueId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "roadmap_buckets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmap_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_gates_projectId_idx" ON "approval_gates"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_gates_projectId_fromColumnId_toColumnId_key" ON "approval_gates"("projectId", "fromColumnId", "toColumnId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_requests_issueId_idx" ON "approval_requests"("issueId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_requests_approvalGateId_idx" ON "approval_requests"("approvalGateId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_requests_requestedById_status_idx" ON "approval_requests"("requestedById", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_votes_userId_idx" ON "approval_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_votes_approvalRequestId_userId_key" ON "approval_votes"("approvalRequestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Form_slug_key" ON "Form"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Form_projectId_idx" ON "Form"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FormPage_formId_idx" ON "FormPage"("formId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FormField_formPageId_idx" ON "FormField"("formPageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FormSubmission_formId_status_idx" ON "FormSubmission"("formId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FormSubmission_projectId_status_idx" ON "FormSubmission"("projectId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "roadmap_buckets_projectId_idx" ON "roadmap_buckets"("projectId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "issues" ADD CONSTRAINT "issues_roadmapBucketId_fkey" FOREIGN KEY ("roadmapBucketId") REFERENCES "roadmap_buckets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_fromColumnId_fkey" FOREIGN KEY ("fromColumnId") REFERENCES "board_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_toColumnId_fkey" FOREIGN KEY ("toColumnId") REFERENCES "board_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approvalGateId_fkey" FOREIGN KEY ("approvalGateId") REFERENCES "approval_gates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_targetColumnId_fkey" FOREIGN KEY ("targetColumnId") REFERENCES "board_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Form" ADD CONSTRAINT "Form_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Form" ADD CONSTRAINT "Form_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "FormPage" ADD CONSTRAINT "FormPage_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "FormPage" ADD CONSTRAINT "FormPage_conditionFieldId_fkey" FOREIGN KEY ("conditionFieldId") REFERENCES "FormField"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "FormField" ADD CONSTRAINT "FormField_formPageId_fkey" FOREIGN KEY ("formPageId") REFERENCES "FormPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "roadmap_buckets" ADD CONSTRAINT "roadmap_buckets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

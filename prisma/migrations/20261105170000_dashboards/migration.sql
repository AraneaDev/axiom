-- CreateEnum
CREATE TYPE "WidgetType" AS ENUM ('TABLE', 'COUNT', 'BAR', 'LIST', 'SPRINT_OVERVIEW');

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "visibility" "SavedVisibility" NOT NULL DEFAULT 'PRIVATE',
    "teamId" TEXT,
    "orgId" TEXT,
    "layout" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "savedQueryId" TEXT,
    "query" TEXT,
    "type" "WidgetType" NOT NULL,
    "title" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboards_ownerId_idx" ON "dashboards"("ownerId");

-- CreateIndex
CREATE INDEX "dashboards_teamId_idx" ON "dashboards"("teamId");

-- CreateIndex
CREATE INDEX "dashboards_orgId_idx" ON "dashboards"("orgId");

-- CreateIndex
CREATE INDEX "dashboard_widgets_dashboardId_position_idx" ON "dashboard_widgets"("dashboardId", "position");

-- CreateIndex
CREATE INDEX "dashboard_widgets_savedQueryId_idx" ON "dashboard_widgets"("savedQueryId");

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_savedQueryId_fkey" FOREIGN KEY ("savedQueryId") REFERENCES "saved_filters"("id") ON DELETE SET NULL ON UPDATE CASCADE;


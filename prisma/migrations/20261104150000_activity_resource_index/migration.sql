-- CreateIndex
CREATE INDEX "activities_resourceType_resourceId_createdAt_idx" ON "activities"("resourceType", "resourceId", "createdAt");

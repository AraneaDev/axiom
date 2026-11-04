-- Every issue delete checks for children through this foreign key, and hierarchy reads filter on it
CREATE INDEX "issues_parentId_idx" ON "issues"("parentId");

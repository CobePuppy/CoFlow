ALTER TABLE "Project" ADD COLUMN "workflow" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "Task" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedBy" TEXT;
CREATE INDEX "Task_projectId_deletedAt_idx" ON "Task"("projectId", "deletedAt");

CREATE TABLE "ProjectFork" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "goal" TEXT NOT NULL, "criterion" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0), "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId")
);
CREATE INDEX "ProjectFork_projectId_idx" ON "ProjectFork"("projectId");
CREATE TRIGGER coflow_fork_archive BEFORE INSERT OR UPDATE OR DELETE ON "ProjectFork"
FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();

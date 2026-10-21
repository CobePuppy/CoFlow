CREATE TABLE "SavedView" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "view" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "projectId" TEXT,
  "filters" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedView_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "SavedView_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "SavedView_project_fkey" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId") ON DELETE CASCADE,
  CONSTRAINT "SavedView_target_check" CHECK (("view" = 'tasks' AND "projectId" IS NOT NULL) OR ("view" = 'todos' AND "projectId" IS NULL)),
  CONSTRAINT "SavedView_mode_check" CHECK ("mode" IN ('list', 'board'))
);
CREATE UNIQUE INDEX "SavedView_workspaceId_userId_name_key" ON "SavedView" ("workspaceId", "userId", "name");
CREATE INDEX "SavedView_userId_workspaceId_idx" ON "SavedView" ("userId", "workspaceId");

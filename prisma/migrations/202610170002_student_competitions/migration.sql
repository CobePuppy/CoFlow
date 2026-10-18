CREATE TABLE "Competition" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "organizer" TEXT NOT NULL DEFAULT '',
  "url" TEXT NOT NULL DEFAULT '',
  "deadline" TEXT NOT NULL DEFAULT '',
  "stage" TEXT NOT NULL DEFAULT 'PREPARING',
  "outcome" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Competition_project_scope_fk" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId"),
  CONSTRAINT "Competition_stage_check" CHECK ("stage" IN ('PREPARING','REGISTERED','SUBMITTED','FINISHED')),
  CONSTRAINT "Competition_version_check" CHECK ("version" > 0)
);
CREATE INDEX "Competition_projectId_stage_idx" ON "Competition"("projectId", "stage");
CREATE TRIGGER coflow_competition_archive BEFORE INSERT OR UPDATE OR DELETE ON "Competition" FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();

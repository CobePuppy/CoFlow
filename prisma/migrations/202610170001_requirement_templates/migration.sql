CREATE TABLE "RequirementTemplate" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL REFERENCES "User"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RequirementTemplate_project_scope_fk" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId"),
  CONSTRAINT "RequirementTemplate_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "RequirementTemplate_projectId_name_key" ON "RequirementTemplate"("projectId", "name");
CREATE INDEX "RequirementTemplate_projectId_active_idx" ON "RequirementTemplate"("projectId", "active");
CREATE TRIGGER coflow_template_archive BEFORE INSERT OR UPDATE OR DELETE ON "RequirementTemplate" FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();

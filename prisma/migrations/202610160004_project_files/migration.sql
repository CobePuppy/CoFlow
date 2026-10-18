ALTER TABLE "Attachment" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_project_scope_fk" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project" (id, "workspaceId");
CREATE INDEX "Attachment_project_idx" ON "Attachment" ("projectId", "createdAt");

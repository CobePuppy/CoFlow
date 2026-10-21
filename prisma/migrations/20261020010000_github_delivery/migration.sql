CREATE TABLE "ProjectGitHub" (
  "projectId" TEXT PRIMARY KEY REFERENCES "Project"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "data" JSONB NOT NULL
);

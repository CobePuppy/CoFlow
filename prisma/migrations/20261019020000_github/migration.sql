CREATE TABLE "GitHubAccount" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "login" TEXT,
  "credentials" TEXT,
  "attempt" TEXT
);
CREATE TABLE "TaskGitHub" (
  "taskId" TEXT PRIMARY KEY REFERENCES "Task"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL,
  CONSTRAINT "TaskGitHub_version_check" CHECK ("version" > 0)
);

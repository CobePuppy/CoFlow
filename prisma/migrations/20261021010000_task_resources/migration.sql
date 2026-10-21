CREATE TABLE "TaskResource" (
 "id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL REFERENCES "Task"(id) ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('DOCUMENT','FILE','ATTACHMENT')), "sourceId" TEXT NOT NULL,
 "sourceVersion" INTEGER NOT NULL CHECK ("sourceVersion">0), "title" TEXT NOT NULL,
 "sourceScope" TEXT NOT NULL CHECK ("sourceScope" IN ('PROJECT','TEAM','PERSONAL')),
 "personalShared" BOOLEAN NOT NULL DEFAULT false, "createdBy" TEXT NOT NULL REFERENCES "User"(id),
 "taskTitle" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TaskResource_personal_check" CHECK (("sourceScope"='PERSONAL')="personalShared")
);
CREATE UNIQUE INDEX "TaskResource_taskId_kind_sourceId_key" ON "TaskResource"("taskId","kind","sourceId");
CREATE INDEX "TaskResource_sourceId_kind_idx" ON "TaskResource"("sourceId","kind");

CREATE TABLE "SpaceFile" (
 "id" TEXT PRIMARY KEY, "scope" TEXT NOT NULL, "ownerId" TEXT, "workspaceId" TEXT,
 "userId" TEXT NOT NULL, "key" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
 "mime" TEXT NOT NULL, "size" INTEGER NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 "deletedAt" TIMESTAMP(3), "deletedBy" TEXT,
 CONSTRAINT "SpaceFile_scope_check" CHECK (("scope"='PERSONAL' AND "ownerId" IS NOT NULL AND "workspaceId" IS NULL AND "ownerId"="userId") OR ("scope"='TEAM' AND "ownerId" IS NULL AND "workspaceId" IS NOT NULL)),
 CONSTRAINT "SpaceFile_size_check" CHECK ("size">0 AND "size"<=20971520),
 CONSTRAINT "SpaceFile_owner_fk" FOREIGN KEY ("ownerId") REFERENCES "User"(id),
 CONSTRAINT "SpaceFile_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id),
 CONSTRAINT "SpaceFile_user_fk" FOREIGN KEY ("userId") REFERENCES "User"(id),
 CONSTRAINT "SpaceFile_deleted_by_fk" FOREIGN KEY ("deletedBy") REFERENCES "User"(id)
);
CREATE INDEX "SpaceFile_ownerId_deletedAt_createdAt_idx" ON "SpaceFile"("ownerId","deletedAt","createdAt");
CREATE INDEX "SpaceFile_workspaceId_deletedAt_createdAt_idx" ON "SpaceFile"("workspaceId","deletedAt","createdAt");
CREATE TABLE "SpaceFileEvent" (
 "id" TEXT PRIMARY KEY, "fileId" TEXT NOT NULL REFERENCES "SpaceFile"(id),
 "actorId" TEXT NOT NULL REFERENCES "User"(id), "action" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SpaceFileEvent_fileId_createdAt_idx" ON "SpaceFileEvent"("fileId","createdAt");
CREATE FUNCTION protect_space_file_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."scope",NEW."ownerId",NEW."workspaceId",NEW."userId",NEW."key",NEW."mime",NEW."size") IS DISTINCT FROM ROW(OLD."scope",OLD."ownerId",OLD."workspaceId",OLD."userId",OLD."key",OLD."mime",OLD."size") THEN
  RAISE EXCEPTION 'file ownership and original content are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER space_file_scope_guard BEFORE UPDATE ON "SpaceFile" FOR EACH ROW EXECUTE FUNCTION protect_space_file_scope();

CREATE TABLE "ProjectAction" (
 "id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id),"projectId" TEXT NOT NULL REFERENCES "Project"(id),"taskId" TEXT NOT NULL REFERENCES "Task"(id),
 "sourceKey" TEXT NOT NULL,"sourceVersion" INTEGER NOT NULL,"title" TEXT NOT NULL,"acceptance" TEXT NOT NULL,"evidence" TEXT NOT NULL,
 "ownerId" TEXT REFERENCES "User"(id),"dueDate" TEXT,"status" TEXT NOT NULL DEFAULT 'OPEN',"outcome" TEXT NOT NULL DEFAULT '',
 "createdBy" TEXT NOT NULL REFERENCES "User"(id),"version" INTEGER NOT NULL DEFAULT 1,"events" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (status IN ('OPEN','DOING','SUBMITTED','DONE')), CHECK (version>0 AND "sourceVersion">0 AND jsonb_typeof(events)='array'),
 CHECK ("dueDate" IS NULL OR ("dueDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "dueDate"::date IS NOT NULL))
);
CREATE UNIQUE INDEX "ProjectAction_projectId_sourceKey_key" ON "ProjectAction"("projectId","sourceKey");
CREATE INDEX "ProjectAction_projectId_status_idx" ON "ProjectAction"("projectId","status");
CREATE TABLE "ProjectCheckpoint" (
 "id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id),"projectId" TEXT NOT NULL REFERENCES "Project"(id),
 "createdBy" TEXT NOT NULL REFERENCES "User"(id),"note" TEXT NOT NULL,"snapshot" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ProjectCheckpoint_projectId_createdAt_idx" ON "ProjectCheckpoint"("projectId","createdAt");
CREATE FUNCTION protect_project_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Project" p WHERE p.id=NEW."projectId" AND p."workspaceId"=NEW."workspaceId") THEN RAISE EXCEPTION 'progress project scope mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM "Project" WHERE id=NEW."projectId" AND "archivedAt" IS NOT NULL) THEN RAISE EXCEPTION 'archived progress is read only'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='ProjectCheckpoint' THEN RAISE EXCEPTION 'checkpoint is immutable'; END IF;
  IF ROW(NEW."projectId",NEW."workspaceId",NEW."taskId",NEW."sourceKey",NEW."sourceVersion",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM ROW(OLD."projectId",OLD."workspaceId",OLD."taskId",OLD."sourceKey",OLD."sourceVersion",OLD."createdBy",OLD."createdAt") THEN RAISE EXCEPTION 'action source is immutable'; END IF;
  IF NEW.version<>OLD.version+1 OR jsonb_array_length(NEW.events)<>jsonb_array_length(OLD.events)+1 OR NEW.events - (jsonb_array_length(NEW.events)-1) <> OLD.events THEN RAISE EXCEPTION 'action history must be appended'; END IF;
 END IF;
 IF TG_TABLE_NAME='ProjectAction' THEN
  IF NOT EXISTS (SELECT 1 FROM "Task" t WHERE t.id=NEW."taskId" AND t."projectId"=NEW."projectId") THEN RAISE EXCEPTION 'action task scope mismatch'; END IF;
  IF NEW."ownerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ProjectMember" m JOIN "WorkspaceMember" w ON w."userId"=m."userId" AND w."workspaceId"=NEW."workspaceId" WHERE m."projectId"=NEW."projectId" AND m."userId"=NEW."ownerId") THEN RAISE EXCEPTION 'action owner must be a current member'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_action_guard BEFORE INSERT OR UPDATE ON "ProjectAction" FOR EACH ROW EXECUTE FUNCTION protect_project_progress();
CREATE TRIGGER project_checkpoint_guard BEFORE INSERT OR UPDATE ON "ProjectCheckpoint" FOR EACH ROW EXECUTE FUNCTION protect_project_progress();
CREATE FUNCTION prevent_progress_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'project progress history cannot be deleted'; END $$;
CREATE TRIGGER project_action_delete_guard BEFORE DELETE ON "ProjectAction" FOR EACH ROW EXECUTE FUNCTION prevent_progress_delete();
CREATE TRIGGER project_checkpoint_delete_guard BEFORE DELETE ON "ProjectCheckpoint" FOR EACH ROW EXECUTE FUNCTION prevent_progress_delete();
CREATE FUNCTION protect_action_task_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."projectId" IS DISTINCT FROM OLD."projectId" AND EXISTS (SELECT 1 FROM "ProjectAction" a WHERE a."taskId"=OLD.id) THEN RAISE EXCEPTION 'task with actions cannot move between projects'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_action_move_guard BEFORE UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION protect_action_task_move();

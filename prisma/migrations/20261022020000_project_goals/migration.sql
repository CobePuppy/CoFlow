CREATE TABLE "ProjectGoal" (
 "id" TEXT PRIMARY KEY,"projectId" TEXT NOT NULL REFERENCES "Project"(id),"workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id),
 "title" TEXT NOT NULL,"description" TEXT NOT NULL,"criteria" TEXT[] NOT NULL,"ownerId" TEXT NOT NULL REFERENCES "User"(id),"dueDate" TEXT,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE',"version" INTEGER NOT NULL DEFAULT 1,"events" JSONB NOT NULL,"createdBy" TEXT NOT NULL REFERENCES "User"(id),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK(status IN ('ACTIVE','ARCHIVED')), CHECK(version>0 AND jsonb_typeof(events)='array'),
 CHECK("dueDate" IS NULL OR ("dueDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "dueDate"::date IS NOT NULL))
);
CREATE INDEX "ProjectGoal_projectId_status_idx" ON "ProjectGoal"("projectId","status");
CREATE TABLE "ProjectGoalTask" ("goalId" TEXT NOT NULL REFERENCES "ProjectGoal"(id),"taskId" TEXT NOT NULL REFERENCES "Task"(id),PRIMARY KEY("goalId","taskId"));
CREATE INDEX "ProjectGoalTask_taskId_idx" ON "ProjectGoalTask"("taskId");
CREATE TABLE "ProjectGoalIteration" ("goalId" TEXT NOT NULL REFERENCES "ProjectGoal"(id),"iterationId" TEXT NOT NULL REFERENCES "Iteration"(id),PRIMARY KEY("goalId","iterationId"));
CREATE INDEX "ProjectGoalIteration_iterationId_idx" ON "ProjectGoalIteration"("iterationId");
CREATE FUNCTION protect_project_goal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Project" p WHERE p.id=NEW."projectId" AND p."workspaceId"=NEW."workspaceId" AND p."archivedAt" IS NULL) THEN RAISE EXCEPTION 'goal project scope invalid or archived'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "ProjectMember" m JOIN "WorkspaceMember" w ON w."userId"=m."userId" AND w."workspaceId"=NEW."workspaceId" WHERE m."projectId"=NEW."projectId" AND m."userId"=NEW."ownerId") THEN RAISE EXCEPTION 'goal owner must be current member'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW."projectId",NEW."workspaceId",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM ROW(OLD."projectId",OLD."workspaceId",OLD."createdBy",OLD."createdAt") THEN RAISE EXCEPTION 'goal scope is immutable'; END IF;
  IF NEW.version<>OLD.version+1 OR jsonb_array_length(NEW.events)<>jsonb_array_length(OLD.events)+1 OR NEW.events - (jsonb_array_length(NEW.events)-1) <> OLD.events THEN RAISE EXCEPTION 'goal history must be appended'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_goal_guard BEFORE INSERT OR UPDATE ON "ProjectGoal" FOR EACH ROW EXECUTE FUNCTION protect_project_goal();
CREATE TRIGGER project_goal_delete_guard BEFORE DELETE ON "ProjectGoal" FOR EACH ROW EXECUTE FUNCTION prevent_progress_delete();
CREATE FUNCTION protect_goal_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT; gid TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'goal links cannot be moved'; END IF;
 IF TG_OP='DELETE' THEN gid:=OLD."goalId"; ELSE gid:=NEW."goalId"; END IF;
 SELECT g."projectId" INTO pid FROM "ProjectGoal" g JOIN "Project" p ON p.id=g."projectId" WHERE g.id=gid AND g.status='ACTIVE' AND p."archivedAt" IS NULL;
 IF pid IS NULL THEN RAISE EXCEPTION 'goal or project is archived'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='ProjectGoalTask' THEN
  IF NOT EXISTS(SELECT 1 FROM "Task" t WHERE t.id=NEW."taskId" AND t."projectId"=pid) THEN RAISE EXCEPTION 'goal task scope mismatch'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM "Iteration" i WHERE i.id=NEW."iterationId" AND i."projectId"=pid) THEN RAISE EXCEPTION 'goal iteration scope mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_goal_task_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectGoalTask" FOR EACH ROW EXECUTE FUNCTION protect_goal_link();
CREATE TRIGGER project_goal_iteration_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectGoalIteration" FOR EACH ROW EXECUTE FUNCTION protect_goal_link();
CREATE FUNCTION protect_goal_task_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."projectId" IS DISTINCT FROM OLD."projectId" AND EXISTS(SELECT 1 FROM "ProjectGoalTask" x WHERE x."taskId"=OLD.id) THEN RAISE EXCEPTION 'task with goal links cannot move'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_goal_move_guard BEFORE UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION protect_goal_task_move();

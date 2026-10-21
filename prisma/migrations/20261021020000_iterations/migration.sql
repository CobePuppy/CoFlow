CREATE TABLE "Iteration" (
 "id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id),"projectId" TEXT NOT NULL REFERENCES "Project"(id),
 "name" TEXT NOT NULL,"goal" TEXT NOT NULL,"ownerId" TEXT NOT NULL REFERENCES "User"(id),"startDate" TEXT NOT NULL,"endDate" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,"createdBy" TEXT NOT NULL REFERENCES "User"(id),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Iteration_dates_check" CHECK ("startDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "endDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "startDate"::date<="endDate"::date)
);
CREATE INDEX "Iteration_projectId_endDate_idx" ON "Iteration"("projectId","endDate");
CREATE TABLE "IterationMilestone" (
 "id" TEXT PRIMARY KEY,"iterationId" TEXT NOT NULL REFERENCES "Iteration"(id) ON DELETE CASCADE,"name" TEXT NOT NULL,"goal" TEXT NOT NULL DEFAULT '',"dueDate" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "IterationMilestone_dueDate_check" CHECK ("dueDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "dueDate"::date IS NOT NULL)
);
CREATE UNIQUE INDEX "IterationMilestone_id_iterationId_key" ON "IterationMilestone"("id","iterationId");
CREATE INDEX "IterationMilestone_iterationId_dueDate_idx" ON "IterationMilestone"("iterationId","dueDate");
CREATE TABLE "IterationTask" (
 "id" TEXT PRIMARY KEY,"iterationId" TEXT NOT NULL REFERENCES "Iteration"(id) ON DELETE CASCADE,"taskId" TEXT NOT NULL REFERENCES "Task"(id) ON DELETE CASCADE,
 "milestoneId" TEXT,"delayNote" TEXT NOT NULL DEFAULT '',"createdBy" TEXT NOT NULL REFERENCES "User"(id),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("milestoneId","iterationId") REFERENCES "IterationMilestone"("id","iterationId")
);
CREATE UNIQUE INDEX "IterationTask_taskId_key" ON "IterationTask"("taskId");
CREATE INDEX "IterationTask_iterationId_milestoneId_idx" ON "IterationTask"("iterationId","milestoneId");
CREATE TABLE "IterationEvent" ("id" TEXT PRIMARY KEY,"iterationId" TEXT NOT NULL REFERENCES "Iteration"(id) ON DELETE CASCADE,"actorId" TEXT NOT NULL REFERENCES "User"(id),"action" TEXT NOT NULL,"data" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "IterationEvent_iterationId_createdAt_idx" ON "IterationEvent"("iterationId","createdAt");
CREATE FUNCTION protect_iteration_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Project" p WHERE p.id=NEW."projectId" AND p."workspaceId"=NEW."workspaceId") THEN RAISE EXCEPTION 'iteration project scope mismatch'; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW."projectId",NEW."workspaceId") IS DISTINCT FROM ROW(OLD."projectId",OLD."workspaceId") THEN RAISE EXCEPTION 'iteration scope is immutable'; END IF;
 IF EXISTS (SELECT 1 FROM "IterationMilestone" m WHERE m."iterationId"=NEW.id AND (m."dueDate"<NEW."startDate" OR m."dueDate">NEW."endDate")) THEN RAISE EXCEPTION 'milestone outside iteration dates'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER iteration_scope_guard BEFORE INSERT OR UPDATE ON "Iteration" FOR EACH ROW EXECUTE FUNCTION protect_iteration_scope();
CREATE FUNCTION protect_iteration_milestone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Iteration" i WHERE i.id=NEW."iterationId" AND NEW."dueDate">=i."startDate" AND NEW."dueDate"<=i."endDate") THEN RAISE EXCEPTION 'milestone outside iteration dates'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER iteration_milestone_guard BEFORE INSERT OR UPDATE ON "IterationMilestone" FOR EACH ROW EXECUTE FUNCTION protect_iteration_milestone();
CREATE FUNCTION protect_iteration_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Iteration" i JOIN "Task" t ON t."projectId"=i."projectId" WHERE i.id=NEW."iterationId" AND t.id=NEW."taskId") THEN RAISE EXCEPTION 'iteration task project mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER iteration_task_guard BEFORE INSERT OR UPDATE ON "IterationTask" FOR EACH ROW EXECUTE FUNCTION protect_iteration_task();
CREATE FUNCTION protect_task_iteration_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."projectId" IS DISTINCT FROM OLD."projectId" AND EXISTS (SELECT 1 FROM "IterationTask" x WHERE x."taskId"=OLD.id) THEN RAISE EXCEPTION 'remove iteration planning before moving task'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_iteration_move_guard BEFORE UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION protect_task_iteration_move();

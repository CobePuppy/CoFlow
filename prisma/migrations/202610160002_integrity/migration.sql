-- Scoped foreign keys protect team/project boundaries even if a service has a bug.
ALTER TABLE "Project" ADD CONSTRAINT "Project_id_workspaceId_key" UNIQUE (id, "workspaceId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_id_projectId_workspaceId_key" UNIQUE (id, "projectId", "workspaceId");
ALTER TABLE "Session" ADD FOREIGN KEY ("userId") REFERENCES "User"(id);
ALTER TABLE "WorkspaceMember" ADD FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "WorkspaceMember" ADD FOREIGN KEY ("userId") REFERENCES "User"(id);
ALTER TABLE "Invitation" ADD FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Project" ADD FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "ProjectMember" ADD FOREIGN KEY ("projectId") REFERENCES "Project"(id);
ALTER TABLE "ProjectMember" ADD FOREIGN KEY ("userId") REFERENCES "User"(id);
ALTER TABLE "Task" ADD FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"(id, "workspaceId");
ALTER TABLE "Document" ADD FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"(id, "workspaceId");
ALTER TABLE "Attachment" ADD FOREIGN KEY ("taskId", "projectId", "workspaceId") REFERENCES "Task"(id, "projectId", "workspaceId");
ALTER TABLE "Attachment" ADD FOREIGN KEY ("userId") REFERENCES "User"(id);
ALTER TABLE "Notification" ADD FOREIGN KEY ("taskId", "projectId", "workspaceId") REFERENCES "Task"(id, "projectId", "workspaceId");
ALTER TABLE "Notification" ADD FOREIGN KEY ("recipientId") REFERENCES "User"(id);
ALTER TABLE "AuditEvent" ADD FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "AuditEvent" ADD FOREIGN KEY ("actorId") REFERENCES "User"(id);
ALTER TABLE "IdempotencyRecord" ADD FOREIGN KEY ("userId") REFERENCES "User"(id);
ALTER TABLE "Task" ADD CHECK (status IN ('DRAFT','SOLUTION_PENDING','SOLUTION_REVIEW','READY_FOR_DEV','DEVELOPING','READY_FOR_TEST','TESTING','ACCEPTANCE_PENDING','CLOSED','CANCELLED'));
ALTER TABLE "Task" ADD CHECK (version > 0 AND number > 0);
ALTER TABLE "WorkspaceMember" ADD CHECK (role IN ('ADMIN','MEMBER'));
ALTER TABLE "ProjectMember" ADD CHECK (cardinality(roles)>0 AND roles <@ ARRAY['PRODUCT','ENGINEER','QA','OPS']::text[]);
ALTER TABLE "Attachment" ADD CHECK (size > 0 AND size <= 20971520);
CREATE INDEX "Task_priority_idx" ON "Task" ("projectId", (data->>'priority'));
CREATE INDEX "Task_product_idx" ON "Task" ((data->>'productId'));
CREATE INDEX "Task_engineer_idx" ON "Task" ((data->>'engineerId'));
CREATE INDEX "Task_tester_idx" ON "Task" ((data->>'testerId'));
CREATE INDEX "AuditEvent_resource_created_idx" ON "AuditEvent" ("resourceId", "createdAt");
CREATE INDEX "Attachment_task_idx" ON "Attachment" ("taskId");

-- Existing submitted revisions and audit events may only be appended to.
CREATE FUNCTION coflow_task_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text; old_items jsonb; new_items jsonb; i integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' OR jsonb_array_length(OLD.data->'requirements') > 0 THEN
      RAISE EXCEPTION 'Submitted tasks cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  FOREACH field IN ARRAY ARRAY['requirements','solutions','reviews','development','acceptances','history','comments','changes'] LOOP
    old_items := COALESCE(OLD.data->field, '[]'::jsonb);
    new_items := COALESCE(NEW.data->field, '[]'::jsonb);
    IF jsonb_array_length(new_items) < jsonb_array_length(old_items) THEN
      RAISE EXCEPTION 'Task history cannot be truncated' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(old_items) > 0 THEN
      FOR i IN 0..jsonb_array_length(old_items)-1 LOOP
        IF old_items->i IS DISTINCT FROM new_items->i THEN
          RAISE EXCEPTION 'Task history cannot be overwritten' USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER coflow_task_history BEFORE UPDATE OR DELETE ON "Task" FOR EACH ROW EXECUTE FUNCTION coflow_task_history_guard();

CREATE FUNCTION coflow_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit is immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER coflow_audit_immutable BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION coflow_audit_guard();

CREATE FUNCTION coflow_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i integer;
BEGIN
  IF jsonb_array_length(NEW.revisions) <> jsonb_array_length(OLD.revisions)+1 OR NEW.version <> OLD.version+1 THEN
    RAISE EXCEPTION 'Document revisions must be appended' USING ERRCODE = '23514';
  END IF;
  FOR i IN 0..jsonb_array_length(OLD.revisions)-1 LOOP
    IF OLD.revisions->i IS DISTINCT FROM NEW.revisions->i THEN
      RAISE EXCEPTION 'Document history cannot be overwritten' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER coflow_document_history BEFORE UPDATE ON "Document" FOR EACH ROW EXECUTE FUNCTION coflow_document_guard();

CREATE FUNCTION coflow_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project_id text; archived timestamp;
BEGIN
  IF TG_OP = 'DELETE' THEN project_id := OLD."projectId"; ELSE project_id := NEW."projectId"; END IF;
  SELECT "archivedAt" INTO archived FROM "Project" WHERE id = project_id FOR UPDATE;
  IF archived IS NOT NULL THEN RAISE EXCEPTION 'Archived project is read-only' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coflow_task_archive BEFORE INSERT OR UPDATE OR DELETE ON "Task" FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();
CREATE TRIGGER coflow_document_archive BEFORE INSERT OR UPDATE OR DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();
CREATE TRIGGER coflow_attachment_archive BEFORE INSERT OR UPDATE OR DELETE ON "Attachment" FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();
CREATE TRIGGER coflow_members_archive BEFORE INSERT OR UPDATE OR DELETE ON "ProjectMember" FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();

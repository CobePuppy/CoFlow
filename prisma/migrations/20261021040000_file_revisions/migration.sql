ALTER TABLE "SpaceFile" ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("contentVersion">0);
ALTER TABLE "TaskResource" ADD COLUMN "fileVersion" INTEGER CHECK ("fileVersion">0);
CREATE TABLE "SpaceFileRevision" (
 "id" TEXT PRIMARY KEY, "fileId" TEXT NOT NULL REFERENCES "SpaceFile"(id), "number" INTEGER NOT NULL CHECK (number>0), "key" TEXT NOT NULL,
 "name" TEXT NOT NULL, "mime" TEXT NOT NULL, "size" INTEGER NOT NULL CHECK (size>0 AND size<=20971520), "summary" TEXT NOT NULL,
 "createdBy" TEXT NOT NULL REFERENCES "User"(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SpaceFileRevision_fileId_number_key" ON "SpaceFileRevision"("fileId",number);
CREATE INDEX "SpaceFileRevision_key_idx" ON "SpaceFileRevision"(key);
INSERT INTO "SpaceFileRevision" (id,"fileId",number,key,name,mime,size,summary,"createdBy","createdAt")
 SELECT id||':v1',id,1,key,name,mime,size,'已有内容登记为V1；名称取迁移时名称',"userId","createdAt" FROM "SpaceFile";
CREATE OR REPLACE FUNCTION protect_space_file_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.scope,NEW."ownerId",NEW."workspaceId",NEW."userId",NEW.key) IS DISTINCT FROM ROW(OLD.scope,OLD."ownerId",OLD."workspaceId",OLD."userId",OLD.key) THEN RAISE EXCEPTION 'file ownership and original storage key are immutable'; END IF;
 IF NEW."contentVersion" <> OLD."contentVersion" THEN
  IF NEW."contentVersion"<>OLD."contentVersion"+1 OR NOT EXISTS(SELECT 1 FROM "SpaceFileRevision" r WHERE r."fileId"=NEW.id AND r.number=NEW."contentVersion" AND r.size=NEW.size AND r.mime=NEW.mime) THEN RAISE EXCEPTION 'append a matching content revision before updating the file'; END IF;
 ELSIF ROW(NEW.mime,NEW.size) IS DISTINCT FROM ROW(OLD.mime,OLD.size) THEN RAISE EXCEPTION 'file content metadata requires a new revision'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION protect_file_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'file revisions are immutable'; END $$;
CREATE TRIGGER file_revision_immutable BEFORE UPDATE OR DELETE ON "SpaceFileRevision" FOR EACH ROW EXECUTE FUNCTION protect_file_revision();

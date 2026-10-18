CREATE TABLE "ProofBoard" (
"competitionId" TEXT PRIMARY KEY REFERENCES "Competition"("id") ON DELETE CASCADE,
"workspaceId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
"data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId"));
CREATE INDEX "ProofBoard_projectId_idx" ON "ProofBoard"("projectId");
CREATE TRIGGER coflow_proof_archive BEFORE INSERT OR UPDATE OR DELETE ON "ProofBoard" FOR EACH ROW EXECUTE FUNCTION coflow_archive_guard();
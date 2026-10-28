ALTER TABLE "Project" ADD COLUMN "qualityGate" TEXT NOT NULL DEFAULT 'REMIND';
ALTER TABLE "Project" ADD CONSTRAINT "Project_qualityGate_check" CHECK ("qualityGate" IN ('REMIND','STRICT'));

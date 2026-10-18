CREATE TABLE "TeamCode" (
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    CONSTRAINT "TeamCode_pkey" PRIMARY KEY ("workspaceId")
);
CREATE UNIQUE INDEX "TeamCode_code_key" ON "TeamCode"("code");

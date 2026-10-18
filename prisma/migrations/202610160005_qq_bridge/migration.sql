CREATE TABLE "QQBinding" (
 "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "qq" TEXT NOT NULL CHECK ("qq" ~ '^[1-9][0-9]{4,14}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId", "userId"),
 UNIQUE ("workspaceId", "qq")
);
CREATE TABLE "QQBindingCode" (
 "hash" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 UNIQUE ("workspaceId", "userId")
);

-- Character editor (Phase 2): a user-composed avatar. Purely additive — a new
-- table with a unique userId (one custom avatar per user) and an ON DELETE
-- CASCADE foreign key, so removing a user removes its row automatically. The
-- generated sprite/preview files are cleaned up separately in the delete path
-- (a DB cascade does not touch the filesystem).

-- CreateTable
CREATE TABLE "CustomAvatar" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "config" JSONB NOT NULL,
    "spriteUrl" TEXT NOT NULL,
    "previewUrl" TEXT,
    "configHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomAvatar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomAvatar_uuid_key" ON "CustomAvatar"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "CustomAvatar_userId_key" ON "CustomAvatar"("userId");

-- AddForeignKey
ALTER TABLE "CustomAvatar" ADD CONSTRAINT "CustomAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

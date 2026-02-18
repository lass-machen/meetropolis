-- DropIndex
DROP INDEX IF EXISTS "Room_tenantId_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "Room_mapId_name_key" ON "Room"("mapId", "name");

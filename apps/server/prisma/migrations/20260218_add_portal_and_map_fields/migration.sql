-- AlterTable: Add portal zone fields to Zone
ALTER TABLE "Zone" ADD COLUMN "type" TEXT;
ALTER TABLE "Zone" ADD COLUMN "portalTarget" TEXT;
ALTER TABLE "Zone" ADD COLUMN "portalSpawnX" INTEGER;
ALTER TABLE "Zone" ADD COLUMN "portalSpawnY" INTEGER;

-- AlterTable: Add mapName to Presence
ALTER TABLE "Presence" ADD COLUMN "mapName" TEXT;

-- AlterTable
ALTER TABLE "Map" ADD COLUMN     "nextAutotileSlot" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "MapAutotile" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "packUuid" TEXT NOT NULL,
    "autotileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "tileWidth" INTEGER NOT NULL,
    "tileHeight" INTEGER NOT NULL,
    "gridHeight" INTEGER NOT NULL,
    "variants" JSONB NOT NULL,
    "collide" BOOLEAN NOT NULL,
    "placement" TEXT NOT NULL,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapAutotile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapAutotile_mapId_idx" ON "MapAutotile"("mapId");

-- CreateIndex
CREATE UNIQUE INDEX "MapAutotile_mapId_slot_key" ON "MapAutotile"("mapId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "MapAutotile_mapId_packUuid_autotileId_key" ON "MapAutotile"("mapId", "packUuid", "autotileId");

-- AddForeignKey
ALTER TABLE "MapAutotile" ADD CONSTRAINT "MapAutotile_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

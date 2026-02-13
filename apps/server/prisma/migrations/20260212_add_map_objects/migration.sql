-- CreateTable
CREATE TABLE "MapObject" (
    "id" SERIAL NOT NULL,
    "mapId" TEXT NOT NULL,
    "assetPackUuid" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tileX" INTEGER NOT NULL,
    "tileY" INTEGER NOT NULL,
    "chunkX" INTEGER NOT NULL,
    "chunkY" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "collide" BOOLEAN NOT NULL DEFAULT false,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "flipX" BOOLEAN NOT NULL DEFAULT false,
    "flipY" BOOLEAN NOT NULL DEFAULT false,
    "dataUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapObject_mapId_chunkX_chunkY_idx" ON "MapObject"("mapId", "chunkX", "chunkY");

-- AddForeignKey
ALTER TABLE "MapObject" ADD CONSTRAINT "MapObject_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

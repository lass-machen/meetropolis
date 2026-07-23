-- Depth-layering (Strang B/C): two additive, backward-compatible columns on
-- MapObject. Both carry a default, so existing rows keep the legacy behaviour
-- and the migration is safe to apply on a live table without a backfill.
--
--   collisionBaseHeight = 0        -> the full footprint collides (legacy)
--   collisionBaseHeight = N (> 0)  -> only the bottom N tile rows collide
--                                     (e.g. a plant blocks its pot, not its crown)
--   renderLayer = 'sorted'         -> y-sorted by foot line (legacy render)
--   renderLayer = 'floor'|'overhead' -> under / always above actors

ALTER TABLE "MapObject" ADD COLUMN "collisionBaseHeight" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MapObject" ADD COLUMN "renderLayer" TEXT NOT NULL DEFAULT 'sorted';

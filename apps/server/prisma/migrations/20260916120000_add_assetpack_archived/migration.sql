-- Archiving hides an AssetPack from editor palette collection endpoints while
-- keeping the row, files and every already-placed MapObject intact. Direct pack
-- lookups and operational maintenance reads deliberately remain available.
--
-- The default makes this additive migration safe for existing installations:
-- all current packs remain visible until an internal platform owner explicitly
-- archives them.

ALTER TABLE "AssetPack" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

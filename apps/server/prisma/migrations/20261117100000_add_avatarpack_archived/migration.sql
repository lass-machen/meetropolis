-- Archiving hides an AvatarPack from picker/registry collection endpoints while
-- keeping the row, files and every already-selected avatar intact. Direct pack
-- lookups and wear/resolve reads deliberately remain available.
--
-- The default makes this additive migration safe for existing installations:
-- all current packs remain visible until an internal platform owner explicitly
-- archives them.

ALTER TABLE "AvatarPack" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

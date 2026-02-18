-- Fix incorrect map width: maps stored as 32x32 are actually 64x32
UPDATE "Map" SET "width" = 64 WHERE "width" = 32 AND "height" = 32;

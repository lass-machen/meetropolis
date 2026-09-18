ALTER TABLE "Map" ADD COLUMN "collisionSourcesMigratedAt" TIMESTAMP(3);

-- Preserve NULL on pre-cutover rows while marking every future map as native
-- to the separated collision-source model.
ALTER TABLE "Map" ALTER COLUMN "collisionSourcesMigratedAt" SET DEFAULT CURRENT_TIMESTAMP;

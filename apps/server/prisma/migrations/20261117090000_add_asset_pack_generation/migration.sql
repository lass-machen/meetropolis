-- Nullable pointer to the active asset pack generation. NULL means a
-- legacy pack whose files live directly under the pack directory. Additive
-- only: no backfill, no default, existing rows stay NULL by design.

ALTER TABLE "AssetPack" ADD COLUMN "currentGeneration" TEXT;

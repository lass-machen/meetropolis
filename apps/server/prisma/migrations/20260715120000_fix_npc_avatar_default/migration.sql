-- Fix the incorrect Npc.avatarId column default. The baseline shipped
-- "default-characters:businessman1", but that avatar key does not exist. The
-- canonical default character keys are defined in prisma/seed.ts; the correct
-- default is "default-characters:business_man". A wrong default caused NPCs
-- created without an explicit avatarId to render as a missing texture.

-- 1. Correct the column default for future inserts.
ALTER TABLE "Npc" ALTER COLUMN "avatarId" SET DEFAULT 'default-characters:business_man';

-- 2. Repair existing rows that were created with the broken default. Guarded by
--    the exact broken value, so this is idempotent and leaves customized
--    avatarId values untouched.
UPDATE "Npc"
SET "avatarId" = 'default-characters:business_man'
WHERE "avatarId" = 'default-characters:businessman1';

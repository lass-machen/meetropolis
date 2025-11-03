-- Tenancy migration with backfill for existing data (PostgreSQL)
-- Safe for existing deployments: adds tables/columns, backfills data, then enforces constraints.

BEGIN;

-- 1) Tenant table
CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" text PRIMARY KEY,
  "slug" text UNIQUE NOT NULL,
  "name" text NOT NULL,
  "concurrentLimit" integer NOT NULL DEFAULT 50,
  "freeSeats" integer NOT NULL DEFAULT 3,
  "bypassLimits" boolean NOT NULL DEFAULT false,
  "isInternal" boolean NOT NULL DEFAULT false,
  "stripeCustomerId" text NULL,
  "stripeSubscriptionId" text NULL,
  "status" text NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Seed default/internal tenants if missing
INSERT INTO "Tenant" ("id","slug","name","concurrentLimit","bypassLimits","isInternal")
VALUES ('t_default','default','Default',50,false,false)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Tenant" ("id","slug","name","concurrentLimit","bypassLimits","isInternal")
VALUES ('t_internal','internal','Internal',999999,true,true)
ON CONFLICT ("slug") DO NOTHING;

-- 2) Add tenantId to domain tables (nullable first), backfill, then enforce

-- Map
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Map" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE slug='default') WHERE "tenantId" IS NULL;
ALTER TABLE "Map" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Map" ADD CONSTRAINT IF NOT EXISTS "Map_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Map_tenantId_name_key') THEN
    ALTER TABLE "Map" ADD CONSTRAINT "Map_tenantId_name_key" UNIQUE ("tenantId","name");
  END IF;
END $$;

-- Room
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Room" r SET "tenantId" = m."tenantId" FROM "Map" m WHERE r."mapId" = m."id" AND r."tenantId" IS NULL;
ALTER TABLE "Room" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Room" ADD CONSTRAINT IF NOT EXISTS "Room_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Room_tenantId_name_key') THEN
    ALTER TABLE "Room" ADD CONSTRAINT "Room_tenantId_name_key" UNIQUE ("tenantId","name");
  END IF;
END $$;

-- Zone
ALTER TABLE "Zone" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Zone" z SET "tenantId" = m."tenantId" FROM "Map" m WHERE z."mapId" = m."id" AND z."tenantId" IS NULL;
ALTER TABLE "Zone" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Zone" ADD CONSTRAINT IF NOT EXISTS "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Presence
ALTER TABLE "Presence" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Presence" p SET "tenantId" = r."tenantId" FROM "Room" r WHERE p."roomId" = r."id" AND p."tenantId" IS NULL;
ALTER TABLE "Presence" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Presence" ADD CONSTRAINT IF NOT EXISTS "Presence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invite
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Invite" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE slug='default') WHERE "tenantId" IS NULL;
ALTER TABLE "Invite" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Invite" ADD CONSTRAINT IF NOT EXISTS "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) Membership table (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name='Membership'
  ) THEN
    CREATE TABLE "Membership" (
      "id" text PRIMARY KEY,
      "tenantId" text NOT NULL,
      "userId" text NOT NULL,
      "role" text NOT NULL DEFAULT 'member',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Membership_tenantId_userId_key" UNIQUE ("tenantId","userId")
    );
  END IF;
END $$;

COMMIT;



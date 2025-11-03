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

-- Create enum Role if missing and align role columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
    CREATE TYPE "Role" AS ENUM ('owner','admin','member');
  END IF;
END $$;

-- Invite.role column (enum)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='Invite' AND column_name='role'
  ) THEN
    ALTER TABLE "Invite" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'member';
  END IF;
END $$;

-- If Membership exists with text role, convert to enum
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='Membership' AND column_name='role' AND udt_name <> 'Role'
  ) THEN
    ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
    ALTER TABLE "Membership" ALTER COLUMN "role" SET NOT NULL;
    ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'member';
  END IF;
END $$;

-- Map
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Map" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE slug='default') WHERE "tenantId" IS NULL;
ALTER TABLE "Map" ALTER COLUMN "tenantId" SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Map_tenantId_fkey') THEN
    ALTER TABLE "Map" ADD CONSTRAINT "Map_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Map_tenantId_name_key') THEN
    ALTER TABLE "Map" ADD CONSTRAINT "Map_tenantId_name_key" UNIQUE ("tenantId","name");
  END IF;
END $$;

-- Room
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Room" r SET "tenantId" = m."tenantId" FROM "Map" m WHERE r."mapId" = m."id" AND r."tenantId" IS NULL;
ALTER TABLE "Room" ALTER COLUMN "tenantId" SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Room_tenantId_fkey') THEN
    ALTER TABLE "Room" ADD CONSTRAINT "Room_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Room_tenantId_name_key') THEN
    ALTER TABLE "Room" ADD CONSTRAINT "Room_tenantId_name_key" UNIQUE ("tenantId","name");
  END IF;
END $$;

-- Zone
ALTER TABLE "Zone" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Zone" z SET "tenantId" = m."tenantId" FROM "Map" m WHERE z."mapId" = m."id" AND z."tenantId" IS NULL;
ALTER TABLE "Zone" ALTER COLUMN "tenantId" SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Zone_tenantId_fkey') THEN
    ALTER TABLE "Zone" ADD CONSTRAINT "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Presence
ALTER TABLE "Presence" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Presence" p SET "tenantId" = r."tenantId" FROM "Room" r WHERE p."roomId" = r."id" AND p."tenantId" IS NULL;
ALTER TABLE "Presence" ALTER COLUMN "tenantId" SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Presence_tenantId_fkey') THEN
    ALTER TABLE "Presence" ADD CONSTRAINT "Presence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Invite
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "tenantId" text;
UPDATE "Invite" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE slug='default') WHERE "tenantId" IS NULL;
ALTER TABLE "Invite" ALTER COLUMN "tenantId" SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Invite_tenantId_fkey') THEN
    ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Membership table (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name='Membership'
  ) THEN
    CREATE TABLE "Membership" (
      "id" text PRIMARY KEY,
      "tenantId" text NOT NULL,
      "userId" text NOT NULL,
      "role" "Role" NOT NULL DEFAULT 'member',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Membership_tenantId_userId_key" UNIQUE ("tenantId","userId")
    );
  END IF;
END $$;

COMMIT;



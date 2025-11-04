-- Follow-up migration to ensure Role enum and role columns exist
-- Idempotent guards for production safety

BEGIN;

-- Create enum Role if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
    CREATE TYPE "Role" AS ENUM ('owner','admin','member');
  END IF;
END $$;

-- Ensure Invite.role exists as Role enum with default
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='Invite' AND column_name='role'
  ) THEN
    ALTER TABLE "Invite" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'member';
  END IF;
END $$;

-- Ensure Membership.role is of type Role (convert from text if needed)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='Membership' AND column_name='role' AND udt_name <> 'Role'
  ) THEN
    ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
    ALTER TABLE "Membership" ALTER COLUMN "role" SET NOT NULL;
    ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'member';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='Membership' AND column_name='role'
  ) THEN
    ALTER TABLE "Membership" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'member';
  END IF;
END $$;

COMMIT;



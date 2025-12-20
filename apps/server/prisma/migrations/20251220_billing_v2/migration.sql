-- Billing System V2: Trials, Dunning, Pause, Audit
-- This migration adds fields for trial tracking, payment failure handling,
-- subscription pause, and billing audit logging.

BEGIN;

-- ============================================================================
-- TRIAL TRACKING FIELDS ON TENANT
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='trialStartedAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='trialEndsAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='trialConvertedAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "trialConvertedAt" TIMESTAMP(3);
  END IF;
END $$;

-- ============================================================================
-- PAYMENT FAILURE / DUNNING FIELDS ON TENANT
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='paymentFailedAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "paymentFailedAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='gracePeriodEndsAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "gracePeriodEndsAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='dunningStep'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "dunningStep" INTEGER DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='lastDunningEmailAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "lastDunningEmailAt" TIMESTAMP(3);
  END IF;
END $$;

-- ============================================================================
-- SUBSCRIPTION PAUSE FIELDS ON TENANT
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='pausedAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "pausedAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='pauseEndsAt'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "pauseEndsAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='Tenant' AND column_name='pauseReason'
  ) THEN
    ALTER TABLE "Tenant" ADD COLUMN "pauseReason" TEXT;
  END IF;
END $$;

-- ============================================================================
-- BILLING AUDIT LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS "BillingAuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventSource" TEXT NOT NULL,
  "stripeEventId" TEXT,
  "previousValues" JSONB,
  "newValues" JSONB,
  "triggeredBy" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingAuditLog_pkey" PRIMARY KEY ("id")
);

-- Indexes for BillingAuditLog
CREATE INDEX IF NOT EXISTS "BillingAuditLog_tenantId_idx" ON "BillingAuditLog"("tenantId");
CREATE INDEX IF NOT EXISTS "BillingAuditLog_eventType_idx" ON "BillingAuditLog"("eventType");
CREATE INDEX IF NOT EXISTS "BillingAuditLog_createdAt_idx" ON "BillingAuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "BillingAuditLog_stripeEventId_idx" ON "BillingAuditLog"("stripeEventId");

-- Foreign key constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'BillingAuditLog_tenantId_fkey'
  ) THEN
    ALTER TABLE "BillingAuditLog"
    ADD CONSTRAINT "BillingAuditLog_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

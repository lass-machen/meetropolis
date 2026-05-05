-- OSS schema separation: drop enterprise billing tables and Tenant Stripe columns.
-- Idempotent — `IF EXISTS` allows running on either an upgraded DB (which had
-- these from the legacy baseline) or a brand-new OSS install where they were
-- never created. The enterprise submodule re-creates them via its own
-- `add_enterprise_billing_schema` migration when present.

-- 1. Enterprise-only tables (drop in dependency order)
DROP TABLE IF EXISTS "TenantAvatarPack" CASCADE;
DROP TABLE IF EXISTS "TenantAssetPack" CASCADE;
DROP TABLE IF EXISTS "AvatarPackCatalog" CASCADE;
DROP TABLE IF EXISTS "AssetPackCatalog" CASCADE;
DROP TABLE IF EXISTS "BillingAuditLog" CASCADE;
DROP TABLE IF EXISTS "PricingPlan" CASCADE;

-- 2. Enterprise-only enum (only used by AssetPackCatalog/AvatarPackCatalog)
DROP TYPE IF EXISTS "PackPricingModel";

-- 3. Tenant Stripe / trial / dunning / pause columns
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "stripeCustomerId";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "stripeSubscriptionId";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "status";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "trialStartedAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "trialEndsAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "trialConvertedAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "paymentFailedAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "gracePeriodEndsAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "dunningStep";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "lastDunningEmailAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "pausedAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "pauseEndsAt";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "pauseReason";

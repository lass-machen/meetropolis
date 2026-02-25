-- OSS Enterprise Cleanup: Remove billing/marketplace enterprise features

-- Drop enterprise tables
DROP TABLE IF EXISTS "BillingAuditLog";
DROP TABLE IF EXISTS "TenantAssetPack";
DROP TABLE IF EXISTS "TenantAvatarPack";
DROP TABLE IF EXISTS "AssetPackCatalog";
DROP TABLE IF EXISTS "AvatarPackCatalog";

-- Remove enterprise columns from Tenant
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

-- Drop enterprise enum
DROP TYPE IF EXISTS "PackPricingModel";

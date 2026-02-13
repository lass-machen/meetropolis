-- CreateEnum
CREATE TYPE "PackPricingModel" AS ENUM ('free', 'one_time', 'subscription');

-- CreateTable
CREATE TABLE "AssetPackCatalog" (
    "id" TEXT NOT NULL,
    "assetPackId" INTEGER NOT NULL,
    "pricingModel" "PackPricingModel" NOT NULL DEFAULT 'free',
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "priceAmountCents" INTEGER NOT NULL DEFAULT 0,
    "priceCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "priceInterval" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "previewImageUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetPackCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAssetPack" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetPackId" INTEGER NOT NULL,
    "grantSource" TEXT NOT NULL,
    "purchasedMajorVersion" INTEGER NOT NULL DEFAULT 0,
    "stripePaymentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAssetPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarPackCatalog" (
    "id" TEXT NOT NULL,
    "avatarPackId" INTEGER NOT NULL,
    "pricingModel" "PackPricingModel" NOT NULL DEFAULT 'free',
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "priceAmountCents" INTEGER NOT NULL DEFAULT 0,
    "priceCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "priceInterval" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "previewImageUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvatarPackCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAvatarPack" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "avatarPackId" INTEGER NOT NULL,
    "grantSource" TEXT NOT NULL,
    "purchasedMajorVersion" INTEGER NOT NULL DEFAULT 0,
    "stripePaymentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAvatarPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetPackCatalog_assetPackId_key" ON "AssetPackCatalog"("assetPackId");

-- CreateIndex
CREATE INDEX "TenantAssetPack_tenantId_idx" ON "TenantAssetPack"("tenantId");

-- CreateIndex
CREATE INDEX "TenantAssetPack_assetPackId_idx" ON "TenantAssetPack"("assetPackId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAssetPack_tenantId_assetPackId_key" ON "TenantAssetPack"("tenantId", "assetPackId");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarPackCatalog_avatarPackId_key" ON "AvatarPackCatalog"("avatarPackId");

-- CreateIndex
CREATE INDEX "TenantAvatarPack_tenantId_idx" ON "TenantAvatarPack"("tenantId");

-- CreateIndex
CREATE INDEX "TenantAvatarPack_avatarPackId_idx" ON "TenantAvatarPack"("avatarPackId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAvatarPack_tenantId_avatarPackId_key" ON "TenantAvatarPack"("tenantId", "avatarPackId");

-- AddForeignKey
ALTER TABLE "AssetPackCatalog" ADD CONSTRAINT "AssetPackCatalog_assetPackId_fkey" FOREIGN KEY ("assetPackId") REFERENCES "AssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAssetPack" ADD CONSTRAINT "TenantAssetPack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAssetPack" ADD CONSTRAINT "TenantAssetPack_assetPackId_fkey" FOREIGN KEY ("assetPackId") REFERENCES "AssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarPackCatalog" ADD CONSTRAINT "AvatarPackCatalog_avatarPackId_fkey" FOREIGN KEY ("avatarPackId") REFERENCES "AvatarPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAvatarPack" ADD CONSTRAINT "TenantAvatarPack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAvatarPack" ADD CONSTRAINT "TenantAvatarPack_avatarPackId_fkey" FOREIGN KEY ("avatarPackId") REFERENCES "AvatarPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

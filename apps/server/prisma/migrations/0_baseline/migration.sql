-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'member', 'guest');

-- CreateEnum
CREATE TYPE "PackPricingModel" AS ENUM ('free', 'one_time', 'subscription');

-- CreateEnum
CREATE TYPE "NpcMediaType" AS ENUM ('audio', 'video', 'screenshare');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "concurrentLimit" INTEGER NOT NULL DEFAULT 50,
    "freeSeats" INTEGER NOT NULL DEFAULT 3,
    "bypassLimits" BOOLEAN NOT NULL DEFAULT false,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "defaultMapName" TEXT DEFAULT 'office',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "status" TEXT,
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "trialConvertedAt" TIMESTAMP(3),
    "paymentFailedAt" TIMESTAMP(3),
    "gracePeriodEndsAt" TIMESTAMP(3),
    "dunningStep" INTEGER DEFAULT 0,
    "lastDunningEmailAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pauseEndsAt" TIMESTAMP(3),
    "pauseReason" TEXT,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'member',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "imageUrl" TEXT,
    "avatarId" TEXT,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'member',

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "hash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Map" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "tileWidth" INTEGER,
    "tileHeight" INTEGER,
    "chunkSize" INTEGER DEFAULT 32,
    "version" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "polygon" JSONB NOT NULL,
    "type" TEXT,
    "portalTarget" TEXT,
    "portalSpawnX" INTEGER,
    "portalSpawnY" INTEGER,
    "roomId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "mapName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetPack" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "terrain" JSONB NOT NULL,
    "structures" JSONB NOT NULL,
    "objects" JSONB NOT NULL,
    "autotiles" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarPack" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'full',
    "avatars" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvatarPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapTileset" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "tileWidth" INTEGER NOT NULL,
    "tileHeight" INTEGER NOT NULL,
    "margin" INTEGER,
    "spacing" INTEGER,
    "hash" TEXT,
    "tileCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapTileset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapLayer" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapChunk" (
    "id" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "encoding" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapObject" (
    "id" SERIAL NOT NULL,
    "mapId" TEXT NOT NULL,
    "assetPackUuid" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tileX" INTEGER NOT NULL,
    "tileY" INTEGER NOT NULL,
    "chunkX" INTEGER NOT NULL,
    "chunkY" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "collide" BOOLEAN NOT NULL DEFAULT false,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "flipX" BOOLEAN NOT NULL DEFAULT false,
    "flipY" BOOLEAN NOT NULL DEFAULT false,
    "scaleFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "dataUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Npc" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL DEFAULT 'default-characters:businessman1',
    "spawnX" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "spawnY" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "spawnDirection" TEXT NOT NULL DEFAULT 'down',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "showBadge" BOOLEAN NOT NULL DEFAULT false,
    "mapName" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Npc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcMediaFile" (
    "id" TEXT NOT NULL,
    "npcId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION,
    "mediaType" "NpcMediaType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NpcMediaFile_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "BillingAuditLog" (
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

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestToken_token_key" ON "GuestToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "GuestToken_membershipId_key" ON "GuestToken"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_token_key" ON "PasswordReset"("token");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_token_key" ON "EmailVerification"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_hash_key" ON "ApiToken"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Map_tenantId_name_key" ON "Map"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Room_mapId_name_key" ON "Room"("mapId", "name");

-- CreateIndex
CREATE INDEX "Presence_userId_roomId_idx" ON "Presence"("userId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetPack_uuid_key" ON "AssetPack"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarPack_uuid_key" ON "AvatarPack"("uuid");

-- CreateIndex
CREATE INDEX "MapTileset_mapId_idx" ON "MapTileset"("mapId");

-- CreateIndex
CREATE UNIQUE INDEX "MapTileset_mapId_slot_key" ON "MapTileset"("mapId", "slot");

-- CreateIndex
CREATE INDEX "MapLayer_mapId_idx" ON "MapLayer"("mapId");

-- CreateIndex
CREATE UNIQUE INDEX "MapLayer_mapId_name_key" ON "MapLayer"("mapId", "name");

-- CreateIndex
CREATE INDEX "MapChunk_layerId_idx" ON "MapChunk"("layerId");

-- CreateIndex
CREATE UNIQUE INDEX "MapChunk_layerId_x_y_key" ON "MapChunk"("layerId", "x", "y");

-- CreateIndex
CREATE INDEX "MapObject_mapId_chunkX_chunkY_idx" ON "MapObject"("mapId", "chunkX", "chunkY");

-- CreateIndex
CREATE INDEX "Npc_tenantId_idx" ON "Npc"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Npc_tenantId_identity_key" ON "Npc"("tenantId", "identity");

-- CreateIndex
CREATE INDEX "NpcMediaFile_npcId_idx" ON "NpcMediaFile"("npcId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetPackCatalog_assetPackId_key" ON "AssetPackCatalog"("assetPackId");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarPackCatalog_avatarPackId_key" ON "AvatarPackCatalog"("avatarPackId");

-- CreateIndex
CREATE INDEX "TenantAssetPack_tenantId_idx" ON "TenantAssetPack"("tenantId");

-- CreateIndex
CREATE INDEX "TenantAssetPack_assetPackId_idx" ON "TenantAssetPack"("assetPackId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAssetPack_tenantId_assetPackId_key" ON "TenantAssetPack"("tenantId", "assetPackId");

-- CreateIndex
CREATE INDEX "TenantAvatarPack_tenantId_idx" ON "TenantAvatarPack"("tenantId");

-- CreateIndex
CREATE INDEX "TenantAvatarPack_avatarPackId_idx" ON "TenantAvatarPack"("avatarPackId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAvatarPack_tenantId_avatarPackId_key" ON "TenantAvatarPack"("tenantId", "avatarPackId");

-- CreateIndex
CREATE INDEX "BillingAuditLog_tenantId_idx" ON "BillingAuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "BillingAuditLog_eventType_idx" ON "BillingAuditLog"("eventType");

-- CreateIndex
CREATE INDEX "BillingAuditLog_createdAt_idx" ON "BillingAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditLog_stripeEventId_idx" ON "BillingAuditLog"("stripeEventId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestToken" ADD CONSTRAINT "GuestToken_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Map" ADD CONSTRAINT "Map_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapTileset" ADD CONSTRAINT "MapTileset_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapLayer" ADD CONSTRAINT "MapLayer_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapChunk" ADD CONSTRAINT "MapChunk_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "MapLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapObject" ADD CONSTRAINT "MapObject_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Npc" ADD CONSTRAINT "Npc_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcMediaFile" ADD CONSTRAINT "NpcMediaFile_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "Npc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPackCatalog" ADD CONSTRAINT "AssetPackCatalog_assetPackId_fkey" FOREIGN KEY ("assetPackId") REFERENCES "AssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarPackCatalog" ADD CONSTRAINT "AvatarPackCatalog_avatarPackId_fkey" FOREIGN KEY ("avatarPackId") REFERENCES "AvatarPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAssetPack" ADD CONSTRAINT "TenantAssetPack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAssetPack" ADD CONSTRAINT "TenantAssetPack_assetPackId_fkey" FOREIGN KEY ("assetPackId") REFERENCES "AssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAvatarPack" ADD CONSTRAINT "TenantAvatarPack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAvatarPack" ADD CONSTRAINT "TenantAvatarPack_avatarPackId_fkey" FOREIGN KEY ("avatarPackId") REFERENCES "AvatarPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAuditLog" ADD CONSTRAINT "BillingAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


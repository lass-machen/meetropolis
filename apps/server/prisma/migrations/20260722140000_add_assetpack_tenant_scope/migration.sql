-- Tenant scope for asset packs (the editor palette). Mirrors
-- 20260722100000_add_avatarpack_tenant_scope one-for-one; the two pack kinds
-- share a single scope implementation in services/packScope.ts and must not
-- drift apart at the schema level either.
--
-- Purely additive and safe on a live table: a nullable column without a default
-- is a metadata-only ADD COLUMN in PostgreSQL (no table rewrite), and existing
-- rows keep NULL.
--
--   tenantId IS NULL   -> platform catalog pack, visible to every tenant
--   tenantId = <id>    -> owned by and private to that single tenant
--
-- No backfill on purpose: every pack that exists today is a catalog pack by
-- definition of the previous (unscoped) behaviour. Making a specific pack
-- private is a deployment decision, not a schema decision, and is therefore
-- done once by hand in the cutover runbook — a migration would re-run against
-- every self-host installation, where the tenants in question do not exist.
--
-- ON DELETE CASCADE is deliberate: Prisma's default for an optional relation
-- would be SET NULL, which would turn a private pack into a platform-wide
-- catalog pack the moment its owning tenant is deleted (fail-open leak).
-- RESTRICT would be the other fail-closed option but blocks tenant deletion
-- outright, so CASCADE it is.
--
-- Already-placed MapObjects keep rendering: they carry their sprite in
-- `MapObject.dataUrl`, so making a pack private changes the palette, not an
-- existing map. The one nuance is `directionalImages` — that registry is fed
-- from the scoped `GET /asset-packs` response, so a tenant that loses access to
-- a pack falls back to programmatic rotation of the base sprite for objects out
-- of it. See the comment above `model AssetPack` in schema.prisma.
--
-- This migration does not touch the enterprise `TenantAssetPack` grant table or
-- `AssetPackCatalog`. Ownership (this column) and grants/marketplace listing
-- (those tables) are different concepts; the constraint/index names are
-- disjoint.

ALTER TABLE "AssetPack" ADD COLUMN "tenantId" TEXT;

-- CreateIndex
CREATE INDEX "AssetPack_tenantId_idx" ON "AssetPack"("tenantId");

-- AddForeignKey
ALTER TABLE "AssetPack" ADD CONSTRAINT "AssetPack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

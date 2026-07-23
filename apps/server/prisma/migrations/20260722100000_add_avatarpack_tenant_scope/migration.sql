-- Tenant scope for avatar packs. Purely additive and safe on a live table:
-- a nullable column without a default is a metadata-only ADD COLUMN in
-- PostgreSQL (no table rewrite), and existing rows keep NULL.
--
--   tenantId IS NULL   -> platform catalog pack, visible to every tenant
--   tenantId = <id>    -> owned by and private to that single tenant
--
-- No backfill on purpose: every pack that exists today is a catalog pack by
-- definition of the previous (unscoped) behaviour. Making a specific pack
-- private is a deployment decision, not a schema decision, and is therefore
-- done once by hand in the cutover runbook — a migration would re-run against
-- every self-host installation, where the tenant in question does not exist.
--
-- ON DELETE CASCADE is deliberate: Prisma's default for an optional relation
-- would be SET NULL, which would turn a private pack into a platform-wide
-- catalog pack the moment its owning tenant is deleted (fail-open leak).
--
-- This migration does not touch the enterprise `TenantAvatarPack` grant table.
-- Ownership (this column) and grants (that table) are different concepts; the
-- constraint/index names are disjoint.

ALTER TABLE "AvatarPack" ADD COLUMN "tenantId" TEXT;

-- CreateIndex
CREATE INDEX "AvatarPack_tenantId_idx" ON "AvatarPack"("tenantId");

-- AddForeignKey
ALTER TABLE "AvatarPack" ADD CONSTRAINT "AvatarPack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

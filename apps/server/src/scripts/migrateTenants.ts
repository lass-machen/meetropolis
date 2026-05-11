import 'dotenv/config';
import { createPrismaClient } from '../db.js';

const prisma = createPrismaClient();

type TenantRef = { id: string };

async function ensureBaseTenants() {
  const internal = await prisma.tenant.upsert({
    where: { slug: 'internal' },
    create: { slug: 'internal', name: 'Internal', concurrentLimit: 999999, bypassLimits: true, isInternal: true },
    update: {},
  });
  const def = await prisma.tenant.upsert({
    where: { slug: 'default' },
    create: { slug: 'default', name: 'Default', concurrentLimit: 50 },
    update: {},
  });
  return { internal, def };
}

function resolveTargetTenant(internal: TenantRef, def: TenantRef): Promise<TenantRef> {
  const targetSlug = (process.env.MIGRATE_EXISTING_TO_SLUG || 'default').toLowerCase();
  if (targetSlug === 'internal') return Promise.resolve(internal);
  if (targetSlug === 'default') return Promise.resolve(def);
  return prisma.tenant.upsert({
    where: { slug: targetSlug },
    create: { slug: targetSlug, name: targetSlug, concurrentLimit: 999999, bypassLimits: true },
    update: {},
  });
}

/**
 * On modern schemas tenantId is non-nullable, so these checks read as
 * truthy guards (a defensive no-op on fresh DBs). The casts to a partial
 * legacy shape exist purely to keep the script runnable against pre-migration
 * databases where the column may not yet be populated.
 */
type LegacyTenanted = { tenantId?: string | null };

async function backfillMaps(target: TenantRef) {
  const maps = await prisma.map.findMany();
  for (const m of maps) {
    if (!(m as LegacyTenanted).tenantId) {
      await prisma.map.update({ where: { id: m.id }, data: { tenantId: target.id } });
    }
  }
}

async function backfillRooms(target: TenantRef) {
  const rooms = await prisma.room.findMany();
  for (const r of rooms) {
    if (!(r as LegacyTenanted).tenantId) {
      const map = await prisma.map.findUnique({ where: { id: r.mapId } });
      const fromMap = (map as LegacyTenanted | null)?.tenantId ?? null;
      await prisma.room.update({ where: { id: r.id }, data: { tenantId: fromMap || target.id } });
    }
  }
}

async function backfillZones(target: TenantRef) {
  const zones = await prisma.zone.findMany();
  for (const z of zones) {
    if (!(z as LegacyTenanted).tenantId) {
      const map = await prisma.map.findUnique({ where: { id: z.mapId } });
      const fromMap = (map as LegacyTenanted | null)?.tenantId ?? null;
      await prisma.zone.update({ where: { id: z.id }, data: { tenantId: fromMap || target.id } });
    }
  }
}

async function backfillPresences(target: TenantRef) {
  const presences = await prisma.presence.findMany();
  for (const p of presences) {
    if (!(p as LegacyTenanted).tenantId) {
      const room = await prisma.room.findUnique({ where: { id: p.roomId } });
      const fromRoom = (room as LegacyTenanted | null)?.tenantId ?? null;
      await prisma.presence.update({
        where: { id: p.id },
        data: { tenantId: fromRoom || target.id },
      });
    }
  }
}

async function backfillInvites(target: TenantRef) {
  const invites = await prisma.invite.findMany();
  for (const inv of invites) {
    if (!(inv as LegacyTenanted).tenantId) {
      await prisma.invite.update({ where: { id: inv.id }, data: { tenantId: target.id } });
    }
  }
}

async function ensureUserMemberships(target: TenantRef) {
  const users = await prisma.user.findMany();
  for (const u of users) {
    try {
      await prisma.membership.upsert({
        where: { tenantId_userId: { tenantId: target.id, userId: u.id } },
        update: {},
        create: { tenantId: target.id, userId: u.id, role: 'member' },
      });
    } catch {}
  }
}

async function main() {
  const { internal, def } = await ensureBaseTenants();
  const target = await resolveTargetTenant(internal, def);

  await backfillMaps(target);
  await backfillRooms(target);
  await backfillZones(target);
  await backfillPresences(target);
  await backfillInvites(target);
  await ensureUserMemberships(target);

  console.log('Tenant migration complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

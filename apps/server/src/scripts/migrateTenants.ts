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

async function resolveTargetTenant(internal: TenantRef, def: TenantRef): Promise<TenantRef> {
  const targetSlug = (process.env.MIGRATE_EXISTING_TO_SLUG || 'default').toLowerCase();
  if (targetSlug === 'internal') return internal;
  if (targetSlug === 'default') return def;
  return prisma.tenant.upsert({
    where: { slug: targetSlug },
    create: { slug: targetSlug, name: targetSlug, concurrentLimit: 999999, bypassLimits: true },
    update: {},
  });
}

async function backfillMaps(target: TenantRef) {
  const maps = await prisma.map.findMany();
  for (const m of maps) {
    if (!(m as any).tenantId) {
      await prisma.map.update({ where: { id: m.id }, data: { tenantId: target.id } as any });
    }
  }
}

async function backfillRooms(target: TenantRef) {
  const rooms = await prisma.room.findMany();
  for (const r of rooms) {
    if (!(r as any).tenantId) {
      const map = await prisma.map.findUnique({ where: { id: r.mapId } });
      await prisma.room.update({ where: { id: r.id }, data: { tenantId: (map as any)?.tenantId || target.id } as any });
    }
  }
}

async function backfillZones(target: TenantRef) {
  const zones = await prisma.zone.findMany();
  for (const z of zones) {
    if (!(z as any).tenantId) {
      const map = await prisma.map.findUnique({ where: { id: z.mapId } });
      await prisma.zone.update({ where: { id: z.id }, data: { tenantId: (map as any)?.tenantId || target.id } as any });
    }
  }
}

async function backfillPresences(target: TenantRef) {
  const presences = await prisma.presence.findMany();
  for (const p of presences) {
    if (!(p as any).tenantId) {
      const room = await prisma.room.findUnique({ where: { id: p.roomId } });
      await prisma.presence.update({ where: { id: p.id }, data: { tenantId: (room as any)?.tenantId || target.id } as any });
    }
  }
}

async function backfillInvites(target: TenantRef) {
  const invites = await prisma.invite.findMany();
  for (const inv of invites) {
    if (!(inv as any).tenantId) {
      await prisma.invite.update({ where: { id: inv.id }, data: { tenantId: target.id } as any });
    }
  }
}

async function ensureUserMemberships(target: TenantRef) {
  const users = await prisma.user.findMany();
  for (const u of users) {
    try {
      await prisma.membership.upsert({
        where: { tenantId_userId: { tenantId: target.id, userId: u.id } } as any,
        update: {},
        create: { tenantId: target.id, userId: u.id, role: 'member' as any },
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

  // eslint-disable-next-line no-console
  console.log('Tenant migration complete');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});

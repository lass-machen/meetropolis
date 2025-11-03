import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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
  const lm = await prisma.tenant.upsert({
    where: { slug: 'lassmachen' },
    create: { slug: 'lassmachen', name: 'lassmachen', concurrentLimit: 999999, bypassLimits: true },
    update: {},
  });

  const targetSlug = (process.env.MIGRATE_EXISTING_TO_SLUG || 'lassmachen').toLowerCase();
  const target = targetSlug === 'internal' ? internal : (targetSlug === 'default' ? def : (targetSlug === 'lassmachen' ? lm : await prisma.tenant.upsert({ where: { slug: targetSlug }, create: { slug: targetSlug, name: targetSlug, concurrentLimit: 50 }, update: {} })));

  // Backfill maps
  const maps = await prisma.map.findMany();
  for (const m of maps) {
    if (!(m as any).tenantId) {
      await prisma.map.update({ where: { id: m.id }, data: { tenantId: target.id } as any });
    }
  }

  // Backfill rooms with their map tenant
  const rooms = await prisma.room.findMany();
  for (const r of rooms) {
    if (!(r as any).tenantId) {
      const map = await prisma.map.findUnique({ where: { id: r.mapId } });
      await prisma.room.update({ where: { id: r.id }, data: { tenantId: (map as any)?.tenantId || target.id } as any });
    }
  }

  // Backfill zones with their map tenant
  const zones = await prisma.zone.findMany();
  for (const z of zones) {
    if (!(z as any).tenantId) {
      const map = await prisma.map.findUnique({ where: { id: z.mapId } });
      await prisma.zone.update({ where: { id: z.id }, data: { tenantId: (map as any)?.tenantId || target.id } as any });
    }
  }

  // Backfill presences with their room tenant
  const presences = await prisma.presence.findMany();
  for (const p of presences) {
    if (!(p as any).tenantId) {
      const room = await prisma.room.findUnique({ where: { id: p.roomId } });
      await prisma.presence.update({ where: { id: p.id }, data: { tenantId: (room as any)?.tenantId || target.id } as any });
    }
  }

  // Backfill invites to default
  const invites = await prisma.invite.findMany();
  for (const inv of invites) {
    if (!(inv as any).tenantId) {
      await prisma.invite.update({ where: { id: inv.id }, data: { tenantId: target.id } as any });
    }
  }

  // Ensure all users are members of default
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



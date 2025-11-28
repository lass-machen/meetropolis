import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Ensure tenants exist
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

  // Basic map and room
  let map = await prisma.map.findFirst({ where: { name: 'office', tenantId: def.id } });
  if (!map) {
    map = await prisma.map.create({ data: { name: 'office', meta: {}, tenantId: def.id } });
  }

  let room = await prisma.room.findUnique({ where: { id: map.id + ':lobby' } });
  if (!room) {
    room = await prisma.room.create({ data: { id: map.id + ':lobby', name: 'lobby', mapId: map.id, tenantId: def.id } });
  }

  // Zones (simple rectangles)
  const zones = [
    { name: 'meeting-a', polygon: { points: [ { x: 120, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 180 }, { x: 120, y: 180 } ] } },
    { name: 'meeting-b', polygon: { points: [ { x: 240, y: 80 }, { x: 300, y: 80 }, { x: 300, y: 140 }, { x: 240, y: 140 } ] } },
  ];

  for (const z of zones) {
    const existing = await prisma.zone.findFirst({ where: { name: z.name, roomId: room.id, mapId: map.id } });
    if (existing) {
      await prisma.zone.update({ where: { id: existing.id }, data: { polygon: z.polygon as any } });
    } else {
      await prisma.zone.create({ data: { name: z.name, polygon: z.polygon as any, roomId: room.id, mapId: map.id, tenantId: def.id } });
    }
  }

  // Seed Root Admin (env-configurable)
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@meetropolis.local';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.SEED_ADMIN_NAME || 'Root Admin';

  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const hash = await bcrypt.hash(adminPass, 10);
  if (!admin) {
    admin = await prisma.user.create({ data: { email: adminEmail, name: adminName, passwordHash: hash, emailVerifiedAt: new Date() } });
    // eslint-disable-next-line no-console
    console.log('Seeded admin user:', adminEmail);
  } else {
    // Update password hash (damit Seed immer das erwartete Passwort setzt)
    admin = await prisma.user.update({ where: { email: adminEmail }, data: { passwordHash: hash } });
    // eslint-disable-next-line no-console
    console.log('Admin user exists, password updated:', adminEmail);
  }

  // Ensure memberships
  if (admin) {
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: internal.id, userId: admin.id } } as any,
      update: { role: 'owner' as any },
      create: { tenantId: internal.id, userId: admin.id, role: 'owner' as any },
    });
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: def.id, userId: admin.id } } as any,
      update: { role: 'owner' as any },
      create: { tenantId: def.id, userId: admin.id, role: 'owner' as any },
    });
  }

  // Create a default invite (for onboarding teammates)
  const existingInvite = await prisma.invite.findFirst({ where: { email: adminEmail, tenantId: def.id } });
  if (!existingInvite) {
    const code = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    await prisma.invite.create({ data: { code, email: adminEmail, createdBy: admin!.id, tenantId: def.id, role: 'admin' as any } });
    // eslint-disable-next-line no-console
    console.log('Seeded invite for admin email (can be shared to teammates):', code);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});

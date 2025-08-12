import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Basic map and room
  const map = await prisma.map.upsert({
    where: { name: 'office' },
    create: { name: 'office', meta: {} },
    update: {},
  });

  const room = await prisma.room.upsert({
    where: { id: map.id + ':lobby' },
    create: { id: map.id + ':lobby', name: 'lobby', mapId: map.id },
    update: {},
  });

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
      await prisma.zone.create({ data: { name: z.name, polygon: z.polygon as any, roomId: room.id, mapId: map.id } });
    }
  }

  // Seed Root Admin (env-configurable)
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@meetropolis.local';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.SEED_ADMIN_NAME || 'Root Admin';

  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const hash = await bcrypt.hash(adminPass, 10);
    admin = await prisma.user.create({ data: { email: adminEmail, name: adminName, passwordHash: hash, emailVerifiedAt: new Date() } });
    // eslint-disable-next-line no-console
    console.log('Seeded admin user:', adminEmail);
  } else {
    // eslint-disable-next-line no-console
    console.log('Admin user exists:', adminEmail);
  }

  // Create a default invite (for onboarding teammates)
  const existingInvite = await prisma.invite.findFirst({ where: { email: adminEmail } });
  if (!existingInvite) {
    const code = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    await prisma.invite.create({ data: { code, email: adminEmail, createdBy: admin.id } });
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

import { PrismaClient } from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

// Prisma 7 requires a driver-adapter. The seed runs via `prisma db seed`
// (outside the application's normal entrypoint) so we construct one here.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Ensure tenants exist
  const internal = await prisma.tenant.upsert({
    where: { slug: 'internal' },
    create: {
      slug: 'internal',
      name: 'Internal',
      concurrentLimit: 999999,
      bypassLimits: true,
      isInternal: true,
      publicRegistrationEnabled: true,
    },
    update: {},
  });
  const def = await prisma.tenant.upsert({
    where: { slug: 'default' },
    create: { slug: 'default', name: 'Default', concurrentLimit: 50 },
    update: {},
  });

  // Seed Root Admin (env-configurable)
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@meetropolis.local';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.SEED_ADMIN_NAME || 'Root Admin';

  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const hash = await bcrypt.hash(adminPass, 10);
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: adminEmail, name: adminName, passwordHash: hash, emailVerifiedAt: new Date() },
    });

    console.log('Seeded admin user:', adminEmail);
  } else {
    // Update password hash (so seed always sets the expected password)
    admin = await prisma.user.update({ where: { email: adminEmail }, data: { passwordHash: hash } });

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

  // Seed default Map for the `default` tenant. Without this the frontend's
  // initial /maps/<id>/{editor-state,tilesets,objects,state-v2} calls all 404
  // because the tenant has `defaultMapName='office'` but no Map row exists.
  // Idempotent via @@unique([tenantId, name]).
  const defaultMapName = def.defaultMapName || 'office';
  const existingMap = await prisma.map.findUnique({
    where: { tenantId_name: { tenantId: def.id, name: defaultMapName } },
  });
  let defaultMap = existingMap;
  if (!defaultMap) {
    defaultMap = await prisma.map.create({
      data: {
        tenantId: def.id,
        name: defaultMapName,
        meta: {},
        width: 32,
        height: 32,
        tileWidth: 16,
        tileHeight: 16,
        chunkSize: 32,
      },
    });

    console.log('Seeded default map:', defaultMapName, 'for tenant', def.slug);
  }

  // Ensure a lobby room exists for the default map (matches adminMaps create flow).
  const existingLobby = await prisma.room.findFirst({ where: { mapId: defaultMap.id, name: 'lobby' } });
  if (!existingLobby) {
    await prisma.room.create({
      data: { name: 'lobby', mapId: defaultMap.id, tenantId: def.id },
    });

    console.log('Seeded lobby room for map:', defaultMapName);
  }

  // Seed default avatar pack
  await prisma.avatarPack.upsert({
    where: { uuid: 'default-characters' },
    create: {
      uuid: 'default-characters',
      name: 'Default Characters',
      description: 'Built-in character set',
      author: 'Meetropolis',
      version: '1.0.0',
      type: 'full',
      avatars: [
        {
          id: 'businessman1',
          key: 'businessman1',
          displayName: 'Businessman',
          type: 'full',
          spriteUrl: '/assets/sprites/default-avatars.png',
          frameWidth: 16,
          frameHeight: 24,
          states: {
            idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
            walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
          },
        },
      ],
    },
    update: { version: '1.0.0' },
  });

  // Create a default invite (for onboarding teammates)
  const existingInvite = await prisma.invite.findFirst({ where: { email: adminEmail, tenantId: def.id } });
  if (!existingInvite) {
    const code = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    await prisma.invite.create({
      data: { code, email: adminEmail, createdBy: admin.id, tenantId: def.id, role: 'admin' as any },
    });

    console.log('Seeded invite for admin email (can be shared to teammates):', code);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

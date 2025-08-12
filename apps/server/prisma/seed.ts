import { PrismaClient } from '@prisma/client';

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
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});

import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * True while the NPC media folder (`NPC_MEDIA_DIR/<slug>`) of a deleted tenant
 * has not been cleared yet. Reusing the slug before that would place the old
 * files into the folder of the new tenant. A task in status `done` no longer
 * reserves the slug.
 */
export async function isTenantSlugReserved(prisma: PrismaClient, slug: string): Promise<boolean> {
  const pending = await prisma.deletionTask.findFirst({
    where: { targetSystem: 'npc_media', storageKey: slug, status: { not: 'done' } },
    select: { id: true },
  });
  return pending !== null;
}

import { createPrismaClient } from '../../db.js';
import { logger } from '../../logger.js';
import { isAllowedAvatarId, isCustomAvatarId } from '../../services/avatarAccess.js';
import { resolveTenantPackScope } from '../../services/packScope.js';
import type { RoomOptions, WorldRoom } from '../WorldRoom.js';
import type { RoomMetadata } from './onJoin.limiter.js';

const DEFAULT_AVATAR_ID = 'default-characters:business_man';

interface UserAppearance {
  name: string;
  avatarId?: string;
  lookupFailed: boolean;
}

/** Resolve a tenant only for joins which have no verified auth tenant. */
export async function resolveFallbackTenantId(
  prisma: ReturnType<typeof createPrismaClient>,
  options: RoomOptions,
  room: WorldRoom,
): Promise<string | undefined> {
  const slug =
    options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return tenant?.id ?? undefined;
}

async function resolveUserAppearance(
  room: WorldRoom,
  options: RoomOptions,
  joiningIdentity: string,
): Promise<UserAppearance> {
  const requestedName = options?.name;
  if (joiningIdentity.startsWith('npc-')) {
    return { name: requestedName || joiningIdentity, lookupFailed: false };
  }

  try {
    const prisma = room.prismaForPresence ?? createPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: joiningIdentity },
      select: { name: true, email: true, avatarId: true },
    });
    const needsNameLookup = !requestedName || requestedName === joiningIdentity;
    return {
      name: needsNameLookup ? user?.name || user?.email || joiningIdentity : requestedName,
      avatarId: user?.avatarId ?? undefined,
      lookupFailed: false,
    };
  } catch (error) {
    logger.debug('[WorldRoom] Failed to look up user name/avatar from DB', error);
    return { name: requestedName || joiningIdentity, lookupFailed: true };
  }
}

async function findAllowedAvatar(
  room: WorldRoom,
  options: RoomOptions,
  authTenantId: string | undefined,
  databaseAvatarId: string | undefined,
  databaseLookupFailed: boolean,
  isNpc: boolean,
  initialMapId: string,
): Promise<string> {
  const prisma = room.prismaForPresence ?? createPrismaClient();
  const npcMap =
    !authTenantId && isNpc
      ? await prisma.map.findUnique({ where: { id: initialMapId }, select: { tenantId: true } })
      : null;
  // Token-less human joins are public, never tenant-bound by client options.
  // NPCs are secret-gated and use the tenant of their server-selected map.
  const tenantId = authTenantId ?? npcMap?.tenantId;
  if (isNpc && !tenantId) throw new Error('Unable to resolve the NPC map tenant for avatar validation');
  const scope = await resolveTenantPackScope(prisma, tenantId, 'avatar');
  const requestedAvatarId = options?.avatarId;

  // A database outage must not turn authenticated state into client authority.
  const candidates =
    databaseLookupFailed && authTenantId
      ? [DEFAULT_AVATAR_ID]
      : [requestedAvatarId, databaseAvatarId, DEFAULT_AVATAR_ID];

  for (const avatarId of candidates) {
    if (!avatarId || (isNpc && isCustomAvatarId(avatarId))) continue;
    try {
      if (await isAllowedAvatarId(prisma, avatarId, scope)) return avatarId;
    } catch (error) {
      logger.debug('[WorldRoom] Failed to validate join avatar candidate', error);
    }
  }

  throw new Error('No allowed avatar is available for this world join');
}

/** Resolve the display name and a scope-validated avatar for a pending join. */
export async function resolveJoinAppearance(
  room: WorldRoom,
  options: RoomOptions,
  joiningIdentity: string,
  authTenantId: string | undefined,
  initialMapId: string,
): Promise<{ name: string; avatarId: string }> {
  const appearance = await resolveUserAppearance(room, options, joiningIdentity);
  const avatarId = await findAllowedAvatar(
    room,
    options,
    authTenantId,
    appearance.avatarId,
    appearance.lookupFailed,
    joiningIdentity.startsWith('npc-'),
    initialMapId,
  );
  return { name: appearance.name, avatarId };
}

import type { Client } from 'colyseus';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { isWorldAuth } from '../lifecycle/onAuth.js';
import { isAllowedAvatarId, isCustomAvatarId } from '../../services/avatarAccess.js';
import { resolveTenantPackScope } from '../../services/packScope.js';
import { logger } from '../../logger.js';

interface PlayerLike {
  avatarId: string;
  mapId: string;
}

const changeVersions = new WeakMap<Client, number>();

async function resolveAvatarTenantId(
  room: WorldRoom,
  player: PlayerLike,
  authTenantId: string | undefined,
  isNpc: boolean,
): Promise<string | undefined> {
  if (!isNpc) return authTenantId;
  const map = await room.prismaForPresence?.map.findUnique({
    where: { id: player.mapId },
    select: { tenantId: true },
  });
  if (!map?.tenantId) throw new Error('Unable to resolve the NPC map tenant for avatar validation');
  return map.tenantId;
}

function applyAvatarChange(room: WorldRoom, client: Client, player: PlayerLike, avatarId: string): void {
  if (player.avatarId !== avatarId) {
    player.avatarId = avatarId;
    broadcastToMap(room, player.mapId, 'player_avatar', { id: client.sessionId, avatarId }, client);
  }
  client.send('avatar_change_accepted', { avatarId });
}

/**
 * Apply and broadcast a client's avatar change — but only after validating that
 * the avatarId resolves to something real AND reachable for this player: a
 * default, an avatar from a pack the player's tenant scope covers, or a custom
 * avatar of that same proven tenant. Without this, a client could broadcast an
 * arbitrary free-form id (which breaks rendering for peers) or an id that
 * resolves to nothing. Custom avatars are tenant-scoped like everything else
 * here — `isAllowedAvatarId` applies the scope to them too, so a broadcast can
 * never name a foreign tenant's avatar (peers there could not resolve its
 * manifest anyway). NPC pack ids pass through the same validation, while their
 * categorically unsupported custom ids are rejected before a lookup. The NPC
 * tenant is always resolved from the server-assigned map; client input and any
 * incidental auth field can never select it.
 *
 * The scope comes from `auth.tenantId`, the JWT-VERIFIED tenant of the world
 * join (onAuth.ts) — never from `options.tenant`, which the client supplies and
 * could point at the owner of a private pack. Every login path stamps `tid`
 * (sessionAuth.ts `establishSession`), so a real member keeps their tenant's
 * pack avatars. A non-NPC join without a verified tenant receives only the
 * public scope. Missing Prisma state rejects the change entirely.
 */
export function handleAvatarChange(room: WorldRoom, client: Client, data: { avatarId: string }): void {
  const player = room.state.players.get(client.sessionId);
  if (!player) return;
  const avatarId = data.avatarId;
  if (typeof avatarId !== 'string' || avatarId.length === 0) return;

  const auth = isWorldAuth(client.auth) ? client.auth : null;
  if (!auth) return; // no verified identity -> ignore
  if (auth.isNpc && isCustomAvatarId(avatarId)) return;

  const prisma = room.prismaForPresence;
  if (!prisma) return;

  const version = (changeVersions.get(client) ?? 0) + 1;
  changeVersions.set(client, version);
  void resolveAvatarTenantId(room, player, auth.tenantId, auth.isNpc)
    .then((tenantId) => resolveTenantPackScope(prisma, tenantId, 'avatar'))
    .then((scope) => isAllowedAvatarId(prisma, avatarId, scope))
    .then((ok) => {
      if (ok && changeVersions.get(client) === version) applyAvatarChange(room, client, player, avatarId);
    })
    .catch((e: unknown) => {
      logger.debug('[WorldRoom] Failed to resolve avatar change scope', e);
    });
}

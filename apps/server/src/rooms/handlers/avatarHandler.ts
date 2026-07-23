import type { Client } from 'colyseus';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { isWorldAuth } from '../lifecycle/onAuth.js';
import { isAllowedAvatarId, isCustomAvatarId } from '../../services/avatarAccess.js';
import { tenantScope } from '../../services/packScope.js';

interface PlayerLike {
  avatarId: string;
  mapId: string;
}

function applyAvatarChange(room: WorldRoom, client: Client, player: PlayerLike, avatarId: string): void {
  player.avatarId = avatarId;
  broadcastToMap(room, player.mapId, 'player_avatar', { id: client.sessionId, avatarId }, client);
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
 * manifest anyway). NPCs are server-controlled and trusted for the pack/default
 * ids they use, but never for custom ids (they never legitimately wear one, and
 * NPC players are broadcast across the tenant boundary — see
 * lifecycle/tenantView.ts; the same rule now guards api/routes/npcs.ts and
 * lifecycle/onJoin.completion.ts).
 *
 * The scope comes from `auth.tenantId`, the JWT-VERIFIED tenant of the world
 * join (onAuth.ts) — never from `options.tenant`, which the client supplies and
 * could point at the owner of a private pack. Every login path stamps `tid`
 * (sessionAuth.ts `establishSession`), so a real member keeps their tenant's
 * pack avatars; a join without a verified tenant falls back to catalog packs,
 * fail-closed.
 */
export function handleAvatarChange(room: WorldRoom, client: Client, data: { avatarId: string }): void {
  const player = room.state.players.get(client.sessionId);
  if (!player) return;
  const avatarId = data.avatarId;
  if (typeof avatarId !== 'string' || avatarId.length === 0) return;

  const auth = isWorldAuth(client.auth) ? client.auth : null;
  if (!auth) return; // no verified identity -> ignore

  const isCustom = isCustomAvatarId(avatarId);
  const prisma = room.prismaForPresence;

  // NPCs are trusted for non-custom ids; they never wear a custom avatar.
  if (auth.isNpc) {
    if (!isCustom) applyAvatarChange(room, client, player, avatarId);
    return;
  }

  // Without a prisma handle we cannot validate: allow low-risk pack/default ids
  // (a bogus one only breaks the caller's own appearance for others), but never
  // an unvalidated custom id.
  if (!prisma) {
    if (!isCustom) applyAvatarChange(room, client, player, avatarId);
    return;
  }

  void isAllowedAvatarId(prisma, avatarId, tenantScope(auth.tenantId)).then((ok) => {
    if (ok && player.avatarId !== avatarId) applyAvatarChange(room, client, player, avatarId);
  });
}

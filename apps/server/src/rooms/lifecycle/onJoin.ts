import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import { PrismaClient } from '../../generated/prisma/index.js';
import { getTenancyModule, OSS_USER_LIMIT } from '../../tenancyLoader.js';
import { getBillingModuleSync } from '../../billingLoader.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { sanitizePosition, sanitizePositionForMap, getMapCenter, type MapMeta } from '../utils/mapBoundsHelpers.js';
import { getAllBubbleMembers } from '../utils/bubbleHelpers.js';
import { findExistingSession } from './ghostDetection.js';

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

// Count all active players across all rooms (global OSS limit).
function countTotalActivePlayers(activeRooms: Set<WorldRoom>): number {
  let totalActive = 0;
  try {
    const rooms = Array.from(activeRooms.values());
    for (const r of rooms) {
      try { totalActive += (r.state?.players?.size) || 0; } catch (e) { logger.debug('[WorldRoom] Failed to get player count from room', e); }
    }
  } catch (e) { logger.debug('[WorldRoom] Failed to count total active users', e); }
  return totalActive;
}

// Enforce OSS user limit (25 concurrent users for self-hosted OSS).
// Returns true if the join was aborted (and the client was kicked).
async function enforceOssLimit(activeRooms: Set<WorldRoom>, client: Client): Promise<boolean> {
  try {
    const tenancyModule = await getTenancyModule();
    const hasEnterpriseLicense = tenancyModule.bypassOssLimit?.() ?? false;
    if (hasEnterpriseLicense) return false;

    const totalActive = countTotalActivePlayers(activeRooms);
    if (totalActive >= OSS_USER_LIMIT) {
      try { logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT }); } catch (e) { logger.debug('[WorldRoom] Failed to log OSS limit warning', e); }
      try { client.error(4002, 'oss_limit_reached'); } catch (e) { logger.debug('[WorldRoom] Failed to send error to client', e); }
      client.leave(1000);
      return true;
    }
  } catch (e) { logger.debug('[WorldRoom] Failed to check OSS user limit in onJoin', e); }
  return false;
}

// Check trial + dunning state via the enterprise billing module.
// Returns true if the join was aborted (and the client was kicked).
async function checkBillingStatus(
  client: Client,
  prisma: PrismaClient,
  tenant: { id: string; bypassLimits: boolean } | null,
  tenantSlug: string,
): Promise<boolean> {
  const billingMod = getBillingModuleSync();
  if (!billingMod || !tenant || tenant.bypassLimits) return false;
  try {
    const trialStatus = await billingMod.getTrialStatus(prisma, tenant.id);
    if (trialStatus.status === 'expired') {
      try { logger.warn('[WorldRoom] Tenant trial expired', { tenant: tenantSlug }); } catch (e) { logger.debug('[WorldRoom] Failed to log trial expiry', e); }
      try { client.error(4005, 'trial_expired'); } catch (e) { logger.debug('[WorldRoom] Failed to send trial_expired error', e); }
      try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
      client.leave(1000);
      return true;
    }
    const dunningStatus = await billingMod.getDunningStatus(prisma, tenant.id);
    if (dunningStatus.status === 'suspended') {
      try { logger.warn('[WorldRoom] Tenant subscription suspended', { tenant: tenantSlug }); } catch (e) { logger.debug('[WorldRoom] Failed to log subscription suspension', e); }
      try { client.error(4004, 'subscription_suspended'); } catch (e) { logger.debug('[WorldRoom] Failed to send subscription_suspended error', e); }
      try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
      client.leave(1000);
      return true;
    }
  } catch (e) {
    logger.debug('[WorldRoom] Billing status check failed (non-blocking)', e);
  }
  return false;
}

// Count active players for a specific tenant slug.
function countActiveForTenant(activeRooms: Set<WorldRoom>, tenantSlug: string): number {
  let active = 0;
  try {
    const rooms = Array.from(activeRooms.values());
    for (const r of rooms) {
      const meta = (r.metadata as RoomMetadata) || {};
      if (meta && meta.tenant === tenantSlug) {
        try { active += (r.state?.players?.size) || 0; } catch (e) { logger.debug('[WorldRoom] Failed to get active count from room', e); }
      }
    }
  } catch (e) { logger.debug('[WorldRoom] Failed to count active users for tenant', e); }
  return active;
}

// Enforce per-tenant seat limit. Returns true if the join was aborted
// (and the client was kicked).
async function enforceTenantSeatLimit(
  client: Client,
  prisma: PrismaClient,
  activeRooms: Set<WorldRoom>,
  tenant: { concurrentLimit: number | null; freeSeats: number | null },
  tenantSlug: string,
): Promise<boolean> {
  const active = countActiveForTenant(activeRooms, tenantSlug);
  const tenancy = await getTenancyModule();
  const bypassOssLimit = tenancy.bypassOssLimit?.() ?? false;

  if (!bypassOssLimit) {
    const totalActive = countTotalActivePlayers(activeRooms);
    if (totalActive >= OSS_USER_LIMIT) {
      try { logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT }); } catch (e) { logger.debug('[WorldRoom] Failed to log OSS limit', e); }
      try { client.error(4002, 'oss_limit_reached'); } catch (e) { logger.debug('[WorldRoom] Failed to send oss_limit_reached error', e); }
      try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
      client.leave(1000);
      return true;
    }
  }

  const paidSeats = Math.max(0, tenant.concurrentLimit || 0);
  const freeSeats = Math.max(0, tenant.freeSeats || 0);
  const effectiveLimit = Math.max(paidSeats, freeSeats);
  if (active >= effectiveLimit) {
    try { logger.warn('[WorldRoom] Tenant limit reached', { tenant: tenantSlug, active, limit: effectiveLimit, paidSeats, freeSeats }); } catch (e) { logger.debug('[WorldRoom] Failed to log tenant limit', e); }
    try { client.error(4001, 'tenant_limit_reached'); } catch (e) { logger.debug('[WorldRoom] Failed to send tenant_limit_reached error', e); }
    try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
    client.leave(1000);
    return true;
  }
  return false;
}

// Combined per-tenant limits: billing status + seat limit. Returns
// true if the join was aborted.
async function enforceTenantLimits(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  options: RoomOptions | undefined,
  client: Client,
): Promise<boolean> {
  try {
    const tenantSlug: string = options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const prisma = new PrismaClient();
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

    if (await checkBillingStatus(client, prisma, tenant, tenantSlug)) return true;

    if (tenant && !tenant.bypassLimits) {
      if (await enforceTenantSeatLimit(client, prisma, activeRooms, tenant, tenantSlug)) return true;
    }
    try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
  } catch (e) { logger.debug('[WorldRoom] Failed to enforce tenant/user limits', e); }
  return false;
}

// Cancel any pending Graceful-Leave timers for the joining identity
// (short disconnect + reconnect). Quietly drops the old player entries
// so completePendingJoin can build a fresh one without flicker.
function cancelPendingLeavesForIdentity(activeRooms: Set<WorldRoom>, joiningIdentity: string): void {
  try {
    for (const r of activeRooms) {
      const worldRoom = r;
      const sidsToCancel: string[] = [];
      for (const sid of worldRoom.pendingLeaves.keys()) {
        const p = worldRoom.state.players.get(sid);
        if (p && p.identity === joiningIdentity) {
          sidsToCancel.push(sid);
        }
      }
      for (const sid of sidsToCancel) {
        const timer = worldRoom.pendingLeaves.get(sid);
        if (timer) clearTimeout(timer);
        worldRoom.pendingLeaves.delete(sid);
        worldRoom.state.players.delete(sid);
        worldRoom.lastSeen.delete(sid);
        try { colyseusPlayers.dec(); } catch { /* metric best-effort */ }
        logger.info('[WorldRoom] Graceful reconnect: cancelled pending leave for identity', joiningIdentity, 'oldSid:', sid);
      }
    }
  } catch (e) { logger.debug('[WorldRoom] Failed to cancel pending leaves on reconnect', e); }
}

// If a duplicate session exists (and isn't a ghost), enqueue this client
// as pending and notify it. Returns true if pending — caller must skip
// player creation. Returns false if no conflict (caller proceeds).
function tryRegisterAsPending(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  client: Client,
  options: RoomOptions | undefined,
  joiningIdentity: string,
): boolean {
  try {
    const existing = findExistingSession(activeRooms, room.ghostThresholdMs, joiningIdentity);
    if (existing) {
      // If there's already a pending client for this identity (3rd tab case), kick it
      const prevPending = room.pendingClients.get(joiningIdentity);
      if (prevPending) {
        try { prevPending.client.leave(1000); } catch { /* best-effort */ }
        room.pendingClients.delete(joiningIdentity);
      }

      // Store new client as pending — no player creation yet
      room.pendingClients.set(joiningIdentity, {
        client,
        options: options || {},
        identity: joiningIdentity,
        timestamp: Date.now(),
      });

      client.send('session_conflict', { code: 4007, message: 'session_conflict' });
      logger.info('[WorldRoom] Session conflict detected for identity:', joiningIdentity, '- client pending');
      return true;
    }
  } catch (e) { logger.debug('[WorldRoom] Failed to check duplicate session', e); }
  return false;
}

// onJoin: enforce OSS/tenant limits, then either pend or complete the
// join. Returns void; the caller (WorldRoom.onJoin) just awaits this.
//
// IMPORTANT: behavior must match the original implementation exactly,
// including ordering: OSS check -> tenant/billing check -> graceful
// reconnect cancel -> duplicate detection -> completePendingJoin.
export async function performOnJoin(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  client: Client,
  options: RoomOptions | undefined,
  PlayerClass: typeof PlayerCtor,
): Promise<void> {
  if (await enforceOssLimit(activeRooms, client)) return;
  if (await enforceTenantLimits(room, activeRooms, options, client)) return;

  const joiningIdentity = options?.identity || client.sessionId;
  if (!joiningIdentity.startsWith('npc-')) {
    cancelPendingLeavesForIdentity(activeRooms, joiningIdentity);
    if (tryRegisterAsPending(room, activeRooms, client, options, joiningIdentity)) {
      return; // No player creation, no full_state, no broadcasts
    }
  }

  await completePendingJoin(room, client, options || {}, joiningIdentity, PlayerClass);
}

// Resolve the initial map (mapId + mapName) for a joining player.
// Looks up by name first, then falls back to tenant default, then to
// the first available map for this tenant. Final guard for empty
// mapName lives in the caller.
async function resolveInitialMap(
  room: WorldRoom,
  options: RoomOptions,
): Promise<{ mapId: string; mapName: string }> {
  let initialMapId = options?.mapId || '';
  let initialMapName = options?.mapName || '';
  if (initialMapId) return { mapId: initialMapId, mapName: initialMapName };

  try {
    const tenantSlug = options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const prismaForMap = room.prismaForPresence ?? new PrismaClient();
    if (initialMapName) {
      const mapByName = await prismaForMap.map.findFirst({
        where: { name: initialMapName, tenant: { slug: tenantSlug } },
        select: { id: true, name: true },
      });
      if (mapByName) {
        initialMapId = mapByName.id;
        initialMapName = mapByName.name;
      }
    }
    if (!initialMapId) {
      const tenantForMap = await prismaForMap.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { defaultMapName: true },
      });
      const defaultMapName = tenantForMap?.defaultMapName || 'office';
      const defaultMap = await prismaForMap.map.findFirst({
        where: { name: defaultMapName, tenant: { slug: tenantSlug } },
        select: { id: true, name: true },
      });
      if (defaultMap) {
        initialMapId = defaultMap.id;
        initialMapName = defaultMap.name;
      } else {
        const firstMap = await prismaForMap.map.findFirst({
          where: { tenant: { slug: tenantSlug } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        });
        if (firstMap) {
          initialMapId = firstMap.id;
          initialMapName = firstMap.name;
        } else {
          initialMapName = defaultMapName;
        }
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to determine initial map', e);
    if (!initialMapName) initialMapName = 'office';
  }
  return { mapId: initialMapId, mapName: initialMapName };
}

// Ensure room map metadata is loaded (race against onCreate-loader).
async function ensureRoomMapMetadata(room: WorldRoom, options: RoomOptions): Promise<void> {
  try {
    if (!room.mapWidthTiles || !room.mapHeightTiles || !room.tileWidthPx || !room.tileHeightPx || !room.defaultSpawn) {
      const prisma = new PrismaClient();
      const tenantSlug = options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
      const tenantRec = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { defaultMapName: true } });
      const mapName = tenantRec?.defaultMapName || process.env.DEFAULT_MAP_NAME || 'office';
      let map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
      if (!map) {
        map = await prisma.map.findFirst({
          where: { tenant: { slug: tenantSlug } },
          orderBy: { createdAt: 'asc' },
        });
      }
      try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
      if (map) {
        try {
          room.mapWidthTiles = map.width ?? room.mapWidthTiles;
          room.mapHeightTiles = map.height ?? room.mapHeightTiles;
          room.tileWidthPx = map.tileWidth ?? room.tileWidthPx;
          room.tileHeightPx = map.tileHeight ?? room.tileHeightPx;
        } catch (e) { logger.debug('[WorldRoom] Failed to update map metadata', e); }
        const meta = (map.meta as MapMeta) || {};
        const sp = meta?.spawn;
        if (!room.defaultSpawn && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
          room.defaultSpawn = sanitizePosition(room, sp.x, sp.y);
        }
      }
    }
  } catch (e) { logger.debug('[WorldRoom] Failed to ensure map metadata on join', e); }
}

// Resolve display name + avatarId from DB if needed.
async function resolveNameAndAvatar(
  room: WorldRoom,
  options: RoomOptions,
  joiningIdentity: string,
): Promise<{ name: string; avatarId: string | undefined }> {
  let resolvedName: string | undefined = options?.name;
  let resolvedAvatarId: string | undefined = undefined;
  const isNpcIdentity = (joiningIdentity || '').startsWith('npc-');
  const needsNameLookup = !resolvedName || resolvedName === joiningIdentity;
  if (!isNpcIdentity && (needsNameLookup || !options?.avatarId)) {
    try {
      const prisma = room.prismaForPresence ?? new PrismaClient();
      const user = await prisma.user.findUnique({
        where: { id: joiningIdentity },
        select: { name: true, email: true, avatarId: true },
      });
      if (needsNameLookup) {
        resolvedName = user?.name || user?.email || joiningIdentity;
      }
      resolvedAvatarId = user?.avatarId ?? undefined;
    } catch (e) {
      logger.debug('[WorldRoom] Failed to look up user name/avatar from DB', e);
      if (needsNameLookup) {
        resolvedName = joiningIdentity;
      }
    }
  }
  return { name: resolvedName || joiningIdentity, avatarId: resolvedAvatarId };
}

// Send seed presence_recent to the new client. Best-effort, tenant-scoped.
async function seedPresenceRecent(room: WorldRoom, client: Client, options: RoomOptions): Promise<void> {
  try {
    const prisma = room.prismaForPresence ?? new PrismaClient();
    const tenantSlug: string = options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return;

    const memberships = await prisma.membership.findMany({
      where: { tenantId: tenant.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    const recent = await prisma.presence.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
      distinct: ['userId'],
      include: { room: { select: { name: true } } },
    });

    type PresenceWithRoom = typeof recent[0];
    const presenceMap = new Map<string, PresenceWithRoom>();
    for (const p of recent) {
      presenceMap.set(p.userId, p);
    }

    const out = memberships.map((m) => {
      const presence = presenceMap.get(m.userId);
      return {
        userId: m.userId,
        user: { id: m.user?.id, email: m.user?.email, name: m.user?.name },
        room: presence?.room?.name || null,
        x: presence?.x ?? null,
        y: presence?.y ?? null,
        direction: presence?.direction || null,
        updatedAt: presence?.updatedAt || null,
      };
    });

    try { client.send('presence_recent', out); } catch (e) { logger.debug('[WorldRoom] Failed to send presence_recent', e); }
  } catch (e) {
    try { logger.debug('[WorldRoom] presence_recent seed failed', e); } catch (e2) { logger.debug('[WorldRoom] Failed to log presence_recent error', e2); }
  }
}

// Check whether the joining user is an expired guest. Returns true if
// the join must be aborted (and the client has been kicked).
async function checkGuestExpired(
  room: WorldRoom,
  client: Client,
  options: RoomOptions,
  joiningIdentity: string,
): Promise<boolean> {
  try {
    const tenantSlug = options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const prismaCheck = room.prismaForPresence ?? new PrismaClient();
    const tenantForGuest = await prismaCheck.tenant.findUnique({ where: { slug: tenantSlug } });
    if (tenantForGuest) {
      const guestMembership = await prismaCheck.membership.findFirst({
        where: {
          userId: joiningIdentity,
          tenantId: tenantForGuest.id,
          role: 'guest',
          expiresAt: { lt: new Date() },
        },
      });
      if (guestMembership) {
        try { client.error(4006, 'guest_expired'); } catch { /* best-effort */ }
        client.leave(1000);
        return true;
      }
    }
  } catch (e) { logger.debug('[WorldRoom] Failed to check guest expiry on join', e); }
  return false;
}

// Pick the initial pixel-space position for a joining player.
function pickInitialPosition(
  room: WorldRoom,
  options: RoomOptions,
  initialMapId: string,
): { x: number; y: number } {
  if (options && typeof options.x === 'number' && typeof options.y === 'number') {
    return sanitizePositionForMap(room, options.x, options.y, initialMapId);
  }
  if (room.defaultSpawn) {
    return sanitizePositionForMap(room, room.defaultSpawn.x, room.defaultSpawn.y, initialMapId);
  }
  return getMapCenter(room) ?? { x: 200, y: 200 };
}

// Send full_state + bubble_state + zone_lock_state to the joining client
// after a small delay so the client can register its handlers first.
function scheduleFullStateSend(room: WorldRoom, client: Client): void {
  setTimeout(() => {
    try {
      client.send('full_state', {
        players: Array.from(room.state.players.entries()).map(([id, p]) => ({
          id,
          x: p.x,
          y: p.y,
          direction: p.direction,
          identity: p.identity,
          name: p.name,
          dnd: p.dnd,
          avatarId: p.avatarId,
          isNpc: p.isNpc,
          mapId: p.mapId,
          mapName: p.mapName,
        })),
      });
      const groups = Object.entries(room.bubbleGroups).map(([id, members]) => ({
        id,
        members: members.filter((m) => room.state.players.has(m)),
      })).filter(g => Array.isArray(g.members) && g.members.length >= 2);
      const members = getAllBubbleMembers(room);
      client.send('bubble_state', { groups, members });
      const zoneLocks = Array.from(room.zoneLockState.locks.values());
      if (zoneLocks.length > 0) {
        client.send('zone_lock_state', { locks: zoneLocks });
      }
    } catch (e) { logger.debug('[WorldRoom] Failed to send full_state/bubble_state to client', e); }
  }, 25);
}

// completePendingJoin: actually create the player, broadcast, and seed
// presence. Called both from the normal onJoin flow and from the
// session_takeover handler. Behavior MUST remain identical to the
// previous private method, including the order of operations.
export async function completePendingJoin(
  room: WorldRoom,
  client: Client,
  options: RoomOptions,
  joiningIdentity: string,
  PlayerClass: typeof PlayerCtor,
): Promise<void> {
  if (await checkGuestExpired(room, client, options, joiningIdentity)) return;

  await ensureRoomMapMetadata(room, options);

  let { mapId: initialMapId, mapName: initialMapName } = await resolveInitialMap(room, options);

  // Final-Guard: player.mapName darf NIE leer sein, sonst raced der Client
  // den Map-Filter (siehe playerHandlers.ts / mapFilter.ts).
  if (!initialMapName) initialMapName = process.env.DEFAULT_MAP_NAME || 'office';

  const player = new PlayerClass();
  player.id = client.sessionId;
  player.mapId = initialMapId;
  player.mapName = initialMapName;

  const initial = pickInitialPosition(room, options, initialMapId);
  player.x = initial.x;
  player.y = initial.y;
  player.direction = options?.direction || 'down';
  player.identity = joiningIdentity;

  const { name, avatarId } = await resolveNameAndAvatar(room, options, joiningIdentity);
  player.name = name;
  // Priority: explicit options.avatarId (active session update) > DB value (source of truth) > default
  player.avatarId = options?.avatarId || avatarId || 'default-characters:businessman1';
  player.isNpc = (joiningIdentity || '').startsWith('npc-');

  room.state.players.set(client.sessionId, player);
  // Initial lastSeen setzen, damit Ghost-Check erst nach Threshold-Ablauf greift
  room.lastSeen.set(client.sessionId, Date.now());
  try { colyseusPlayers.inc(); } catch (e) { logger.debug('[WorldRoom] Failed to increment colyseusPlayers metric', e); }
  logger.info('[WorldRoom] Player joined:', client.sessionId, 'identity:', player.identity, 'name:', player.name, 'mapId:', player.mapId, 'map:', player.mapName, 'at', player.x, player.y);
  logger.debug('[WorldRoom] Current players:', room.state.players.size);

  room.state.players.forEach((p, id) => {
    logger.debug('[WorldRoom] - Player', id, 'identity:', p.identity, 'at', p.x, p.y);
  });

  scheduleFullStateSend(room, client);

  // Broadcast new player to other clients on the same map
  broadcastToMap(room, player.mapId, 'player_joined', {
    id: client.sessionId,
    x: player.x,
    y: player.y,
    direction: player.direction,
    identity: player.identity,
    name: player.name,
    dnd: player.dnd,
    avatarId: player.avatarId,
    isNpc: player.isNpc,
    mapId: player.mapId,
    mapName: player.mapName,
  }, client);

  await seedPresenceRecent(room, client, options);
}

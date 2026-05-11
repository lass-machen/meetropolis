import { pointInPolygon } from '@meetropolis/shared';
import type { ZoneLockInfo } from '@meetropolis/shared';
import { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import type { WorldRoom, Player } from '../WorldRoom.js';

interface MapMetaShape {
  zones?: ZoneMetaEntry[];
  [key: string]: unknown;
}

interface ZoneMetaEntry {
  name?: string;
  points?: Array<{ x: number; y: number } | [number, number]>;
  polygon?: Array<{ x: number; y: number } | [number, number]>;
}

type PolygonPoint = { x: number; y: number };

function normalizePolygonPoint(p: unknown): PolygonPoint | null {
  if (Array.isArray(p) && p.length >= 2) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  }
  if (p && typeof p === 'object') {
    const obj = p as { x?: unknown; y?: unknown };
    if (typeof obj.x === 'number' && typeof obj.y === 'number') return { x: obj.x, y: obj.y };
  }
  return null;
}

interface ZonePolygon {
  name: string;
  polygon: { x: number; y: number }[];
}

export interface ZoneLockState {
  locks: Map<string, ZoneLockInfo>; // key: mapId:zoneName
  zoneCache: Map<string, ZonePolygon[]>; // zones per mapId
  lastAutoUnlockCheck: number;
}

export function createZoneLockState(): ZoneLockState {
  return {
    locks: new Map(),
    zoneCache: new Map(),
    lastAutoUnlockCheck: 0,
  };
}

// Load zones from DB and cache them
async function loadZones(
  state: ZoneLockState,
  mapId: string,
  tenantSlug: string,
  prisma: PrismaClient,
): Promise<ZonePolygon[]> {
  if (state.zoneCache.has(mapId)) return state.zoneCache.get(mapId)!;
  try {
    const map = await prisma.map.findFirst({
      where: { id: mapId, tenant: { slug: tenantSlug } },
    });
    if (!map) return [];
    // Prisma types `meta` as JsonValue; narrow to an object shape we expect.
    const rawMeta: unknown = map.meta;
    const meta: MapMetaShape =
      rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta) ? (rawMeta as MapMetaShape) : {};
    const zones: ZonePolygon[] = [];
    if (Array.isArray(meta.zones)) {
      for (const z of meta.zones) {
        if (!z.name) continue;
        const points = Array.isArray(z.points) ? z.points : Array.isArray(z.polygon) ? z.polygon : [];
        const polygon = points.map(normalizePolygonPoint).filter((p): p is PolygonPoint => p !== null);
        if (polygon.length >= 3) {
          zones.push({ name: z.name, polygon });
        }
      }
    }
    state.zoneCache.set(mapId, zones);
    return zones;
  } catch (e) {
    logger.debug('[ZoneLock] Failed to load zones', e);
    return [];
  }
}

// Which zone is a player currently in?
function getPlayerZone(zones: ZonePolygon[], pos: { x: number; y: number }): string | null {
  for (const z of zones) {
    if (pointInPolygon(pos, z.polygon)) return z.name;
  }
  return null;
}

function lockKey(mapId: string, zoneName: string): string {
  return `${mapId}:${zoneName}`;
}

// Broadcast the lock state to every client.
function broadcastLockState(room: WorldRoom, state: ZoneLockState): void {
  const locks: ZoneLockInfo[] = Array.from(state.locks.values());
  room.broadcast('zone_lock_state', { locks });
}

// Check auto-unlock: if no player with access is still in the zone.
function checkAutoUnlock(room: WorldRoom, state: ZoneLockState): void {
  const now = Date.now();
  if (now - state.lastAutoUnlockCheck < 500) return;
  state.lastAutoUnlockCheck = now;

  const toDelete: string[] = [];
  for (const [key, lock] of state.locks) {
    const zones = state.zoneCache.get(lock.mapId) || [];
    let hasAccessPlayerInZone = false;
    // Confirm at least one player with access is still in the zone.
    room.state.players.forEach((player: Player, sessionId: string) => {
      if (!lock.accessList.includes(sessionId)) return;
      if (player.mapId !== lock.mapId) return;
      const zone = getPlayerZone(zones, { x: player.x, y: player.y });
      if (zone === lock.zoneName) hasAccessPlayerInZone = true;
    });
    if (!hasAccessPlayerInZone) toDelete.push(key);
  }

  if (toDelete.length > 0) {
    for (const key of toDelete) state.locks.delete(key);
    broadcastLockState(room, state);
  }
}

// Check whether the movement target lies inside a locked zone.
export function isMovementBlocked(
  state: ZoneLockState,
  sessionId: string,
  mapId: string,
  newPos: { x: number; y: number },
): { blocked: boolean; zoneName?: string } {
  const zones = state.zoneCache.get(mapId);
  if (!zones) return { blocked: false };

  const targetZone = getPlayerZone(zones, newPos);
  if (!targetZone) return { blocked: false };

  const key = lockKey(mapId, targetZone);
  const lock = state.locks.get(key);
  if (!lock) return { blocked: false };

  if (lock.accessList.includes(sessionId)) return { blocked: false };

  return { blocked: true, zoneName: targetZone };
}

function getRoomTenantSlug(room: WorldRoom): string {
  // Colyseus typings expose Room.metadata as `any` without a generic override.
  // Narrow defensively here so the rest of the handler stays well-typed.
  const meta = room.metadata as { tenant?: string } | undefined;
  return meta?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
}

async function handleZoneLock(
  room: WorldRoom,
  state: ZoneLockState,
  prisma: PrismaClient,
  client: { sessionId: string },
  data: { zoneName?: string },
): Promise<void> {
  const player = room.state.players.get(client.sessionId);
  if (!player || !data?.zoneName) return;

  const mapId = player.mapId;
  const tenantSlug = getRoomTenantSlug(room);
  const zones = await loadZones(state, mapId, tenantSlug, prisma);
  const playerZone = getPlayerZone(zones, { x: player.x, y: player.y });

  if (playerZone !== data.zoneName) return;

  const key = lockKey(mapId, data.zoneName);
  if (state.locks.has(key)) return;

  const accessList: string[] = [];
  room.state.players.forEach((p: Player, sessionId: string) => {
    if (p.mapId !== mapId) return;
    const zone = getPlayerZone(zones, { x: p.x, y: p.y });
    if (zone === data.zoneName) accessList.push(sessionId);
  });

  state.locks.set(key, {
    zoneName: data.zoneName,
    mapId,
    lockedBy: client.sessionId,
    accessList,
    pendingRequests: [],
  });

  broadcastLockState(room, state);
  logger.info('[ZoneLock] Zone locked:', data.zoneName, 'by', client.sessionId, 'access:', accessList.length);
}

function handleZoneUnlock(
  room: WorldRoom,
  state: ZoneLockState,
  client: { sessionId: string },
  data: { zoneName?: string },
): void {
  if (!data?.zoneName) return;
  const player = room.state.players.get(client.sessionId);
  if (!player) return;

  const key = lockKey(player.mapId, data.zoneName);
  const lock = state.locks.get(key);
  if (!lock) return;

  if (!lock.accessList.includes(client.sessionId)) return;

  state.locks.delete(key);
  broadcastLockState(room, state);
  logger.info('[ZoneLock] Zone unlocked:', data.zoneName, 'by', client.sessionId);
}

function handleZoneAccessRequest(
  room: WorldRoom,
  state: ZoneLockState,
  client: { sessionId: string },
  data: { zoneName?: string; mapId?: string },
): void {
  if (!data?.zoneName || !data?.mapId) return;
  const player = room.state.players.get(client.sessionId);
  if (!player) return;

  const key = lockKey(data.mapId, data.zoneName);
  const lock = state.locks.get(key);
  if (!lock) return;

  if (lock.accessList.includes(client.sessionId)) return;
  if (lock.pendingRequests.some((r: { sessionId: string }) => r.sessionId === client.sessionId)) return;

  lock.pendingRequests.push({
    sessionId: client.sessionId,
    identity: player.identity || client.sessionId,
    name: player.name || player.identity || client.sessionId,
  });

  broadcastLockState(room, state);
  logger.info('[ZoneLock] Access request for', data.zoneName, 'from', client.sessionId);
}

function handleZoneAccessResponse(
  room: WorldRoom,
  state: ZoneLockState,
  client: { sessionId: string },
  data: { zoneName?: string; sessionId?: string; approved?: boolean },
): void {
  if (!data?.zoneName || !data?.sessionId) return;
  const player = room.state.players.get(client.sessionId);
  if (!player) return;

  const key = lockKey(player.mapId, data.zoneName);
  const lock = state.locks.get(key);
  if (!lock) return;

  if (!lock.accessList.includes(client.sessionId)) return;

  lock.pendingRequests = lock.pendingRequests.filter((r: { sessionId: string }) => r.sessionId !== data.sessionId);

  if (data.approved) {
    lock.accessList.push(data.sessionId);
    logger.info('[ZoneLock] Access approved for', data.sessionId, 'to', data.zoneName);
  } else {
    const requesterClient = room.clients.find((c) => c.sessionId === data.sessionId);
    if (requesterClient) {
      requesterClient.send('zone_access_denied', { zoneName: data.zoneName });
    }
    logger.info('[ZoneLock] Access denied for', data.sessionId, 'to', data.zoneName);
  }

  broadcastLockState(room, state);
}

type ZoneLockMsg = { zoneName?: string };
type ZoneAccessRequestMsg = { zoneName?: string; mapId?: string };
type ZoneAccessResponseMsg = { zoneName?: string; sessionId?: string; approved?: boolean };

export function setupZoneLockHandlers(room: WorldRoom, state: ZoneLockState, prisma: PrismaClient): void {
  room.onMessage<ZoneLockMsg>('zone_lock', (client, data) => {
    void handleZoneLock(room, state, prisma, client, data);
  });
  room.onMessage<ZoneLockMsg>('zone_unlock', (client, data) => handleZoneUnlock(room, state, client, data));
  room.onMessage<ZoneAccessRequestMsg>('zone_access_request', (client, data) =>
    handleZoneAccessRequest(room, state, client, data),
  );
  room.onMessage<ZoneAccessResponseMsg>('zone_access_response', (client, data) =>
    handleZoneAccessResponse(room, state, client, data),
  );
}

// Player leaves: remove them from every list.
export function onPlayerLeaveZoneLock(room: WorldRoom, state: ZoneLockState, sessionId: string): void {
  let changed = false;
  for (const [_key, lock] of state.locks) {
    if (lock.accessList.includes(sessionId)) {
      lock.accessList = lock.accessList.filter((id: string) => id !== sessionId);
      changed = true;
    }
    const hadPending = lock.pendingRequests.length;
    lock.pendingRequests = lock.pendingRequests.filter((r: { sessionId: string }) => r.sessionId !== sessionId);
    if (lock.pendingRequests.length !== hadPending) changed = true;
  }
  if (changed) {
    checkAutoUnlock(room, state);
    broadcastLockState(room, state);
  }
}

// Invalidate zone cache (on editor_update)
export function invalidateZoneCache(state: ZoneLockState, mapId?: string): void {
  if (mapId) {
    state.zoneCache.delete(mapId);
  } else {
    state.zoneCache.clear();
  }
}

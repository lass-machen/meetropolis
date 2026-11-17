import { pointInPolygon } from '@meetropolis/shared';
import type { ZoneLockInfo } from '@meetropolis/shared';
import type { Client } from '@colyseus/core';
import { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import type { WorldRoom, Player } from '../WorldRoom.js';
import { sameScope, senderScope, zoneBelongsToScope, zoneLocksForClient, type SocialScope } from './socialScope.js';

// The lock view moved next to the other scope helpers; the export stays here
// for the callers that already import it from this module.
export { zoneLocksForClient };

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

export interface ZonePolygon {
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

// Fetch + parse zone polygons for one map directly from the DB, with no
// caching. Shared by the (cached, lazy) zone-lock loader below and by
// audioZones/zoneCatalog.ts, which maintains its own eager cache. Keeping
// this parsing logic in one place avoids two divergent readers of
// Map.meta.zones.
export async function fetchZonesFromDb(
  mapId: string,
  tenantSlug: string,
  prisma: PrismaClient,
): Promise<ZonePolygon[]> {
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
    return zones;
  } catch (e) {
    logger.debug('[ZoneLock] Failed to load zones', e);
    return [];
  }
}

// Load zones from DB and cache them (lazy: only fetches on first miss).
async function loadZones(
  state: ZoneLockState,
  mapId: string,
  tenantSlug: string,
  prisma: PrismaClient,
): Promise<ZonePolygon[]> {
  if (state.zoneCache.has(mapId)) return state.zoneCache.get(mapId)!;
  const zones = await fetchZonesFromDb(mapId, tenantSlug, prisma);
  state.zoneCache.set(mapId, zones);
  return zones;
}

// Which zone is a player currently in?
export function getPlayerZone(zones: ZonePolygon[], pos: { x: number; y: number }): string | null {
  for (const z of zones) {
    if (pointInPolygon(pos, z.polygon)) return z.name;
  }
  return null;
}

function lockKey(mapId: string, zoneName: string): string {
  return `${mapId}:${zoneName}`;
}

// Broadcast the lock state to every client, scoped per recipient so a
// shared-room foreign tenant never receives another tenant's lock or its
// pending-request identity/name (PII). Reads the locks off room.zoneLockState
// (the single ZoneLockState instance), so no state argument is needed.
function broadcastLockState(room: WorldRoom): void {
  for (const client of room.clients) {
    client.send('zone_lock_state', { locks: zoneLocksForClient(room, client) });
  }
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
    broadcastLockState(room);
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

export function getRoomTenantSlug(room: WorldRoom): string {
  // Colyseus typings expose Room.metadata as `any` without a generic override.
  // Narrow defensively here so the rest of the handler stays well-typed.
  const meta = room.metadata as { tenant?: string } | undefined;
  return meta?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
}

// The seats of the sender's own tenant and map that stand inside the zone.
function accessListFor(room: WorldRoom, scope: SocialScope, zones: ZonePolygon[], zoneName: string): string[] {
  const accessList: string[] = [];
  room.state.players.forEach((player: Player, sessionId: string) => {
    if (player.mapId !== scope.mapId) return;
    if (room.playerTenantKey.get(sessionId) !== scope.tenantKey) return;
    if (getPlayerZone(zones, { x: player.x, y: player.y }) !== zoneName) return;
    accessList.push(sessionId);
  });
  return accessList;
}

// Lock a zone. The zone has to belong to the tenant and the map of the
// sender, and the sender has to stand inside it.
async function handleZoneLock(
  room: WorldRoom,
  state: ZoneLockState,
  prisma: PrismaClient,
  client: Client,
  data: { zoneName?: string },
): Promise<void> {
  const scope = senderScope(room, client);
  const zoneName = data?.zoneName;
  if (!scope || typeof zoneName !== 'string' || zoneName.length === 0) return;

  const key = lockKey(scope.mapId, zoneName);
  if (state.locks.has(key)) return;

  // The zone has to belong to the tenant and the map of the sender. The
  // database decides, never the client.
  if (!(await zoneBelongsToScope(prisma, scope, zoneName))) return;
  if (!sameScope(room, client.sessionId, scope)) return;

  const zones = await loadZones(state, scope.mapId, getRoomTenantSlug(room), prisma);
  if (!sameScope(room, client.sessionId, scope)) return;

  const player = room.state.players.get(client.sessionId);
  if (!player) return;
  if (getPlayerZone(zones, { x: player.x, y: player.y }) !== zoneName) return;

  const accessList = accessListFor(room, scope, zones, zoneName);
  state.locks.set(key, {
    zoneName,
    mapId: scope.mapId,
    lockedBy: client.sessionId,
    accessList,
    pendingRequests: [],
  });

  broadcastLockState(room);
  logger.info('[ZoneLock] Zone locked:', zoneName, 'by', client.sessionId, 'access:', accessList.length);
}

// Unlock a zone. The right stays with the seats on the access list.
async function handleZoneUnlock(
  room: WorldRoom,
  state: ZoneLockState,
  prisma: PrismaClient,
  client: Client,
  data: { zoneName?: string },
): Promise<void> {
  const scope = senderScope(room, client);
  const zoneName = data?.zoneName;
  if (!scope || typeof zoneName !== 'string' || zoneName.length === 0) return;

  const key = lockKey(scope.mapId, zoneName);
  const lock = state.locks.get(key);
  if (!lock) return;
  if (!lock.accessList.includes(client.sessionId)) return;

  if (!(await zoneBelongsToScope(prisma, scope, zoneName))) return;
  if (!sameScope(room, client.sessionId, scope)) return;

  state.locks.delete(key);
  broadcastLockState(room);
  logger.info('[ZoneLock] Zone unlocked:', zoneName, 'by', client.sessionId);
}

// Ask for access to a locked zone of the map the sender stands on. A named
// map is only a checked match, never a target.
async function handleZoneAccessRequest(
  room: WorldRoom,
  state: ZoneLockState,
  prisma: PrismaClient,
  client: Client,
  data: { zoneName?: string; mapId?: string },
): Promise<void> {
  const scope = senderScope(room, client);
  const zoneName = data?.zoneName;
  if (!scope || typeof zoneName !== 'string' || zoneName.length === 0) return;
  if (typeof data?.mapId === 'string' && data.mapId !== scope.mapId) return;

  const key = lockKey(scope.mapId, zoneName);
  const lock = state.locks.get(key);
  if (!lock) return;
  if (lock.accessList.includes(client.sessionId)) return;
  if (lock.pendingRequests.some((request: { sessionId: string }) => request.sessionId === client.sessionId)) return;

  if (!(await zoneBelongsToScope(prisma, scope, zoneName))) return;
  if (!sameScope(room, client.sessionId, scope)) return;

  const player = room.state.players.get(client.sessionId);
  if (!player) return;

  lock.pendingRequests.push({
    sessionId: client.sessionId,
    identity: player.identity || client.sessionId,
    name: player.name || player.identity || client.sessionId,
  });

  broadcastLockState(room);
  logger.info('[ZoneLock] Access request for', zoneName, 'from', client.sessionId);
}

// Answer a pending access request. Only a seat on the access list may decide,
// and only about a request that is actually pending for a live seat of the
// same tenant and map.
async function handleZoneAccessResponse(
  room: WorldRoom,
  state: ZoneLockState,
  prisma: PrismaClient,
  client: Client,
  data: { zoneName?: string; sessionId?: string; approved?: boolean },
): Promise<void> {
  const scope = senderScope(room, client);
  const zoneName = data?.zoneName;
  const targetId = data?.sessionId;
  const approved = data?.approved;
  if (!scope || typeof zoneName !== 'string' || zoneName.length === 0) return;
  if (typeof targetId !== 'string' || targetId.length === 0) return;
  if (typeof approved !== 'boolean') return;

  const key = lockKey(scope.mapId, zoneName);
  const lock = state.locks.get(key);
  if (!lock) return;
  if (!lock.accessList.includes(client.sessionId)) return;
  if (!lock.pendingRequests.some((request: { sessionId: string }) => request.sessionId === targetId)) return;
  if (!sameScope(room, targetId, scope)) return;

  if (!(await zoneBelongsToScope(prisma, scope, zoneName))) return;
  if (!sameScope(room, client.sessionId, scope)) return;

  lock.pendingRequests = lock.pendingRequests.filter(
    (request: { sessionId: string }) => request.sessionId !== targetId,
  );

  if (approved) {
    lock.accessList.push(targetId);
    logger.info('[ZoneLock] Access approved for', targetId, 'to', zoneName);
  } else {
    const requesterClient = room.clients.find((c) => c.sessionId === targetId);
    if (requesterClient) {
      requesterClient.send('zone_access_denied', { zoneName });
    }
    logger.info('[ZoneLock] Access denied for', targetId, 'to', zoneName);
  }

  broadcastLockState(room);
}

type ZoneLockMsg = { zoneName?: string };
type ZoneAccessRequestMsg = { zoneName?: string; mapId?: string };
type ZoneAccessResponseMsg = { zoneName?: string; sessionId?: string; approved?: boolean };

export function setupZoneLockHandlers(room: WorldRoom, state: ZoneLockState, prisma: PrismaClient): void {
  room.onMessage<ZoneLockMsg>('zone_lock', (client, data) => {
    void handleZoneLock(room, state, prisma, client, data);
  });
  room.onMessage<ZoneLockMsg>('zone_unlock', (client, data) => {
    void handleZoneUnlock(room, state, prisma, client, data);
  });
  room.onMessage<ZoneAccessRequestMsg>('zone_access_request', (client, data) => {
    void handleZoneAccessRequest(room, state, prisma, client, data);
  });
  room.onMessage<ZoneAccessResponseMsg>('zone_access_response', (client, data) => {
    void handleZoneAccessResponse(room, state, prisma, client, data);
  });
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
    broadcastLockState(room);
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

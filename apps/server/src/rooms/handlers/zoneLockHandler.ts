import { Room } from 'colyseus';
import { pointInPolygon } from '@meetropolis/shared';
import type { ZoneLockInfo } from '@meetropolis/shared';
import { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';

interface ZonePolygon {
  name: string;
  polygon: { x: number; y: number }[];
}

interface ZoneLockState {
  locks: Map<string, ZoneLockInfo>;        // key: mapId:zoneName
  zoneCache: Map<string, ZonePolygon[]>;   // zones per mapId
  lastAutoUnlockCheck: number;
}

export function createZoneLockState(): ZoneLockState {
  return {
    locks: new Map(),
    zoneCache: new Map(),
    lastAutoUnlockCheck: 0,
  };
}

// Zones aus DB laden + cachen
async function loadZones(state: ZoneLockState, mapId: string, tenantSlug: string, prisma: PrismaClient): Promise<ZonePolygon[]> {
  if (state.zoneCache.has(mapId)) return state.zoneCache.get(mapId)!;
  try {
    const map = await prisma.map.findFirst({
      where: { id: mapId, tenant: { slug: tenantSlug } },
    });
    if (!map) return [];
    const meta = (map.meta as any) || {};
    const zones: ZonePolygon[] = [];
    if (Array.isArray(meta.zones)) {
      for (const z of meta.zones) {
        if (!z.name) continue;
        const points = Array.isArray(z.points) ? z.points : Array.isArray(z.polygon) ? z.polygon : [];
        const polygon = points
          .map((p: any) => {
            if (Array.isArray(p) && p.length >= 2) return { x: Number(p[0]), y: Number(p[1]) };
            if (p && typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y };
            return null;
          })
          .filter((p: any): p is { x: number; y: number } => p !== null);
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

// Welche Zone ist ein Spieler drin?
function getPlayerZone(zones: ZonePolygon[], pos: { x: number; y: number }): string | null {
  for (const z of zones) {
    if (pointInPolygon(pos, z.polygon)) return z.name;
  }
  return null;
}

function lockKey(mapId: string, zoneName: string): string {
  return `${mapId}:${zoneName}`;
}

// Lock-State an alle broadcasten
function broadcastLockState(room: Room, state: ZoneLockState): void {
  const locks: ZoneLockInfo[] = Array.from(state.locks.values());
  room.broadcast('zone_lock_state', { locks });
}

// Auto-unlock prüfen: Wenn keine Spieler mit Zugang mehr in der Zone sind
function checkAutoUnlock(room: Room, state: ZoneLockState): void {
  const now = Date.now();
  if (now - state.lastAutoUnlockCheck < 500) return;
  state.lastAutoUnlockCheck = now;

  const toDelete: string[] = [];
  for (const [key, lock] of state.locks) {
    const zones = state.zoneCache.get(lock.mapId) || [];
    let hasAccessPlayerInZone = false;
    // Prüfe ob mind. 1 Spieler mit Zugang noch in der Zone ist
    room.state.players.forEach((player: any, sessionId: string) => {
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

// Prüfe ob Bewegung in gesperrte Zone geht
export function isMovementBlocked(
  state: ZoneLockState,
  sessionId: string,
  mapId: string,
  newPos: { x: number; y: number }
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

export function setupZoneLockHandlers(room: Room, state: ZoneLockState, prisma: PrismaClient): void {
  const getTenantSlug = () => (room.metadata as any)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';

  // Zone sperren
  room.onMessage('zone_lock', async (client, data: { zoneName?: string }) => {
    const player = room.state.players.get(client.sessionId) as any;
    if (!player || !data?.zoneName) return;

    const mapId = player.mapId;
    const tenantSlug = getTenantSlug();
    const zones = await loadZones(state, mapId, tenantSlug, prisma);
    const playerZone = getPlayerZone(zones, { x: player.x, y: player.y });

    // Spieler muss in der Zone sein
    if (playerZone !== data.zoneName) return;

    const key = lockKey(mapId, data.zoneName);
    if (state.locks.has(key)) return; // Already locked

    // Alle Spieler die aktuell in der Zone sind → accessList
    const accessList: string[] = [];
    room.state.players.forEach((p: any, sessionId: string) => {
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
  });

  // Zone entsperren
  room.onMessage('zone_unlock', (client, data: { zoneName?: string }) => {
    if (!data?.zoneName) return;
    const player = room.state.players.get(client.sessionId) as any;
    if (!player) return;

    const key = lockKey(player.mapId, data.zoneName);
    const lock = state.locks.get(key);
    if (!lock) return;

    // Nur Spieler mit Zugang dürfen entsperren
    if (!lock.accessList.includes(client.sessionId)) return;

    state.locks.delete(key);
    broadcastLockState(room, state);
    logger.info('[ZoneLock] Zone unlocked:', data.zoneName, 'by', client.sessionId);
  });

  // Zugriffsanfrage von außen
  room.onMessage('zone_access_request', (client, data: { zoneName?: string; mapId?: string }) => {
    if (!data?.zoneName || !data?.mapId) return;
    const player = room.state.players.get(client.sessionId) as any;
    if (!player) return;

    const key = lockKey(data.mapId, data.zoneName);
    const lock = state.locks.get(key);
    if (!lock) return;

    // Spieler darf nicht bereits Zugang haben
    if (lock.accessList.includes(client.sessionId)) return;

    // Nicht doppelt anfragen
    if (lock.pendingRequests.some((r: { sessionId: string }) => r.sessionId === client.sessionId)) return;

    lock.pendingRequests.push({
      sessionId: client.sessionId,
      identity: player.identity || client.sessionId,
      name: player.name || player.identity || client.sessionId,
    });

    broadcastLockState(room, state);
    logger.info('[ZoneLock] Access request for', data.zoneName, 'from', client.sessionId);
  });

  // Zugriffsanfrage beantworten
  room.onMessage('zone_access_response', (client, data: { zoneName?: string; sessionId?: string; approved?: boolean }) => {
    if (!data?.zoneName || !data?.sessionId) return;
    const player = room.state.players.get(client.sessionId) as any;
    if (!player) return;

    const key = lockKey(player.mapId, data.zoneName);
    const lock = state.locks.get(key);
    if (!lock) return;

    // Nur Spieler mit Zugang dürfen antworten
    if (!lock.accessList.includes(client.sessionId)) return;

    // Request entfernen
    lock.pendingRequests = lock.pendingRequests.filter((r: { sessionId: string }) => r.sessionId !== data.sessionId);

    if (data.approved) {
      lock.accessList.push(data.sessionId);
      logger.info('[ZoneLock] Access approved for', data.sessionId, 'to', data.zoneName);
    } else {
      // Requester benachrichtigen
      const requesterClient = room.clients.find(c => c.sessionId === data.sessionId);
      if (requesterClient) {
        requesterClient.send('zone_access_denied', { zoneName: data.zoneName });
      }
      logger.info('[ZoneLock] Access denied for', data.sessionId, 'to', data.zoneName);
    }

    broadcastLockState(room, state);
  });
}

// Spieler verlässt: aus allen Listen entfernen
export function onPlayerLeaveZoneLock(room: Room, state: ZoneLockState, sessionId: string): void {
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

// Zone-Cache invalidieren (bei editor_update)
export function invalidateZoneCache(state: ZoneLockState, mapId?: string): void {
  if (mapId) {
    state.zoneCache.delete(mapId);
  } else {
    state.zoneCache.clear();
  }
}

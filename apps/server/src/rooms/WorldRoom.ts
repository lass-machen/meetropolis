import { Room, type Client } from 'colyseus';
import { logger } from '../logger.js';
import { colyseusRooms, colyseusPlayers } from '../metrics.js';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { PrismaClient } from '../generated/prisma/index.js';
import { getTenancyModule, OSS_USER_LIMIT } from '../tenancyLoader.js';
import { getBillingModuleSync } from '../billingLoader.js';
import { createZoneLockState, setupZoneLockHandlers, onPlayerLeaveZoneLock, isMovementBlocked, invalidateZoneCache } from './handlers/zoneLockHandler.js';

interface RoomOptions {
  tenant?: string;
  x?: number;
  y?: number;
  direction?: string;
  identity?: string;
  name?: string;
  avatarId?: string;
  mapId?: string;
  mapName?: string;
}

interface MapMeta {
  spawn?: { x: number; y: number };
  [key: string]: unknown;
}

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

interface PendingClient {
  client: Client;
  options: RoomOptions;
  identity: string;
  timestamp: number;
}

class Player extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('string') direction: string = 'down';
  @type('string') identity: string = ''; // User's actual identity for LiveKit
  @type('string') name: string = ''; // User's display name
  @type('boolean') dnd: boolean = false; // Do Not Disturb status
  @type('string') avatarId: string = '';
  @type('boolean') isNpc: boolean = false;
  @type('string') mapId: string = '';
  @type('string') mapName: string = '';
}

class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

// Store all active rooms globally for API access
const activeRooms = new Set<WorldRoom>();

interface MapCacheEntry {
  widthTiles: number;
  heightTiles: number;
  tileWidthPx: number;
  tileHeightPx: number;
  defaultSpawn: { x: number; y: number } | null;
}

export class WorldRoom extends Room<WorldState> {
  private defaultSpawn: { x: number; y: number } | null = null;
  private prismaForPresence: PrismaClient | null = null;
  // Map-Metadaten (Pixel-Grenzen berechnen zu können)
  private mapWidthTiles: number | null = null;
  private mapHeightTiles: number | null = null;
  private tileWidthPx: number | null = null;
  private tileHeightPx: number | null = null;
  // Multi-map cache
  private mapCache: Map<string, MapCacheEntry> = new Map();
  // Guest expiry check interval
  private guestExpiryInterval: ReturnType<typeof setInterval> | null = null;
  // Persist multiple bubble groups: groupId -> member sessionIds
  private bubbleGroups: Record<string, string[]> = {};
  private zoneLockState = createZoneLockState();
  private pendingClients: Map<string, PendingClient> = new Map();
  private static readonly PENDING_TIMEOUT_MS = 30_000;
  private pendingCleanupInterval: ReturnType<typeof setInterval> | null = null;
  // Session-Hygiene: letzte Aktivität je sessionId (kein Schema-Broadcast, nur Server-Memory)
  private lastSeen: Map<string, number> = new Map();
  // Ghost-Threshold: session ohne lastSeen-Update ueber dieser Dauer wird als Ghost aufgeraeumt
  private static readonly GHOST_THRESHOLD_MS = Number(process.env.GHOST_THRESHOLD_MS ?? 60_000);
  // Graceful-Leave: pending delete-Timer pro sessionId, fuer Reconnect-Heal (siehe onLeave)
  private pendingLeaves: Map<string, ReturnType<typeof setTimeout>> = new Map();
  // Grace-Period vor finalem player-delete (ms) — glaettet kurze Disconnects/Reconnects
  private static readonly LEAVE_GRACE_MS = Number(process.env.LEAVE_GRACE_MS ?? 300);
  private getAllBubbleMembers(): string[] {
    const all: string[] = [];
    for (const members of Object.values(this.bubbleGroups)) {
      for (const m of members) { if (!all.includes(m)) all.push(m); }
    }
    return all;
  }
  private canonicalGroupId(members: string[]): string {
    return Array.from(new Set(members)).sort().join('|');
  }
  private broadcastBubbleState(): void {
    // Build valid groups (filter out disconnected players)
    const validGroups = Object.entries(this.bubbleGroups).map(([id, members]) => ({
      id,
      members: members.filter((m) => this.state.players.has(m)),
    })).filter(g => Array.isArray(g.members) && g.members.length >= 2);

    // Collect all distinct mapIds that have players
    const mapIds = new Set<string>();
    this.state.players.forEach((player) => {
      if (player.mapId) mapIds.add(player.mapId);
    });

    // For each map, broadcast only the bubble groups where ALL members are on that map
    for (const mapId of mapIds) {
      const mapGroups = validGroups.filter(g =>
        g.members.every(m => {
          const p = this.state.players.get(m);
          return p && p.mapId === mapId;
        })
      );
      const mapMembers: string[] = [];
      for (const g of mapGroups) {
        for (const m of g.members) {
          if (!mapMembers.includes(m)) mapMembers.push(m);
        }
      }
      this.broadcastToMap(mapId, 'bubble_state', { groups: mapGroups, members: mapMembers });
    }
  }

  private findExistingSession(identity: string): { room: WorldRoom; sessionId: string; client: Client } | null {
    for (const room of activeRooms) {
      const worldRoom = room as WorldRoom;
      let foundSessionId: string | null = null;
      worldRoom.state.players.forEach((p, sid) => {
        if (p.identity === identity) foundSessionId = sid;
      });
      if (foundSessionId !== null) {
        const sid = foundSessionId as string;
        // Ghost-Detection: wenn lastSeen zu alt ist, Session direkt aufraeumen statt Takeover-Flow
        const lastSeen = worldRoom.lastSeen.get(sid) ?? 0;
        const age = Date.now() - lastSeen;
        if (lastSeen === 0 || age > WorldRoom.GHOST_THRESHOLD_MS) {
          const ghostPlayer = worldRoom.state.players.get(sid);
          const mapIdForGhost = ghostPlayer?.mapId;
          worldRoom.state.players.delete(sid);
          worldRoom.lastSeen.delete(sid);
          // Falls noch ein pending Graceful-Leave-Timer laeuft, abbrechen (wird direkt gecleant)
          const pendingTimer = worldRoom.pendingLeaves.get(sid);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            worldRoom.pendingLeaves.delete(sid);
          }
          try { colyseusPlayers.dec(); } catch { /* metric best-effort */ }
          // Direkter Broadcast (kein Grace) — user war eh schon weg
          if (mapIdForGhost) {
            worldRoom.broadcastToMap(mapIdForGhost, 'player_left', { id: sid });
          } else {
            worldRoom.broadcast('player_left', { id: sid });
          }
          logger.info('[WorldRoom] Ghost session cleaned for identity:', identity, 'sid:', sid, 'age(ms):', age);
          // Kein Takeover noetig — neuer Client joined normal
          return null;
        }
        const matchedClient = worldRoom.clients.find((c: Client) => c.sessionId === sid);
        if (matchedClient) {
          return { room: worldRoom, sessionId: sid, client: matchedClient };
        }
      }
    }
    return null;
  }

  private async ensureMapMeta(mapId: string, tenantSlug: string): Promise<MapCacheEntry | null> {
    if (this.mapCache.has(mapId)) return this.mapCache.get(mapId)!;
    const prisma = this.prismaForPresence ?? new PrismaClient();
    try {
      // Look up by ID first, fall back to name for backward compat
      let map = await prisma.map.findFirst({ where: { id: mapId, tenant: { slug: tenantSlug } } });
      if (!map) {
        map = await prisma.map.findFirst({ where: { name: mapId, tenant: { slug: tenantSlug } } });
      }
      if (!map) return null;
      const meta: MapMeta = (map.meta as MapMeta) || {};
      const sp = meta?.spawn;
      const entry: MapCacheEntry = {
        widthTiles: map.width ?? 32,
        heightTiles: map.height ?? 32,
        tileWidthPx: map.tileWidth ?? 16,
        tileHeightPx: map.tileHeight ?? 16,
        defaultSpawn: (sp && typeof sp.x === 'number' && typeof sp.y === 'number') ? { x: sp.x, y: sp.y } : null,
      };
      this.mapCache.set(mapId, entry);
      return entry;
    } catch (e) {
      logger.debug('[WorldRoom] ensureMapMeta failed for', mapId, e);
      return null;
    }
  }

  private getBoundsPxForMap(mapId?: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (mapId && this.mapCache.has(mapId)) {
      const entry = this.mapCache.get(mapId)!;
      const minX = entry.tileWidthPx / 2;
      const minY = entry.tileHeightPx / 2;
      const maxX = entry.widthTiles * entry.tileWidthPx - entry.tileWidthPx / 2;
      const maxY = entry.heightTiles * entry.tileHeightPx - entry.tileHeightPx / 2;
      return { minX, minY, maxX, maxY };
    }
    return this.getBoundsPx();
  }

  private sanitizePositionForMap(x: number, y: number, mapId?: string): { x: number; y: number } {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (mapId && this.mapCache.has(mapId)) {
        const entry = this.mapCache.get(mapId)!;
        return entry.defaultSpawn ?? {
          x: (entry.widthTiles * entry.tileWidthPx) / 2,
          y: (entry.heightTiles * entry.tileHeightPx) / 2,
        };
      }
      const fallback = this.defaultSpawn ?? this.getMapCenter();
      return fallback ?? { x: 200, y: 200 };
    }
    const bounds = this.getBoundsPxForMap(mapId);
    if (!bounds) return { x, y };
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
      if (mapId && this.mapCache.has(mapId)) {
        const entry = this.mapCache.get(mapId)!;
        const fallback = entry.defaultSpawn ?? {
          x: (entry.widthTiles * entry.tileWidthPx) / 2,
          y: (entry.heightTiles * entry.tileHeightPx) / 2,
        };
        return {
          x: Math.max(bounds.minX, Math.min(bounds.maxX, fallback.x)),
          y: Math.max(bounds.minY, Math.min(bounds.maxY, fallback.y)),
        };
      }
      const fallback = this.defaultSpawn ?? this.getMapCenter();
      if (fallback) {
        return {
          x: Math.max(bounds.minX, Math.min(bounds.maxX, fallback.x)),
          y: Math.max(bounds.minY, Math.min(bounds.maxY, fallback.y)),
        };
      }
      return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
        y: Math.max(bounds.minY, Math.min(bounds.maxY, y)),
      };
    }
    return { x, y };
  }

  private broadcastToMap(mapId: string, event: string, data: unknown, except?: Client) {
    for (const client of this.clients) {
      if (except && client === except) continue;
      const player = this.state.players.get(client.sessionId);
      if (player && player.mapId === mapId) {
        client.send(event, data);
      }
    }
  }

  override onCreate(options?: RoomOptions) {
    this.setState(new WorldState());
    // Room wird automatisch disposed wenn leer (Colyseus default; explizit dokumentiert)
    this.autoDispose = true;
    // Flooding-Schutz: harter Client-Deckel pro Room (env override möglich)
    this.maxClients = Number(process.env.MAX_CLIENTS_PER_ROOM ?? 200);
    logger.info('[WorldRoom] Room created with initial state');
    activeRooms.add(this);
    try { colyseusRooms.inc(); } catch (e) { logger.debug('[WorldRoom] Failed to increment colyseusRooms metric', e); }

    // Make rooms accessible globally
    (global as Record<string, unknown>).activeWorldRooms = activeRooms;

    // Attach tenant metadata for filterBy and accounting
    try {
      const tenantSlug = options?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
      this.setMetadata({ tenant: tenantSlug });
    } catch (e) { logger.debug('[WorldRoom] Failed to set metadata', e); }

    // Load default spawn and map meta from DB (best-effort)
    (async () => {
      try {
        const prisma = new PrismaClient();
        this.prismaForPresence = prisma;
        const tenantSlug = options?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
        const tenantRecord = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { defaultMapName: true } });
        const mapName = tenantRecord?.defaultMapName || process.env.DEFAULT_MAP_NAME || 'office';
        let resolvedMap = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
        if (!resolvedMap) {
          // Default map not found — try first available map for this tenant
          resolvedMap = await prisma.map.findFirst({
            where: { tenant: { slug: tenantSlug } },
            orderBy: { createdAt: 'asc' },
          });
        }
        // Map-Metadaten cachen (für Bounds/Clamping)
        if (resolvedMap) {
          try {
            // width/height in Tiles, tileWidth/tileHeight in Pixel
            this.mapWidthTiles = resolvedMap.width ?? null;
            this.mapHeightTiles = resolvedMap.height ?? null;
            this.tileWidthPx = resolvedMap.tileWidth ?? null;
            this.tileHeightPx = resolvedMap.tileHeight ?? null;
            // Also store in multi-map cache (keyed by mapId)
            const meta: MapMeta = (resolvedMap.meta as MapMeta) || {};
            const sp = meta?.spawn;
            this.mapCache.set(resolvedMap.id, {
              widthTiles: resolvedMap.width ?? 32,
              heightTiles: resolvedMap.height ?? 32,
              tileWidthPx: resolvedMap.tileWidth ?? 16,
              tileHeightPx: resolvedMap.tileHeight ?? 16,
              defaultSpawn: (sp && typeof sp.x === 'number' && typeof sp.y === 'number') ? { x: sp.x, y: sp.y } : null,
            });
          } catch (e) { logger.debug('[WorldRoom] Failed to cache map metadata', e); }
        }
        const meta = (resolvedMap?.meta as MapMeta) || {};
        const sp = meta?.spawn;
        if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
          const clamped = this.sanitizePosition(sp.x, sp.y);
          this.defaultSpawn = clamped;
          logger.info('[WorldRoom] Loaded default spawn from DB:', this.defaultSpawn);
        }
      } catch (e) {
        try { logger.debug('[WorldRoom] Failed to load default spawn:', e instanceof Error ? e.message : String(e)); } catch (e2) { logger.debug('[WorldRoom] Failed to log default spawn error', e2); }
      }
    })().catch(() => { });
    const lastMove: Map<string, number> = new Map();
    this.onMessage('move', (client, data: { x: number; y: number; direction: string }) => {
      const now = Date.now();
      // Aktivitaet registrieren — reicht als impliziter Heartbeat
      this.lastSeen.set(client.sessionId, now);
      const prev = lastMove.get(client.sessionId) || 0;
      if (now - prev < 80) {
        return; // drosseln ~12.5 Hz
      }
      lastMove.set(client.sessionId, now);
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        logger.warn('[WorldRoom] Move from unknown player:', client.sessionId);
        return;
      }
      // Zone lock: block movement into locked zones
      const moveCheck = isMovementBlocked(this.zoneLockState, client.sessionId, player.mapId, { x: data.x, y: data.y });
      if (moveCheck.blocked) {
        client.send('zone_move_blocked', { zoneName: moveCheck.zoneName });
        return;
      }

      player.x = data.x;
      player.y = data.y;
      player.direction = data.direction;

      // Broadcast movement to players on the same map
      this.broadcastToMap(player.mapId, 'player_moved', {
        id: client.sessionId,
        x: data.x,
        y: data.y,
        direction: data.direction,
        mapId: player.mapId,
        mapName: player.mapName,
      }, client);
    });


    // Handle editor updates
    this.onMessage('editor_update', (client, data: { type: string; [key: string]: unknown }) => {
      logger.debug('[WorldRoom] Editor update from:', client.sessionId, 'type:', data.type);
      const player = this.state.players.get(client.sessionId);
      const mapId = typeof data.mapId === 'string' ? data.mapId : player?.mapId;
      if (mapId) {
        this.broadcastToMap(mapId, 'editor_update', data, client);
      } else {
        this.broadcast('editor_update', data, { except: client });
      }
      // Invalidate zone cache on editor updates so locks use fresh zone data
      invalidateZoneCache(this.zoneLockState);
    });

    // Handle DND status updates
    this.onMessage('dnd_status', (client, data: { dnd: boolean }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        logger.warn('[WorldRoom] DND status from unknown player:', client.sessionId);
        return;
      }
      player.dnd = data.dnd;
      logger.info('[WorldRoom] Player', client.sessionId, 'DND status:', data.dnd);

      // Broadcast DND status to players on the same map
      this.broadcastToMap(player.mapId, 'player_dnd', {
        id: client.sessionId,
        dnd: data.dnd
      }, client);
    });

    // Handle avatar change
    this.onMessage('avatar_change', (client, data: { avatarId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.avatarId = data.avatarId;
      this.broadcastToMap(player.mapId, 'player_avatar', { id: client.sessionId, avatarId: data.avatarId }, client);
    });

    // Handle remote control messages from API
    this.onMessage('remote_control', (client, data: Record<string, unknown>) => {
      logger.info('[WorldRoom] Remote control received for:', client.sessionId, 'data:', data);
      // Forward to the specific client
      client.send('remote_control', data);
    });

    // Bubble-Updates: Mehrere Gruppen unterstützen
    this.onMessage('bubble_update', (_client, data: { id?: string; members?: string[] }) => {
      const raw = Array.isArray(data?.members) ? data.members : [];
      const filtered = Array.from(new Set(raw)).filter((id) => this.state.players.has(id));
      logger.info('[WorldRoom] bubble_update:', filtered);
      // Entferne die Mitglieder aus bestehenden Gruppen
      if (filtered.length > 0) {
        const toRemoveFrom: string[] = [];
        for (const [gid, mems] of Object.entries(this.bubbleGroups)) {
          if (mems.some(m => filtered.includes(m))) toRemoveFrom.push(gid);
        }
        for (const gid of toRemoveFrom) delete this.bubbleGroups[gid];
      }
      // Leere Liste bedeutet: nur Auflösen ohne neue Gruppe
      if (filtered.length >= 2) {
        const gid = data?.id && typeof data.id === 'string' && data.id.length > 0
          ? data.id
          : this.canonicalGroupId(filtered);
        this.bubbleGroups[gid] = filtered;
      }
      this.broadcastBubbleState();
    });

    // NPC command handler (no-op: commands are broadcast from API, NPC service listens)
    this.onMessage('npc_command', () => {});

    // Heartbeat: Client pingt periodisch, Server aktualisiert lastSeen fuer Ghost-Detection
    this.onMessage('heartbeat', (client) => {
      this.lastSeen.set(client.sessionId, Date.now());
    });

    // Handle map change requests
    this.onMessage('change_map', async (client, data: { mapId: string; spawnX?: number; spawnY?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const targetMapId = data?.mapId;
      if (!targetMapId || typeof targetMapId !== 'string') {
        client.send('change_map_error', { error: 'invalid_map_id' });
        return;
      }

      const tenantSlug = (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';

      // Look up map by ID from DB
      const prisma = this.prismaForPresence ?? new PrismaClient();
      const map = await prisma.map.findFirst({
        where: { id: targetMapId, tenant: { slug: tenantSlug } },
      });
      if (!map) {
        client.send('change_map_error', { error: 'map_not_found', mapId: targetMapId });
        return;
      }

      // Ensure map meta is cached (keyed by mapId)
      const mapMeta = await this.ensureMapMeta(map.id, tenantSlug);

      const oldMapId = player.mapId;
      const oldMapName = player.mapName;

      // Remove from bubble groups
      let bubbleChanged = false;
      for (const [gid, members] of Object.entries(this.bubbleGroups)) {
        if (members.includes(client.sessionId)) {
          this.bubbleGroups[gid] = members.filter(m => m !== client.sessionId);
          bubbleChanged = true;
        }
      }
      for (const [gid, members] of Object.entries(this.bubbleGroups)) {
        if (!Array.isArray(members) || members.length < 2) {
          delete this.bubbleGroups[gid];
          bubbleChanged = true;
        }
      }
      if (bubbleChanged) this.broadcastBubbleState();

      // Set new map and spawn position
      player.mapId = map.id;
      player.mapName = map.name;
      // Use portal spawn override if provided, otherwise fall back to map default spawn
      let spawn: { x: number; y: number };
      if (typeof data.spawnX === 'number' && typeof data.spawnY === 'number') {
        spawn = this.sanitizePositionForMap(data.spawnX, data.spawnY, map.id);
      } else {
        spawn = mapMeta?.defaultSpawn || {
          x: ((mapMeta?.widthTiles ?? 32) * (mapMeta?.tileWidthPx ?? 16)) / 2,
          y: ((mapMeta?.heightTiles ?? 32) * (mapMeta?.tileHeightPx ?? 16)) / 2,
        };
      }
      player.x = spawn.x;
      player.y = spawn.y;

      // Notify the changing client
      client.send('map_changed', {
        mapId: map.id,
        mapName: map.name,
        x: player.x,
        y: player.y,
      });

      // Notify all other clients
      this.broadcast('player_map_changed', {
        id: client.sessionId,
        oldMapId,
        newMapId: map.id,
        oldMapName,
        newMapName: map.name,
        mapId: map.id,
        mapName: map.name,
        x: player.x,
        y: player.y,
        name: player.name,
        identity: player.identity,
        avatarId: player.avatarId,
        dnd: player.dnd,
        isNpc: player.isNpc,
      }, { except: client });

      // Update presence in DB (best-effort)
      try {
        if (this.prismaForPresence) {
          await this.prismaForPresence.presence.updateMany({
            where: { userId: player.identity },
            data: {
              mapName: map.name,
              x: Math.round(player.x),
              y: Math.round(player.y),
            },
          });
        }
      } catch (e) {
        logger.debug('[WorldRoom] Failed to update presence mapName', e);
      }

      logger.info('[WorldRoom] Player', client.sessionId, 'changed map:', oldMapId, '->', map.id, `(${map.name})`);
    });

    // Guest expiry check: every 60 seconds, disconnect expired guest users
    this.guestExpiryInterval = setInterval(async () => {
      try {
        const tenantSlug = (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
        const prisma = this.prismaForPresence ?? new PrismaClient();
        const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
        if (!tenant) return;

        const expiredGuests = await prisma.membership.findMany({
          where: {
            tenantId: tenant.id,
            role: 'guest',
            expiresAt: { lt: new Date() },
          },
          select: { userId: true },
        });

        if (expiredGuests.length === 0) return;

        const expiredUserIds = new Set(expiredGuests.map((g) => g.userId));

        // Find connected clients that are expired guests
        this.state.players.forEach((player, sessionId) => {
          if (expiredUserIds.has(player.identity)) {
            const matchedClient = this.clients.find((c) => c.sessionId === sessionId);
            if (matchedClient) {
              try { matchedClient.error(4006, 'guest_expired'); } catch { }
              matchedClient.leave(1000);
            }
          }
        });

        // Delete sessions for expired guests
        for (const userId of expiredUserIds) {
          await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
        }
      } catch (e) {
        logger.debug('[WorldRoom] Guest expiry check failed', e);
      }
    }, 60_000);

    // Subscribe to map updates via Presence (works across processes if Redis is used, or locally)
    try {
      const tenantSlug = options?.tenant || (this.metadata as RoomMetadata)?.tenant || 'default';
      this.presence.subscribe(`map_update:${tenantSlug}`, (message: { type: string; payload: unknown }) => {
        try {
          const payload = message.payload as Record<string, unknown> | undefined;
          const mapId = typeof payload?.mapId === 'string' ? payload.mapId : null;

          if (message.type === 'chunks_updated') {
            if (mapId) this.broadcastToMap(mapId, 'chunks_updated', payload);
            else this.broadcast('chunks_updated', payload);
          } else if (message.type === 'tileset_registry_updated') {
            if (mapId) this.broadcastToMap(mapId, 'tileset_registry_updated', payload);
            else this.broadcast('tileset_registry_updated', payload);
          } else if (message.type === 'objects_updated') {
            if (mapId) this.broadcastToMap(mapId, 'objects_updated', payload);
            else this.broadcast('objects_updated', payload);
          } else if (message.type === 'editor_update') {
            if (mapId) this.broadcastToMap(mapId, 'editor_update', payload);
            else this.broadcast('editor_update', payload);
          }
        } catch (e) {
          logger.error('[WorldRoom] Failed to handle presence map_update', e);
        }
      });
    } catch (e) {
      logger.error('[WorldRoom] Failed to subscribe to presence', e);
    }

    // Setup zone lock handlers
    setupZoneLockHandlers(this, this.zoneLockState, this.prismaForPresence ?? new PrismaClient());

    // Session takeover: new client confirms it wants to replace the existing session
    this.onMessage('session_takeover', async (client, data?: { identity?: string }) => {
      const identity = data?.identity;
      if (!identity) return;

      const pending = this.pendingClients.get(identity);
      if (!pending || pending.client.sessionId !== client.sessionId) {
        logger.warn('[WorldRoom] Invalid session_takeover attempt from', client.sessionId);
        return;
      }

      // WICHTIG: pending zuerst loeschen, damit completePendingJoin den neuen Client
      // nicht selbst wieder als pending erkennt (Duplicate-Check in onJoin).
      this.pendingClients.delete(identity);

      // Race-Fix: ZUERST den neuen Player in den State setzen, DANACH den alten entfernen.
      // Effekt: Andere Clients sehen nie eine Luecke (atomarer Swap aus Client-Sicht).
      logger.info('[WorldRoom] Session takeover: completing join for identity:', identity);
      await this.completePendingJoin(pending.client, pending.options, pending.identity);

      // Jetzt alten Eintrag aus allen Rooms raeumen
      const newSid = pending.client.sessionId;
      for (const room of activeRooms) {
        const worldRoom = room as WorldRoom;
        const toRemove: string[] = [];
        worldRoom.state.players.forEach((p, sid) => {
          // Neue Session NICHT entfernen (gleiche identity, aber andere sid)
          if (p.identity === identity && sid !== newSid) toRemove.push(sid);
        });
        for (const oldSid of toRemove) {
          const oldPlayer = worldRoom.state.players.get(oldSid);
          const oldMapId = oldPlayer?.mapId;
          // Falls Graceful-Timer laeuft, cancelen (wir gehen sofort)
          const pendingTimer = worldRoom.pendingLeaves.get(oldSid);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            worldRoom.pendingLeaves.delete(oldSid);
          }
          worldRoom.state.players.delete(oldSid);
          worldRoom.lastSeen.delete(oldSid);
          try { colyseusPlayers.dec(); } catch { /* metric best-effort */ }
          // Symmetrie zu player_joined: Broadcast auf derselben Map
          if (oldMapId) {
            worldRoom.broadcastToMap(oldMapId, 'player_left', { id: oldSid });
          } else {
            worldRoom.broadcast('player_left', { id: oldSid });
          }
          const oldClient = worldRoom.clients.find((c: Client) => c.sessionId === oldSid);
          if (oldClient) {
            try { oldClient.error(4007, 'session_taken_over'); } catch { /* best-effort */ }
            try { oldClient.leave(1000); } catch { /* best-effort */ }
          }
        }
      }
      logger.info('[WorldRoom] Session takeover completed for identity:', identity);
    });

    // Session takeover cancel: new client decides not to take over
    this.onMessage('session_takeover_cancel', (client) => {
      for (const [identity, pending] of this.pendingClients.entries()) {
        if (pending.client.sessionId === client.sessionId) {
          this.pendingClients.delete(identity);
          logger.info('[WorldRoom] Session takeover cancelled for identity:', identity);
          break;
        }
      }
      try { client.leave(1000); } catch {}
    });

    // Pending client timeout check
    this.pendingCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [identity, pending] of this.pendingClients.entries()) {
        if (now - pending.timestamp > WorldRoom.PENDING_TIMEOUT_MS) {
          this.pendingClients.delete(identity);
          try { pending.client.leave(1000); } catch {}
          logger.info('[WorldRoom] Pending client timed out:', identity);
        }
      }
    }, 10_000);
  }

  // Editor-Updates können das Default-Spawn live setzen
  public setDefaultSpawn(mapId: string, pos: { x: number; y: number }) {
    const s = this.sanitizePositionForMap(pos.x, pos.y, mapId);
    this.defaultSpawn = s;
    // Update mapCache entry for the affected map
    const cached = this.mapCache.get(mapId);
    if (cached) {
      cached.defaultSpawn = s;
    }
    try { logger.info('[WorldRoom] Default spawn updated for map', mapId, 'to:', s); } catch (e) { logger.debug('[WorldRoom] Failed to log default spawn update', e); }
  }

  private getBoundsPx(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const wTiles = this.mapWidthTiles;
    const hTiles = this.mapHeightTiles;
    const tW = this.tileWidthPx;
    const tH = this.tileHeightPx;
    if (!wTiles || !hTiles || !tW || !tH) return null;
    const minX = tW / 2;
    const minY = tH / 2;
    const maxX = wTiles * tW - tW / 2;
    const maxY = hTiles * tH - tH / 2;
    return { minX, minY, maxX, maxY };
  }

  private sanitizePosition(x: number, y: number): { x: number; y: number } {
    // Ungültige Zahlen -> späterer Fallback handled das
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const fallback = this.defaultSpawn ?? this.getMapCenter();
      return fallback ?? { x: 200, y: 200 };
    }
    const bounds = this.getBoundsPx();
    if (!bounds) {
      // Keine Map-Grenzen bekannt – zurückgeben wie gegeben
      return { x, y };
    }
    // Liegt Position außerhalb der Bounds? → lieber auf Spawn/Center zurückfallen
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
      const fallback = this.defaultSpawn ?? this.getMapCenter();
      if (fallback) {
        // Fallback selbst noch einmal klammern (sollte innerhalb sein, aber sicher ist sicher)
        const fx = Math.max(bounds.minX, Math.min(bounds.maxX, fallback.x));
        const fy = Math.max(bounds.minY, Math.min(bounds.maxY, fallback.y));
        return { x: fx, y: fy };
      }
      return { x: Math.max(bounds.minX, Math.min(bounds.maxX, x)), y: Math.max(bounds.minY, Math.min(bounds.maxY, y)) };
    }
    return { x, y };
  }

  private getMapCenter(): { x: number; y: number } | null {
    const wTiles = this.mapWidthTiles;
    const hTiles = this.mapHeightTiles;
    const tW = this.tileWidthPx;
    const tH = this.tileHeightPx;
    if (!wTiles || !hTiles || !tW || !tH) return null;
    return { x: (wTiles * tW) / 2, y: (hTiles * tH) / 2 };
  }

  override async onJoin(client: Client, options?: RoomOptions) {
    // Check OSS user limit (25 concurrent users for self-hosted OSS)
    // Enterprise license holders bypass this limit via bypassOssLimit()
    try {
      const tenancyModule = await getTenancyModule();
      const hasEnterpriseLicense = tenancyModule.bypassOssLimit?.() ?? false;

      if (!hasEnterpriseLicense) {
        // Count all active users across ALL rooms (global OSS limit)
        let totalActive = 0;
        try {
          const rooms = Array.from(activeRooms.values());
          for (const r of rooms) {
            try { totalActive += (r.state?.players?.size) || 0; } catch (e) { logger.debug('[WorldRoom] Failed to get player count from room', e); }
          }
        } catch (e) { logger.debug('[WorldRoom] Failed to count total active users', e); }

        if (totalActive >= OSS_USER_LIMIT) {
          try { logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT }); } catch (e) { logger.debug('[WorldRoom] Failed to log OSS limit warning', e); }
          try { client.error(4002, 'oss_limit_reached'); } catch (e) { logger.debug('[WorldRoom] Failed to send error to client', e); }
          return client.leave(1000);
        }
      }
    } catch (e) { logger.debug('[WorldRoom] Failed to check OSS user limit in onJoin', e); }

    // Enforce concurrent user limit per tenant (unless bypassed)
    try {
      const tenantSlug: string = options?.tenant || (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
      const prisma = new PrismaClient();
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

      // Check subscription status via enterprise billing module (if available)
      const billingMod = getBillingModuleSync();
      if (billingMod && tenant && !tenant.bypassLimits) {
        try {
          const trialStatus = await billingMod.getTrialStatus(prisma, tenant.id);
          if (trialStatus.status === 'expired') {
            try { logger.warn('[WorldRoom] Tenant trial expired', { tenant: tenantSlug }); } catch (e) { logger.debug('[WorldRoom] Failed to log trial expiry', e); }
            try { client.error(4005, 'trial_expired'); } catch (e) { logger.debug('[WorldRoom] Failed to send trial_expired error', e); }
            try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
            return client.leave(1000);
          }

          const dunningStatus = await billingMod.getDunningStatus(prisma, tenant.id);
          if (dunningStatus.status === 'suspended') {
            try { logger.warn('[WorldRoom] Tenant subscription suspended', { tenant: tenantSlug }); } catch (e) { logger.debug('[WorldRoom] Failed to log subscription suspension', e); }
            try { client.error(4004, 'subscription_suspended'); } catch (e) { logger.debug('[WorldRoom] Failed to send subscription_suspended error', e); }
            try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
            return client.leave(1000);
          }
        } catch (e) {
          logger.debug('[WorldRoom] Billing status check failed (non-blocking)', e);
        }
      }

      if (tenant && !tenant.bypassLimits) {
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
        // Check OSS user limit (25 users max unless enterprise tenancy bypasses it)
        const tenancy = await getTenancyModule();
        const bypassOssLimit = tenancy.bypassOssLimit?.() ?? false;

        if (!bypassOssLimit) {
          // OSS mode: enforce hard 25-user limit across all tenants
          let totalActive = 0;
          try {
            const rooms = Array.from(activeRooms.values());
            for (const r of rooms) {
              try { totalActive += (r.state?.players?.size) || 0; } catch (e) { logger.debug('[WorldRoom] Failed to get player count from room', e); }
            }
          } catch (e) { logger.debug('[WorldRoom] Failed to count total active for OSS limit', e); }
          if (totalActive >= OSS_USER_LIMIT) {
            try { logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT }); } catch (e) { logger.debug('[WorldRoom] Failed to log OSS limit', e); }
            try { client.error(4002, 'oss_limit_reached'); } catch (e) { logger.debug('[WorldRoom] Failed to send oss_limit_reached error', e); }
            try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
            return client.leave(1000);
          }
        }

        // Enterprise mode: enforce per-tenant limit
        const paidSeats = Math.max(0, tenant.concurrentLimit || 0);
        const freeSeats = Math.max(0, tenant.freeSeats || 0);
        const effectiveLimit = Math.max(paidSeats, freeSeats);
        if (active >= effectiveLimit) {
          try { logger.warn('[WorldRoom] Tenant limit reached', { tenant: tenantSlug, active, limit: effectiveLimit, paidSeats, freeSeats }); } catch (e) { logger.debug('[WorldRoom] Failed to log tenant limit', e); }
          try { client.error(4001, 'tenant_limit_reached'); } catch (e) { logger.debug('[WorldRoom] Failed to send tenant_limit_reached error', e); }
          try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
          return client.leave(1000);
        }
      }
      try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
    } catch (e) { logger.debug('[WorldRoom] Failed to enforce tenant/user limits', e); }
    // Duplicate session detection (Two-Phase Join)
    const joiningIdentity = options?.identity || client.sessionId;
    if (!joiningIdentity.startsWith('npc-')) {
      // Graceful-Reconnect-Cancel: falls fuer diese identity noch ein pending Graceful-Leave
      // laeuft (kurzer Disconnect + Reconnect), den Timer stoppen und den alten Eintrag
      // still entfernen. completePendingJoin legt dann einen frischen Eintrag an.
      try {
        for (const room of activeRooms) {
          const worldRoom = room as WorldRoom;
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
            // Stille Entfernung: KEIN broadcast, damit es keinen Flicker gibt.
            worldRoom.state.players.delete(sid);
            worldRoom.lastSeen.delete(sid);
            try { colyseusPlayers.dec(); } catch { /* metric best-effort */ }
            logger.info('[WorldRoom] Graceful reconnect: cancelled pending leave for identity', joiningIdentity, 'oldSid:', sid);
          }
        }
      } catch (e) { logger.debug('[WorldRoom] Failed to cancel pending leaves on reconnect', e); }

      try {
        const existing = this.findExistingSession(joiningIdentity);
        if (existing) {
          // If there's already a pending client for this identity (3rd tab case), kick it
          const prevPending = this.pendingClients.get(joiningIdentity);
          if (prevPending) {
            try { prevPending.client.leave(1000); } catch {}
            this.pendingClients.delete(joiningIdentity);
          }

          // Store new client as pending — no player creation yet
          this.pendingClients.set(joiningIdentity, {
            client,
            options: options || {},
            identity: joiningIdentity,
            timestamp: Date.now(),
          });

          // Notify new client about conflict (message is queued and delivered after JOIN_ROOM handshake)
          client.send('session_conflict', { code: 4007, message: 'session_conflict' });
          logger.info('[WorldRoom] Session conflict detected for identity:', joiningIdentity, '- client pending');
          return; // No player creation, no full_state, no broadcasts
        }
      } catch (e) { logger.debug('[WorldRoom] Failed to check duplicate session', e); }
    }

    await this.completePendingJoin(client, options || {}, joiningIdentity);
  }

  private async completePendingJoin(client: Client, options: RoomOptions, joiningIdentity: string): Promise<void> {
    // Check if joining user is an expired guest
    try {
      const tenantSlug = options?.tenant || (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
      const prismaCheck = this.prismaForPresence ?? new PrismaClient();
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
          try { client.error(4006, 'guest_expired'); } catch { }
          return client.leave(1000);
        }
      }
    } catch (e) { logger.debug('[WorldRoom] Failed to check guest expiry on join', e); }

    // Sicherstellen, dass wir Map-Metadaten haben (Race gegen onCreate-Loader vermeiden)
    try {
      if (!this.mapWidthTiles || !this.mapHeightTiles || !this.tileWidthPx || !this.tileHeightPx || !this.defaultSpawn) {
        const prisma = new PrismaClient();
        const tenantSlug = options?.tenant || (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
        const tenantRec = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { defaultMapName: true } });
        const mapName = tenantRec?.defaultMapName || process.env.DEFAULT_MAP_NAME || 'office';
        let map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
        if (!map) {
          // Default map not found — fall back to first available map for this tenant
          map = await prisma.map.findFirst({
            where: { tenant: { slug: tenantSlug } },
            orderBy: { createdAt: 'asc' },
          });
        }
        try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
        if (map) {
          try {
            this.mapWidthTiles = map.width ?? this.mapWidthTiles;
            this.mapHeightTiles = map.height ?? this.mapHeightTiles;
            this.tileWidthPx = map.tileWidth ?? this.tileWidthPx;
            this.tileHeightPx = map.tileHeight ?? this.tileHeightPx;
          } catch (e) { logger.debug('[WorldRoom] Failed to update map metadata', e); }
          const meta = (map.meta as MapMeta) || {};
          const sp = meta?.spawn;
          if (!this.defaultSpawn && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
            this.defaultSpawn = this.sanitizePosition(sp.x, sp.y);
          }
        }
      }
    } catch (e) { logger.debug('[WorldRoom] Failed to ensure map metadata on join', e); }

    // Determine initial mapId and mapName for the joining player
    let initialMapId = options?.mapId || '';
    let initialMapName = options?.mapName || '';
    if (!initialMapId) {
      try {
        const tenantSlug = options?.tenant || (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
        const prismaForMap = this.prismaForPresence ?? new PrismaClient();
        if (initialMapName) {
          // Resolve mapName to mapId
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
          // Fall back to tenant default
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
            // Default map not found — fall back to first available map for this tenant
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
    }

    const player = new Player();
    player.id = client.sessionId;
    player.mapId = initialMapId;
    player.mapName = initialMapName;
    // Robuste Positionswahl:
    // 1) Wenn Client Koordinaten liefert: validieren/klammern
    // 2) Sonst: Default-Spawn (aus DB), geklammert
    // 3) Sonst: Kartenmitte
    // 4) Notfalls: konservatives (200,200)
    let initial: { x: number; y: number } | null = null;
    if (options && typeof options.x === 'number' && typeof options.y === 'number') {
      initial = this.sanitizePositionForMap(options.x, options.y, initialMapId);
    } else if (this.defaultSpawn) {
      initial = this.sanitizePositionForMap(this.defaultSpawn.x, this.defaultSpawn.y, initialMapId);
    } else {
      initial = this.getMapCenter() ?? { x: 200, y: 200 };
    }
    player.x = initial.x;
    player.y = initial.y;
    player.direction = options?.direction || 'down';
    player.identity = joiningIdentity; // Use provided identity or fallback
    // Prefer client-provided name, but verify it's not just the UUID
    let resolvedName: string | undefined = options?.name;
    let resolvedAvatarId: string | undefined = undefined;
    const isNpcIdentity = (joiningIdentity || '').startsWith('npc-');
    const needsNameLookup = !resolvedName || resolvedName === joiningIdentity;
    // Always load avatarId from DB for non-NPC users (source of truth), and name if needed
    if (!isNpcIdentity && (needsNameLookup || !options?.avatarId)) {
      try {
        const prisma = this.prismaForPresence ?? new PrismaClient();
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
    player.name = resolvedName || joiningIdentity;
    // Priority: explicit options.avatarId (active session update) > DB value (source of truth) > default
    player.avatarId = options?.avatarId || resolvedAvatarId || 'default-characters:businessman1';
    player.isNpc = (joiningIdentity || '').startsWith('npc-');
    this.state.players.set(client.sessionId, player);
    // Initial lastSeen setzen, damit Ghost-Check erst nach Threshold-Ablauf greift
    this.lastSeen.set(client.sessionId, Date.now());
    try { colyseusPlayers.inc(); } catch (e) { logger.debug('[WorldRoom] Failed to increment colyseusPlayers metric', e); }
    logger.info('[WorldRoom] Player joined:', client.sessionId, 'identity:', player.identity, 'name:', player.name, 'mapId:', player.mapId, 'map:', player.mapName, 'at', player.x, player.y);
    logger.debug('[WorldRoom] Current players:', this.state.players.size);

    // Debug: Log all players
    this.state.players.forEach((p, id) => {
      logger.debug('[WorldRoom] - Player', id, 'identity:', p.identity, 'at', p.x, p.y);
    });

    // Send full state to the new client (delay slightly so client can register handlers)
    setTimeout(() => {
      try {
        client.send('full_state', {
          players: Array.from(this.state.players.entries()).map(([id, p]) => ({
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
          }))
        });
        // Aktuellen Bubble-Status (mit Gruppen) mitschicken
        const groups = Object.entries(this.bubbleGroups).map(([id, members]) => ({
          id,
          members: members.filter((m) => this.state.players.has(m)),
        })).filter(g => Array.isArray(g.members) && g.members.length >= 2);
        const members = this.getAllBubbleMembers();
        client.send('bubble_state', { groups, members });
        // Zone lock state mitsenden
        const zoneLocks = Array.from(this.zoneLockState.locks.values());
        if (zoneLocks.length > 0) {
          client.send('zone_lock_state', { locks: zoneLocks });
        }
      } catch (e) { logger.debug('[WorldRoom] Failed to send full_state/bubble_state to client', e); }
    }, 25);

    // Broadcast new player to other clients on the same map
    this.broadcastToMap(player.mapId, 'player_joined', {
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

    // Seed: recent presence list via WS (best-effort, tenant-scoped)
    // Now includes ALL tenant members, even those who never logged in
    try {
      const prisma = this.prismaForPresence ?? new PrismaClient();
      const tenantSlug: string = options?.tenant || (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (tenant) {
        // 1. Hole alle Tenant-Mitglieder
        const memberships = await prisma.membership.findMany({
          where: { tenantId: tenant.id },
          include: { user: { select: { id: true, email: true, name: true } } },
        });

        // 2. Hole Presence-Daten für diese User
        const recent = await prisma.presence.findMany({
          where: { tenantId: tenant.id },
          orderBy: { updatedAt: 'desc' },
          distinct: ['userId'],
          include: { room: { select: { name: true } } },
        });

        // 3. Erstelle Map von userId -> Presence
        type PresenceWithRoom = typeof recent[0];
        const presenceMap = new Map<string, PresenceWithRoom>();
        for (const p of recent) {
          presenceMap.set(p.userId, p);
        }

        // 4. Kombiniere: Alle Mitglieder mit ihren Presence-Daten (falls vorhanden)
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
      }
    } catch (e) {
      try { logger.debug('[WorldRoom] presence_recent seed failed', e); } catch (e2) { logger.debug('[WorldRoom] Failed to log presence_recent error', e2); }
    }
  }

  override onLeave(client: Client) {
    // Clean up pending client if it disconnects before resolving
    for (const [identity, pending] of this.pendingClients.entries()) {
      if (pending.client.sessionId === client.sessionId) {
        this.pendingClients.delete(identity);
        logger.info('[WorldRoom] Pending client left before resolving conflict:', identity);
        return; // No player state to clean up
      }
    }

    // Persist position + mapName before removing player (fire-and-forget)
    // WICHTIG: Synchron auslösen (vor Graceful-Timer), damit bei Crash innerhalb der
    // Grace-Period die Position trotzdem persistiert ist.
    const player = this.state.players.get(client.sessionId);
    if (player && player.identity && this.prismaForPresence) {
      const tenantSlug = (this.metadata as RoomMetadata)?.tenant
        || process.env.DEFAULT_TENANT_SLUG || 'default';
      const prisma = this.prismaForPresence;
      const { identity, x, y, direction, mapName } = player;

      prisma.tenant.findUnique({ where: { slug: tenantSlug } })
        .then((tenant) => {
          if (!tenant) return;
          return prisma.presence.updateMany({
            where: { userId: identity, tenantId: tenant.id },
            data: {
              x: Math.round(x), y: Math.round(y), direction,
              ...(mapName ? { mapName } : {}),
            },
          });
        })
        .catch((e) => logger.debug('[WorldRoom] Failed to persist position on leave', e));
    }

    // Idempotenz: falls bereits ein pending Leave für diese sid existiert, ersetzen.
    const prevTimer = this.pendingLeaves.get(client.sessionId);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this.pendingLeaves.delete(client.sessionId);
    }

    const sessionId = client.sessionId;
    const mapIdForLeave = player?.mapId;
    logger.info('[WorldRoom] Player leave queued (grace):', sessionId);

    const timer = setTimeout(() => {
      // Cleanup state + auxiliary maps
      this.state.players.delete(sessionId);
      this.lastSeen.delete(sessionId);
      this.pendingLeaves.delete(sessionId);
      try { colyseusPlayers.dec(); } catch (e) { logger.debug('[WorldRoom] Failed to decrement colyseusPlayers metric', e); }
      // Zone lock cleanup
      onPlayerLeaveZoneLock(this, this.zoneLockState, sessionId);
      // Symmetrie zu player_joined: Broadcast auf derselben Map (Fallback: global)
      if (mapIdForLeave) {
        this.broadcastToMap(mapIdForLeave, 'player_left', { id: sessionId });
      } else {
        this.broadcast('player_left', { id: sessionId });
      }
      // Spieler aus evtl. Bubble-Gruppen entfernen
      let changed = false;
      for (const [gid, members] of Object.entries(this.bubbleGroups)) {
        if (members.includes(sessionId)) {
          this.bubbleGroups[gid] = members.filter(m => m !== sessionId);
          changed = true;
        }
      }
      // Gruppen mit <2 Mitgliedern entfernen
      for (const [gid, members] of Object.entries(this.bubbleGroups)) {
        if (!Array.isArray(members) || members.length < 2) {
          delete this.bubbleGroups[gid];
          changed = true;
        }
      }
      if (changed) this.broadcastBubbleState();
      logger.info('[WorldRoom] Player left (graceful committed):', sessionId);
    }, WorldRoom.LEAVE_GRACE_MS);

    this.pendingLeaves.set(sessionId, timer);
  }

  override onDispose() {
    if (this.guestExpiryInterval) {
      clearInterval(this.guestExpiryInterval);
      this.guestExpiryInterval = null;
    }
    if (this.pendingCleanupInterval) {
      clearInterval(this.pendingCleanupInterval);
      this.pendingCleanupInterval = null;
    }
    // Alle pending Graceful-Leave-Timer abbrechen
    for (const timer of this.pendingLeaves.values()) {
      try { clearTimeout(timer); } catch { /* best-effort */ }
    }
    this.pendingLeaves.clear();
    this.lastSeen.clear();
    activeRooms.delete(this);
    try { colyseusRooms.dec(); } catch (e) { logger.debug('[WorldRoom] Failed to decrement colyseusRooms metric', e); }
    try { this.prismaForPresence && this.prismaForPresence.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
    logger.info('[WorldRoom] Room disposed');
  }
}

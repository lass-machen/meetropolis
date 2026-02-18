import { Room, type Client } from 'colyseus';
import { logger } from '../logger.js';
import { colyseusRooms, colyseusPlayers } from '../metrics.js';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { PrismaClient } from '../generated/prisma/index.js';
import { getTenancyModule, OSS_USER_LIMIT } from '../tenancyLoader.js';

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
  // Persist multiple bubble groups: groupId -> member sessionIds
  private bubbleGroups: Record<string, string[]> = {};
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
    const groups = Object.entries(this.bubbleGroups).map(([id, members]) => ({
      id,
      members: members.filter((m) => this.state.players.has(m)),
    })).filter(g => Array.isArray(g.members) && g.members.length >= 2);
    const members = this.getAllBubbleMembers();
    this.broadcast('bubble_state', { groups, members });
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

  override onCreate(options?: RoomOptions) {
    this.setState(new WorldState());
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
        const map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
        // Map-Metadaten cachen (für Bounds/Clamping)
        if (map) {
          try {
            // width/height in Tiles, tileWidth/tileHeight in Pixel
            this.mapWidthTiles = map.width ?? null;
            this.mapHeightTiles = map.height ?? null;
            this.tileWidthPx = map.tileWidth ?? null;
            this.tileHeightPx = map.tileHeight ?? null;
            // Also store in multi-map cache (keyed by mapId)
            const meta: MapMeta = (map.meta as MapMeta) || {};
            const sp = meta?.spawn;
            this.mapCache.set(map.id, {
              widthTiles: map.width ?? 32,
              heightTiles: map.height ?? 32,
              tileWidthPx: map.tileWidth ?? 16,
              tileHeightPx: map.tileHeight ?? 16,
              defaultSpawn: (sp && typeof sp.x === 'number' && typeof sp.y === 'number') ? { x: sp.x, y: sp.y } : null,
            });
          } catch (e) { logger.debug('[WorldRoom] Failed to cache map metadata', e); }
        }
        const meta = (map?.meta as MapMeta) || {};
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
      player.x = data.x;
      player.y = data.y;
      player.direction = data.direction;

      // Broadcast movement to all other clients
      this.broadcast('player_moved', {
        id: client.sessionId,
        x: data.x,
        y: data.y,
        direction: data.direction,
        mapId: player.mapId,
        mapName: player.mapName,
      }, { except: client });
    });


    // Handle editor updates
    this.onMessage('editor_update', (client, data: { type: string; [key: string]: unknown }) => {
      logger.debug('[WorldRoom] Editor update from:', client.sessionId, 'type:', data.type);
      // Broadcast editor update to all other clients
      this.broadcast('editor_update', data, { except: client });
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

      // Broadcast DND status to all other clients
      this.broadcast('player_dnd', {
        id: client.sessionId,
        dnd: data.dnd
      }, { except: client });
    });

    // Handle avatar change
    this.onMessage('avatar_change', (client, data: { avatarId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.avatarId = data.avatarId;
      this.broadcast('player_avatar', { id: client.sessionId, avatarId: data.avatarId }, { except: client });
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

    // Handle map change requests
    this.onMessage('change_map', async (client, data: { mapId: string }) => {
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
      const spawn = mapMeta?.defaultSpawn || {
        x: ((mapMeta?.widthTiles ?? 32) * (mapMeta?.tileWidthPx ?? 16)) / 2,
        y: ((mapMeta?.heightTiles ?? 32) * (mapMeta?.tileHeightPx ?? 16)) / 2,
      };
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

    // Subscribe to map updates via Presence (works across processes if Redis is used, or locally)
    try {
      const tenantSlug = options?.tenant || (this.metadata as RoomMetadata)?.tenant || 'default';
      this.presence.subscribe(`map_update:${tenantSlug}`, (message: { type: string; payload: unknown }) => {
        try {
          if (message.type === 'chunks_updated') {
            this.broadcast('chunks_updated', message.payload);
          } else if (message.type === 'tileset_registry_updated') {
            this.broadcast('tileset_registry_updated', message.payload);
          } else if (message.type === 'objects_updated') {
            this.broadcast('objects_updated', message.payload);
          } else if (message.type === 'editor_update') {
            this.broadcast('editor_update', message.payload);
          }
        } catch (e) {
          logger.error('[WorldRoom] Failed to handle presence map_update', e);
        }
      });
    } catch (e) {
      logger.error('[WorldRoom] Failed to subscribe to presence', e);
    }
  }

  // Editor-Updates können das Default-Spawn live setzen
  public setDefaultSpawn(pos: { x: number; y: number }) {
    const s = this.sanitizePosition(pos.x, pos.y);
    this.defaultSpawn = s;
    try { logger.info('[WorldRoom] Default spawn updated to:', s); } catch (e) { logger.debug('[WorldRoom] Failed to log default spawn update', e); }
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

      // Check subscription status - block if payment failed or subscription inactive
      if (tenant && !tenant.bypassLimits) {
        const status = tenant.status as string | undefined;

        // Trial expired - user needs to subscribe
        if (status === 'trial_expired') {
          try { logger.warn('[WorldRoom] Tenant trial expired', { tenant: tenantSlug, status }); } catch (e) { logger.debug('[WorldRoom] Failed to log trial expiry', e); }
          try { client.error(4005, 'trial_expired'); } catch (e) { logger.debug('[WorldRoom] Failed to send trial_expired error', e); }
          try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
          return client.leave(1000);
        }

        // Subscription suspended (dunning step 4+, after 7 days non-payment)
        if (status === 'suspended') {
          try { logger.warn('[WorldRoom] Tenant subscription suspended', { tenant: tenantSlug, status }); } catch (e) { logger.debug('[WorldRoom] Failed to log subscription suspension', e); }
          try { client.error(4004, 'subscription_suspended'); } catch (e) { logger.debug('[WorldRoom] Failed to send subscription_suspended error', e); }
          try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
          return client.leave(1000);
        }

        // Other inactive statuses (canceled, incomplete, etc.)
        // Note: past_due is NOT blocked - users retain access during dunning period
        const blockedStatuses = ['canceled', 'incomplete_expired', 'incomplete'];
        if (status && blockedStatuses.includes(status)) {
          try { logger.warn('[WorldRoom] Tenant subscription inactive', { tenant: tenantSlug, status }); } catch (e) { logger.debug('[WorldRoom] Failed to log subscription inactive', e); }
          try { client.error(4003, 'subscription_inactive'); } catch (e) { logger.debug('[WorldRoom] Failed to send subscription_inactive error', e); }
          try { await prisma.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
          return client.leave(1000);
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
    // Vor Anlage eines neuen Spielers: Duplikate anhand Identity bereinigen
    const joiningIdentity = options?.identity || client.sessionId;
    try {
      const toRemove: string[] = [];
      this.state.players.forEach((p, id) => {
        if (p.identity && p.identity === joiningIdentity) {
          toRemove.push(id);
        }
      });
      for (const oldId of toRemove) {
        this.state.players.delete(oldId);
        try { colyseusPlayers.dec(); } catch (e) { logger.debug('[WorldRoom] Failed to decrement colyseusPlayers metric', e); }
        // Andere Clients über Entfernen informieren (Geist-Avatare vermeiden)
        this.broadcast('player_left', { id: oldId });
      }
    } catch (e) { logger.debug('[WorldRoom] Failed to remove duplicate player', e); }

    // Sicherstellen, dass wir Map-Metadaten haben (Race gegen onCreate-Loader vermeiden)
    try {
      if (!this.mapWidthTiles || !this.mapHeightTiles || !this.tileWidthPx || !this.tileHeightPx || !this.defaultSpawn) {
        const prisma = new PrismaClient();
        const tenantSlug = options?.tenant || (this.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
        const tenantRec = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { defaultMapName: true } });
        const mapName = tenantRec?.defaultMapName || process.env.DEFAULT_MAP_NAME || 'office';
        const map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
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
            initialMapName = defaultMapName;
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
    player.name = options?.name || joiningIdentity; // Use provided name or fallback
    player.avatarId = options?.avatarId || 'default-characters:businessman1';
    player.isNpc = (joiningIdentity || '').startsWith('npc-');
    this.state.players.set(client.sessionId, player);
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
      } catch (e) { logger.debug('[WorldRoom] Failed to send full_state/bubble_state to client', e); }
    }, 25);

    // Broadcast new player to all other clients
    this.broadcast('player_joined', {
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
    }, { except: client });

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
    // Persist position + mapName before removing player (fire-and-forget)
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

    this.state.players.delete(client.sessionId);
    try { colyseusPlayers.dec(); } catch (e) { logger.debug('[WorldRoom] Failed to decrement colyseusPlayers metric', e); }
    logger.info('[WorldRoom] Player left:', client.sessionId);

    // Broadcast player left to all other clients
    this.broadcast('player_left', {
      id: client.sessionId
    });
    // Spieler aus evtl. Bubble-Gruppen entfernen
    let changed = false;
    for (const [gid, members] of Object.entries(this.bubbleGroups)) {
      if (members.includes(client.sessionId)) {
        this.bubbleGroups[gid] = members.filter(m => m !== client.sessionId);
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
  }

  override onDispose() {
    activeRooms.delete(this);
    try { colyseusRooms.dec(); } catch (e) { logger.debug('[WorldRoom] Failed to decrement colyseusRooms metric', e); }
    try { this.prismaForPresence && this.prismaForPresence.$disconnect().catch(() => { }); } catch (e) { logger.debug('[WorldRoom] Failed to disconnect prisma', e); }
    logger.info('[WorldRoom] Room disposed');
  }
}

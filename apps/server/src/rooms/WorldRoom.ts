import { Room, type Client } from 'colyseus';
import { logger } from '../logger.js';
import { colyseusRooms, colyseusPlayers } from '../metrics.js';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { PrismaClient } from '@prisma/client';
import { getTenancyModule, OSS_USER_LIMIT } from '../tenancyLoader.js';
class Player extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('string') direction: string = 'down';
  @type('string') identity: string = ''; // User's actual identity for LiveKit
  @type('string') name: string = ''; // User's display name
  @type('boolean') dnd: boolean = false; // Do Not Disturb status
}

class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

// Store all active rooms globally for API access
const activeRooms = new Set<WorldRoom>();

export class WorldRoom extends Room<WorldState> {
  private defaultSpawn: { x: number; y: number } | null = null;
  private prismaForPresence: PrismaClient | null = null;
  // Map-Metadaten (Pixel-Grenzen berechnen zu können)
  private mapWidthTiles: number | null = null;
  private mapHeightTiles: number | null = null;
  private tileWidthPx: number | null = null;
  private tileHeightPx: number | null = null;
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

  override onCreate(options?: any) {
    this.setState(new WorldState());
    logger.info('[WorldRoom] Room created with initial state');
    activeRooms.add(this);
    try { colyseusRooms.inc(); } catch { }

    // Make rooms accessible globally
    (global as any).activeWorldRooms = activeRooms;

    // Attach tenant metadata for filterBy and accounting
    try {
      const tenantSlug = (options && (options as any).tenant) || process.env.DEFAULT_TENANT_SLUG || 'default';
      this.setMetadata({ tenant: tenantSlug });
    } catch { }

    // Load default spawn and map meta from DB (best-effort)
    (async () => {
      try {
        const prisma = new PrismaClient();
        this.prismaForPresence = prisma;
        const mapName = process.env.DEFAULT_MAP_NAME || 'office';
        const tenantSlug = (options && (options as any).tenant) || process.env.DEFAULT_TENANT_SLUG || 'default';
        const map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
        // Map-Metadaten cachen (für Bounds/Clamping)
        if (map) {
          try {
            // width/height in Tiles, tileWidth/tileHeight in Pixel
            this.mapWidthTiles = (map as any).width ?? null;
            this.mapHeightTiles = (map as any).height ?? null;
            this.tileWidthPx = (map as any).tileWidth ?? null;
            this.tileHeightPx = (map as any).tileHeight ?? null;
          } catch { }
        }
        const meta: any = (map as any)?.meta || {};
        const sp = meta?.spawn;
        if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
          const clamped = this.sanitizePosition(sp.x, sp.y);
          this.defaultSpawn = clamped;
          logger.info('[WorldRoom] Loaded default spawn from DB:', this.defaultSpawn);
        }
      } catch (e: any) {
        try { logger.debug('[WorldRoom] Failed to load default spawn:', e?.message || String(e)); } catch { }
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
        direction: data.direction
      }, { except: client });
    });


    // Handle editor updates
    this.onMessage('editor_update', (client, data: any) => {
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

    // Handle remote control messages from API
    this.onMessage('remote_control', (client, data: any) => {
      logger.info('[WorldRoom] Remote control received for:', client.sessionId, 'data:', data);
      // Forward to the specific client
      client.send('remote_control', data);
    });

    // Bubble-Updates: Mehrere Gruppen unterstützen
    this.onMessage('bubble_update', (_client, data: { id?: string; members?: string[] }) => {
      const raw = Array.isArray(data?.members) ? data!.members! : [];
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

    // Subscribe to map updates via Presence (works across processes if Redis is used, or locally)
    try {
      const tenantSlug = (options && (options as any).tenant) || this.metadata?.tenant || 'default';
      this.presence.subscribe(`map_update:${tenantSlug}`, (message: any) => {
        try {
          if (message.type === 'chunks_updated') {
            this.broadcast('chunks_updated', message.payload);
          } else if (message.type === 'tileset_registry_updated') {
            this.broadcast('tileset_registry_updated', message.payload);
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
    try { logger.info('[WorldRoom] Default spawn updated to:', s); } catch { }
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

  override async onJoin(client: Client, options?: any) {
    // Check OSS user limit (25 concurrent users for self-hosted OSS)
    // Enterprise license holders bypass this limit via bypassOssLimit()
    try {
      const tenancyModule = await getTenancyModule();
      const hasEnterpriseLicense = tenancyModule.bypassOssLimit?.() ?? false;

      if (!hasEnterpriseLicense) {
        // Count all active users across ALL rooms (global OSS limit)
        let totalActive = 0;
        try {
          const rooms: any[] = Array.from(activeRooms.values());
          for (const r of rooms) {
            try { totalActive += (r.state?.players?.size) || 0; } catch { }
          }
        } catch { }

        if (totalActive >= OSS_USER_LIMIT) {
          try { logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT }); } catch { }
          try { client.error(4002, 'oss_limit_reached'); } catch { }
          return client.leave(1000);
        }
      }
    } catch { }

    // Enforce concurrent user limit per tenant (unless bypassed)
    try {
      const tenantSlug: string = (options?.tenant || this.metadata?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default');
      const prisma = new PrismaClient();
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

      // Check subscription status - block if payment failed or subscription inactive
      if (tenant && !tenant.bypassLimits) {
        const status = (tenant as any).status as string | undefined;

        // Trial expired - user needs to subscribe
        if (status === 'trial_expired') {
          try { logger.warn('[WorldRoom] Tenant trial expired', { tenant: tenantSlug, status }); } catch { }
          try { client.error(4005, 'trial_expired'); } catch { }
          try { await prisma.$disconnect().catch(() => { }); } catch { }
          return client.leave(1000);
        }

        // Subscription suspended (dunning step 4+, after 7 days non-payment)
        if (status === 'suspended') {
          try { logger.warn('[WorldRoom] Tenant subscription suspended', { tenant: tenantSlug, status }); } catch { }
          try { client.error(4004, 'subscription_suspended'); } catch { }
          try { await prisma.$disconnect().catch(() => { }); } catch { }
          return client.leave(1000);
        }

        // Other inactive statuses (canceled, incomplete, etc.)
        // Note: past_due is NOT blocked - users retain access during dunning period
        const blockedStatuses = ['canceled', 'incomplete_expired', 'incomplete'];
        if (status && blockedStatuses.includes(status)) {
          try { logger.warn('[WorldRoom] Tenant subscription inactive', { tenant: tenantSlug, status }); } catch { }
          try { client.error(4003, 'subscription_inactive'); } catch { }
          try { await prisma.$disconnect().catch(() => { }); } catch { }
          return client.leave(1000);
        }
      }

      if (tenant && !tenant.bypassLimits) {
        let active = 0;
        try {
          const rooms: any[] = Array.from(activeRooms.values());
          for (const r of rooms) {
            const meta = (r as any).metadata || {};
            if (meta && meta.tenant === tenantSlug) {
              try { active += (r.state?.players?.size) || 0; } catch { }
            }
          }
        } catch { }
        // Check OSS user limit (25 users max unless enterprise tenancy bypasses it)
        const tenancy = await getTenancyModule();
        const bypassOssLimit = tenancy.bypassOssLimit?.() ?? false;

        if (!bypassOssLimit) {
          // OSS mode: enforce hard 25-user limit across all tenants
          let totalActive = 0;
          try {
            const rooms: any[] = Array.from(activeRooms.values());
            for (const r of rooms) {
              try { totalActive += (r.state?.players?.size) || 0; } catch { }
            }
          } catch { }
          if (totalActive >= OSS_USER_LIMIT) {
            try { logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT }); } catch { }
            try { client.error(4002, 'oss_limit_reached'); } catch { }
            try { await prisma.$disconnect().catch(() => { }); } catch { }
            return client.leave(1000);
          }
        }

        // Enterprise mode: enforce per-tenant limit
        const paidSeats = Math.max(0, tenant.concurrentLimit || 0);
        const freeSeats = Math.max(0, (tenant as any).freeSeats || 0);
        const effectiveLimit = Math.max(paidSeats, freeSeats);
        if (active >= effectiveLimit) {
          try { logger.warn('[WorldRoom] Tenant limit reached', { tenant: tenantSlug, active, limit: effectiveLimit, paidSeats, freeSeats }); } catch { }
          try { client.error(4001, 'tenant_limit_reached'); } catch { }
          try { await prisma.$disconnect().catch(() => { }); } catch { }
          return client.leave(1000);
        }
      }
      try { await prisma.$disconnect().catch(() => { }); } catch { }
    } catch { }
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
        try { colyseusPlayers.dec(); } catch { }
        // Andere Clients über Entfernen informieren (Geist-Avatare vermeiden)
        this.broadcast('player_left', { id: oldId });
      }
    } catch { }

    // Sicherstellen, dass wir Map-Metadaten haben (Race gegen onCreate-Loader vermeiden)
    try {
      if (!this.mapWidthTiles || !this.mapHeightTiles || !this.tileWidthPx || !this.tileHeightPx || !this.defaultSpawn) {
        const prisma = new PrismaClient();
        const mapName = process.env.DEFAULT_MAP_NAME || 'office';
        const tenantSlug = (options?.tenant || this.metadata?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default');
        const map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
        try { await prisma.$disconnect().catch(() => { }); } catch { }
        if (map) {
          try {
            this.mapWidthTiles = (map as any).width ?? this.mapWidthTiles;
            this.mapHeightTiles = (map as any).height ?? this.mapHeightTiles;
            this.tileWidthPx = (map as any).tileWidth ?? this.tileWidthPx;
            this.tileHeightPx = (map as any).tileHeight ?? this.tileHeightPx;
          } catch { }
          const meta: any = (map as any).meta || {};
          const sp = meta?.spawn;
          if (!this.defaultSpawn && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
            this.defaultSpawn = this.sanitizePosition(sp.x, sp.y);
          }
        }
      }
    } catch { }

    const player = new Player();
    player.id = client.sessionId;
    // Robuste Positionswahl:
    // 1) Wenn Client Koordinaten liefert: validieren/klammern
    // 2) Sonst: Default-Spawn (aus DB), geklammert
    // 3) Sonst: Kartenmitte
    // 4) Notfalls: konservatives (200,200)
    let initial: { x: number; y: number } | null = null;
    if (options && typeof options.x === 'number' && typeof options.y === 'number') {
      initial = this.sanitizePosition(options.x, options.y);
    } else if (this.defaultSpawn) {
      initial = this.sanitizePosition(this.defaultSpawn.x, this.defaultSpawn.y);
    } else {
      initial = this.getMapCenter() ?? { x: 200, y: 200 };
    }
    player.x = initial.x;
    player.y = initial.y;
    player.direction = options?.direction || 'down';
    player.identity = joiningIdentity; // Use provided identity or fallback
    player.name = options?.name || joiningIdentity; // Use provided name or fallback
    this.state.players.set(client.sessionId, player);
    try { colyseusPlayers.inc(); } catch { }
    logger.info('[WorldRoom] Player joined:', client.sessionId, 'identity:', player.identity, 'name:', player.name, 'at', player.x, player.y);
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
            dnd: p.dnd
          }))
        });
        // Aktuellen Bubble-Status (mit Gruppen) mitschicken
        const groups = Object.entries(this.bubbleGroups).map(([id, members]) => ({
          id,
          members: members.filter((m) => this.state.players.has(m)),
        })).filter(g => Array.isArray(g.members) && g.members.length >= 2);
        const members = this.getAllBubbleMembers();
        client.send('bubble_state', { groups, members });
      } catch { }
    }, 25);

    // Broadcast new player to all other clients
    this.broadcast('player_joined', {
      id: client.sessionId,
      x: player.x,
      y: player.y,
      direction: player.direction,
      identity: player.identity,
      name: player.name,
      dnd: player.dnd
    }, { except: client });

    // Seed: recent presence list via WS (best-effort, tenant-scoped)
    // Now includes ALL tenant members, even those who never logged in
    try {
      const prisma = this.prismaForPresence ?? new PrismaClient();
      const tenantSlug: string = (options?.tenant || this.metadata?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default');
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
        } as any);

        // 3. Erstelle Map von userId -> Presence
        const presenceMap = new Map<string, any>();
        for (const p of recent) {
          presenceMap.set(p.userId, p);
        }

        // 4. Kombiniere: Alle Mitglieder mit ihren Presence-Daten (falls vorhanden)
        const out = memberships.map((m: any) => {
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

        try { client.send('presence_recent', out as any); } catch { }
      }
    } catch (e) {
      try { logger.debug('[WorldRoom] presence_recent seed failed', e as any); } catch { }
    }
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    try { colyseusPlayers.dec(); } catch { }
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
    try { colyseusRooms.dec(); } catch { }
    try { this.prismaForPresence && this.prismaForPresence.$disconnect().catch(() => { }); } catch { }
    logger.info('[WorldRoom] Room disposed');
  }
}

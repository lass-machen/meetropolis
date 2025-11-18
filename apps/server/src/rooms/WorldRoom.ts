import type { Client } from 'colyseus';
import Colyseus from 'colyseus';
import { logger } from '../logger.js';
import { colyseusRooms, colyseusPlayers } from '../metrics.js';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { PrismaClient } from '@prisma/client';
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

export class WorldRoom extends Colyseus.Room<WorldState> {
  private defaultSpawn: { x: number; y: number } | null = null;
  private prismaForPresence: PrismaClient | null = null;
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
    try { colyseusRooms.inc(); } catch {}
    
    // Make rooms accessible globally
    (global as any).activeWorldRooms = activeRooms;

    // Attach tenant metadata for filterBy and accounting
    try {
      const tenantSlug = (options && (options as any).tenant) || process.env.DEFAULT_TENANT_SLUG || 'default';
      this.setMetadata({ tenant: tenantSlug });
    } catch {}

    // Load default spawn from DB (best-effort)
    (async () => {
      try {
        const prisma = new PrismaClient();
        this.prismaForPresence = prisma;
        const mapName = process.env.DEFAULT_MAP_NAME || 'office';
        const tenantSlug = (options && (options as any).tenant) || process.env.DEFAULT_TENANT_SLUG || 'default';
        const map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
        const meta: any = (map as any)?.meta || {};
        const sp = meta?.spawn;
        if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
          this.defaultSpawn = { x: sp.x, y: sp.y };
          logger.info('[WorldRoom] Loaded default spawn from DB:', this.defaultSpawn);
        }
      } catch (e: any) {
        try { logger.debug('[WorldRoom] Failed to load default spawn:', e?.message || String(e)); } catch {}
      }
    })().catch(()=>{});
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
  }

  override async onJoin(client: Client, options?: any) {
    // Enforce concurrent user limit per tenant (unless bypassed)
    try {
      const tenantSlug: string = (options?.tenant || this.metadata?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default');
      const prisma = new PrismaClient();
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (tenant && !tenant.bypassLimits) {
        let active = 0;
        try {
          const rooms: any[] = Array.from(activeRooms.values());
          for (const r of rooms) {
            const meta = (r as any).metadata || {};
            if (meta && meta.tenant === tenantSlug) {
              try { active += (r.state?.players?.size) || 0; } catch {}
            }
          }
        } catch {}
        const paidSeats = Math.max(0, tenant.concurrentLimit || 0);
        const freeSeats = Math.max(0, (tenant as any).freeSeats || 0);
        const effectiveLimit = Math.max(paidSeats, freeSeats);
        if (active >= effectiveLimit) {
          try { logger.warn('[WorldRoom] Tenant limit reached', { tenant: tenantSlug, active, limit: effectiveLimit, paidSeats, freeSeats }); } catch {}
          try { client.error(4001, 'tenant_limit_reached'); } catch {}
          try { await prisma.$disconnect().catch(()=>{}); } catch {}
          return client.leave(1000);
        }
      }
      try { await prisma.$disconnect().catch(()=>{}); } catch {}
    } catch {}
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
        try { colyseusPlayers.dec(); } catch {}
        // Andere Clients über Entfernen informieren (Geist-Avatare vermeiden)
        this.broadcast('player_left', { id: oldId });
      }
    } catch {}

    const player = new Player();
    player.id = client.sessionId;
    // Use provided position, else default spawn (if configured), else random
    const spawnX = this.defaultSpawn?.x;
    const spawnY = this.defaultSpawn?.y;
    player.x = (options?.x !== undefined ? options.x : (spawnX !== undefined ? spawnX : (Math.floor(Math.random() * 200) + 100)));
    player.y = (options?.y !== undefined ? options.y : (spawnY !== undefined ? spawnY : (Math.floor(Math.random() * 200) + 100)));
    player.direction = options?.direction || 'down';
    player.identity = joiningIdentity; // Use provided identity or fallback
    player.name = options?.name || joiningIdentity; // Use provided name or fallback
    this.state.players.set(client.sessionId, player);
    try { colyseusPlayers.inc(); } catch {}
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
      } catch {}
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
    try {
      const prisma = this.prismaForPresence ?? new PrismaClient();
      const tenantSlug: string = (options?.tenant || this.metadata?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default');
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (tenant) {
        const recent = await prisma.presence.findMany({
          where: { tenantId: tenant.id },
          orderBy: { updatedAt: 'desc' },
          distinct: ['userId'],
          include: { user: { select: { id: true, email: true, name: true } }, room: { select: { name: true } } },
        } as any);
        const out = recent.map((p: any) => ({
          userId: p.userId,
          user: { id: p.user?.id, email: p.user?.email, name: p.user?.name },
          room: p.room?.name || 'world',
          x: p.x,
          y: p.y,
          direction: p.direction,
          updatedAt: p.updatedAt,
        }));
        try { client.send('presence_recent', out as any); } catch {}
      }
    } catch (e) {
      try { logger.debug('[WorldRoom] presence_recent seed failed', e as any); } catch {}
    }
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    try { colyseusPlayers.dec(); } catch {}
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
    try { colyseusRooms.dec(); } catch {}
    try { this.prismaForPresence && this.prismaForPresence.$disconnect().catch(()=>{}); } catch {}
    logger.info('[WorldRoom] Room disposed');
  }
}

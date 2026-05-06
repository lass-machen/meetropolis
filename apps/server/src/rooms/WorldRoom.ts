import { Room, type Client } from 'colyseus';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { logger } from '../logger.js';
import { colyseusRooms } from '../metrics.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { createPrismaClient } from '../db.js';
import {
  createZoneLockState,
  setupZoneLockHandlers,
  type ZoneLockState,
} from './handlers/zoneLockHandler.js';
import { broadcastToMap } from './utils/broadcastHelpers.js';
import { sanitizePositionForMap, type MapCacheEntry } from './utils/mapBoundsHelpers.js';
import { createMoveHandler, handleHeartbeat } from './handlers/playerHandlers.js';
import { handleDndStatus } from './handlers/dndHandler.js';
import { handleAvatarChange } from './handlers/avatarHandler.js';
import { handleEditorUpdate, subscribeMapUpdates } from './handlers/editorHandler.js';
import { handleBubbleUpdate } from './handlers/bubbleHandler.js';
import { handleChangeMap } from './handlers/mapSwitchHandler.js';
import { handleSessionTakeover, handleSessionTakeoverCancel } from './handlers/sessionHandlers.js';
import { performOnJoin, completePendingJoin } from './lifecycle/onJoin.js';
import { performOnLeave } from './lifecycle/onLeave.js';
import { startGuestExpiryInterval } from './lifecycle/guestExpiry.js';
import { loadInitialSpawn, startPendingCleanupInterval } from './lifecycle/onCreateSetup.js';

export interface RoomOptions {
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

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

export interface PendingClient {
  client: Client;
  options: RoomOptions;
  identity: string;
  timestamp: number;
}

export class Player extends Schema {
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

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

// Store all active rooms globally for API access
const activeRooms = new Set<WorldRoom>();

export class WorldRoom extends Room<{ state: WorldState }> {
  // Map metadata (room-level, used for bounds clamping)
  public defaultSpawn: { x: number; y: number } | null = null;
  public prismaForPresence: PrismaClient | null = null;
  public mapWidthTiles: number | null = null;
  public mapHeightTiles: number | null = null;
  public tileWidthPx: number | null = null;
  public tileHeightPx: number | null = null;
  // Multi-map cache (keyed by mapId)
  public mapCache: Map<string, MapCacheEntry> = new Map();
  // Bubble groups: groupId -> member sessionIds
  public bubbleGroups: Record<string, string[]> = {};
  // Zone lock state (separate module)
  public zoneLockState: ZoneLockState = createZoneLockState();
  // Two-Phase Join: pending clients waiting on session_takeover decision
  public pendingClients: Map<string, PendingClient> = new Map();
  // Session-Hygiene: letzte Aktivität je sessionId (server-only, no schema broadcast)
  public lastSeen: Map<string, number> = new Map();
  // Graceful-Leave: pending delete-Timer pro sessionId, fuer Reconnect-Heal
  public pendingLeaves: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Tunables (env-overridable). Exposed as instance fields so helpers
  // can access them without re-reading process.env.
  public readonly ghostThresholdMs: number = Number(process.env.GHOST_THRESHOLD_MS ?? 60_000);
  public readonly leaveGraceMs: number = Number(process.env.LEAVE_GRACE_MS ?? 300);
  private static readonly PENDING_TIMEOUT_MS = 30_000;

  // Periodic intervals
  private guestExpiryInterval: ReturnType<typeof setInterval> | null = null;
  private pendingCleanupInterval: ReturnType<typeof setInterval> | null = null;

  override onCreate(options?: RoomOptions): void {
    this.setState(new WorldState());
    // Room is auto-disposed when empty (Colyseus default; explicit for clarity)
    this.autoDispose = true;
    // Flooding-Schutz: harter Client-Deckel pro Room (env override möglich)
    this.maxClients = Number(process.env.MAX_CLIENTS_PER_ROOM ?? 200);
    logger.info('[WorldRoom] Room created with initial state');
    activeRooms.add(this);
    try { colyseusRooms.inc(); } catch (e) { logger.debug('[WorldRoom] Failed to increment colyseusRooms metric', e); }

    // Make rooms accessible globally
    (global as Record<string, unknown>).activeWorldRooms = activeRooms;

    // Attach tenant metadata for filterBy and accounting
    const tenantSlug = options?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    try {
      this.setMetadata({ tenant: tenantSlug });
    } catch (e) { logger.debug('[WorldRoom] Failed to set metadata', e); }

    // Load default spawn and map metadata from DB (best-effort, fire-and-forget)
    loadInitialSpawn(this, tenantSlug).catch(() => { /* logged inside */ });

    // Player movement + heartbeat
    this.onMessage('move', createMoveHandler(this));
    this.onMessage('heartbeat', (client) => handleHeartbeat(this, client));

    // Editor updates (live geometry/zone changes)
    this.onMessage('editor_update', (client, data: { type: string; [key: string]: unknown }) =>
      handleEditorUpdate(this, client, data));

    // DND
    this.onMessage('dnd_status', (client, data: { dnd: boolean }) =>
      handleDndStatus(this, client, data));

    // Avatar change
    this.onMessage('avatar_change', (client, data: { avatarId: string }) =>
      handleAvatarChange(this, client, data));

    // Remote control (forwarded to specific client)
    this.onMessage('remote_control', (client, data: Record<string, unknown>) => {
      logger.info('[WorldRoom] Remote control received for:', client.sessionId, 'data:', data);
      client.send('remote_control', data);
    });

    // Bubble groups
    this.onMessage('bubble_update', (_client, data: { id?: string; members?: string[] }) =>
      handleBubbleUpdate(this, data));

    // NPC command (no-op: NPC service listens to broadcasts from API)
    this.onMessage('npc_command', () => { /* no-op */ });

    // Map change
    this.onMessage('change_map', (client, data: { mapId: string; spawnX?: number; spawnY?: number }) =>
      handleChangeMap(this, client, data));

    // Session takeover (Two-Phase Join)
    this.onMessage('session_takeover', (client, data?: { identity?: string }) =>
      handleSessionTakeover(this, activeRooms, client, data));
    this.onMessage('session_takeover_cancel', (client) => handleSessionTakeoverCancel(this, client));

    // Periodic: guest expiry + pending cleanup
    this.guestExpiryInterval = startGuestExpiryInterval(this);
    this.pendingCleanupInterval = startPendingCleanupInterval(this, WorldRoom.PENDING_TIMEOUT_MS);

    // Subscribe to map updates via Presence (cross-process via Redis, or local)
    const tenantSlugForPresence = options?.tenant || (this.metadata as RoomMetadata)?.tenant || 'default';
    subscribeMapUpdates(this, tenantSlugForPresence);

    // Setup zone lock handlers
    setupZoneLockHandlers(this, this.zoneLockState, this.prismaForPresence ?? createPrismaClient());
  }

  // Editor-Updates können das Default-Spawn live setzen.
  // Public API used by api/utils/broadcast.ts (see types/global.d.ts).
  public setDefaultSpawn(mapId: string, pos: { x: number; y: number }): void {
    const s = sanitizePositionForMap(this, pos.x, pos.y, mapId);
    this.defaultSpawn = s;
    const cached = this.mapCache.get(mapId);
    if (cached) {
      cached.defaultSpawn = s;
    }
    try { logger.info('[WorldRoom] Default spawn updated for map', mapId, 'to:', s); } catch (e) { logger.debug('[WorldRoom] Failed to log default spawn update', e); }
  }

  // Map-scoped broadcast. Public so handlers/lifecycle modules can call
  // it without going through the helper import — used externally e.g.
  // by `setupZoneLockHandlers` indirectly. Implementation lives in
  // utils/broadcastHelpers.ts.
  public broadcastToMap(mapId: string, event: string, data: unknown, except?: Client): void {
    broadcastToMap(this, mapId, event, data, except);
  }

  // External entry point used by handlers/sessionHandlers.ts to finish
  // a previously-pending join after a confirmed takeover.
  public completePendingJoin(client: Client, options: RoomOptions, joiningIdentity: string): Promise<void> {
    return completePendingJoin(this, client, options, joiningIdentity, Player);
  }

  override async onJoin(client: Client, options?: RoomOptions): Promise<void> {
    await performOnJoin(this, activeRooms, client, options, Player);
  }

  override onLeave(client: Client, code?: number): void {
    performOnLeave(this, client, code);
  }

  override onDispose(): void {
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

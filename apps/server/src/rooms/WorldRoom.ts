import { Room, type Client, type AuthContext } from 'colyseus';
import { Schema, type, view, MapSchema } from '@colyseus/schema';
import { logger } from '../logger.js';
import { colyseusRooms } from '../metrics.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { createPrismaClient } from '../db.js';
import { createZoneLockState, setupZoneLockHandlers, type ZoneLockState } from './handlers/zoneLockHandler.js';
import {
  createAudioZoneRuntime,
  startAudioZoneRuntime,
  stopAudioZoneRuntime,
  type AudioZoneRuntime,
} from './audioZones/runtime.js';
import { broadcastToMap } from './utils/broadcastHelpers.js';
import { sanitizePositionForMap, type MapCacheEntry } from './utils/mapBoundsHelpers.js';
import { createMoveHandler, handleHeartbeat } from './handlers/playerHandlers.js';
import { handleDndStatus } from './handlers/dndHandler.js';
import { handleAvatarChange } from './handlers/avatarHandler.js';
import { handleEditorUpdate, subscribeMapUpdates } from './handlers/editorHandler.js';
import { handleBubbleUpdate } from './handlers/bubbleHandler.js';
import { handleChangeMap } from './handlers/mapSwitchHandler.js';
import { performOnJoin } from './lifecycle/onJoin.js';
import { performOnLeave } from './lifecycle/onLeave.js';
import { startGuestExpiryInterval } from './lifecycle/guestExpiry.js';
import { loadInitialSpawn } from './lifecycle/onCreateSetup.js';
import { authenticateWorldJoin, type WorldAuth } from './lifecycle/onAuth.js';

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
  // Client-supplied Do-Not-Disturb state, re-asserted on every (re-)join so
  // the server's in-memory Player.dnd survives reconnects, restarts and
  // session takeovers. Applied in completePendingJoin before the initial
  // broadcast; only a literal boolean `true` enables DND (see there).
  dnd?: boolean;
  // H4 hardening: shared-secret presented by npc-service in lieu of a user
  // JWT (see rooms/lifecycle/onAuth.ts authenticateNpc). Never trusted from
  // a browser/native client.
  serviceToken?: string;
  // H4 hardening: client zone-privacy protocol version, checked against
  // MIN_ZONE_PRIVACY_CLIENT_VERSION in onAuth.ts. Absent/too-low is treated
  // as too old (fail-closed rollout: ship the client field before raising
  // the server minimum).
  zonePrivacyVersion?: number;
}

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
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
  // `@view()` makes the players map per-client filtered (Colyseus StateView):
  // a Player entry is only encoded for a client whose `client.view` has it
  // added (see rooms/lifecycle/tenantView.ts). This closes a cross-tenant PII
  // leak in the shared apex/'default' room, where two tenants share one
  // WorldRoom instance — without it, Colyseus auto-syncs every Player (identity
  // = userId, name = email when no display name, x/y) to ALL clients in the
  // room. The filter is server-side and transparent to the client SDK, so it
  // does not depend on any client rollout or feature flag. IMPORTANT: because
  // the field is view-tagged, a client with NO view set receives NO players —
  // every join MUST populate `client.view` (done in completePendingJoin).
  @view() @type({ map: Player }) players = new MapSchema<Player>();
}

// Store all active rooms globally for API access
const activeRooms = new Set<WorldRoom>();

// Read-only accessor for modules that need to see every active room (e.g.
// the H4 audio-zone reconciler, which must aggregate island membership
// across all WorldRoom shards backing a tenant).
export function getActiveWorldRooms(): ReadonlySet<WorldRoom> {
  return activeRooms;
}

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
  // H4: audio-zone island membership + LiveKit allow-list enforcement
  // (separate module tree, see rooms/audioZones/).
  public audioZones: AudioZoneRuntime = createAudioZoneRuntime();
  // Session hygiene: last activity per sessionId (server-only, no schema broadcast).
  public lastSeen: Map<string, number> = new Map();
  // Per-session tenant visibility key (JWT-verified tenantId, or a sentinel for
  // token-less/NPC joins). Drives the per-client StateView filter on
  // `WorldState.players` and the manual full_state scoping (tenantView.ts), so a
  // client only ever sees players of its own authenticated tenant even when two
  // tenants share this room instance. Server-only, never broadcast.
  public playerTenantKey: Map<string, string> = new Map();
  // Graceful leave: pending delete timer per sessionId, used for reconnect healing.
  public pendingLeaves: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Tunables (env-overridable). Exposed as instance fields so helpers
  // can access them without re-reading process.env.
  public readonly ghostThresholdMs: number = Number(process.env.GHOST_THRESHOLD_MS ?? 60_000);
  public readonly leaveGraceMs: number = Number(process.env.LEAVE_GRACE_MS ?? 300);

  // Periodic intervals
  private guestExpiryInterval: ReturnType<typeof setInterval> | null = null;

  override onCreate(options?: RoomOptions): void {
    this.setState(new WorldState());
    // Room is auto-disposed when empty (Colyseus default; explicit for clarity)
    this.autoDispose = true;
    // Flood protection: hard client cap per room (env-overridable).
    this.maxClients = Number(process.env.MAX_CLIENTS_PER_ROOM ?? 200);
    logger.info('[WorldRoom] Room created with initial state');
    activeRooms.add(this);
    try {
      colyseusRooms.inc();
    } catch (e) {
      logger.debug('[WorldRoom] Failed to increment colyseusRooms metric', e);
    }

    // Make rooms accessible globally
    (global as Record<string, unknown>).activeWorldRooms = activeRooms;

    // Attach tenant metadata for filterBy and accounting
    const tenantSlug = options?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    try {
      void this.setMetadata({ tenant: tenantSlug });
    } catch (e) {
      logger.debug('[WorldRoom] Failed to set metadata', e);
    }

    // Load default spawn and map metadata from DB (best-effort, fire-and-forget)
    loadInitialSpawn(this, tenantSlug).catch(() => {
      /* logged inside */
    });

    // Player movement + heartbeat
    this.onMessage('move', createMoveHandler(this));
    this.onMessage('heartbeat', (client) => handleHeartbeat(this, client));

    // Editor updates (live geometry/zone changes)
    this.onMessage('editor_update', (client, data: { type: string; [key: string]: unknown }) =>
      handleEditorUpdate(this, client, data),
    );

    // DND
    this.onMessage('dnd_status', (client, data: { dnd: boolean }) => handleDndStatus(this, client, data));

    // Avatar change
    this.onMessage('avatar_change', (client, data: { avatarId: string }) => handleAvatarChange(this, client, data));

    // Remote control (forwarded to specific client)
    this.onMessage('remote_control', (client, data: Record<string, unknown>) => {
      logger.info('[WorldRoom] Remote control received for:', client.sessionId, 'data:', data);
      client.send('remote_control', data);
    });

    // Bubble groups
    this.onMessage('bubble_update', (_client, data: { id?: string; members?: string[] }) =>
      handleBubbleUpdate(this, data),
    );

    // NPC command (no-op: NPC service listens to broadcasts from API)
    this.onMessage('npc_command', () => {
      /* no-op */
    });

    // Map change
    this.onMessage('change_map', (client, data: { mapId: string; spawnX?: number; spawnY?: number }) => {
      void handleChangeMap(this, client, data);
    });

    // Periodic: guest expiry
    this.guestExpiryInterval = startGuestExpiryInterval(this);

    // Subscribe to map updates via Presence (cross-process via Redis, or local)
    const tenantSlugForPresence = options?.tenant || (this.metadata as RoomMetadata)?.tenant || 'default';
    subscribeMapUpdates(this, tenantSlugForPresence);

    // Setup zone lock handlers
    setupZoneLockHandlers(this, this.zoneLockState, this.prismaForPresence ?? createPrismaClient());

    // H4: start the audio-zone drift-correction reconciler.
    startAudioZoneRuntime(this);
  }

  // Editor updates can set the default spawn live.
  // Public API used by api/utils/broadcast.ts (see types/global.d.ts).
  public setDefaultSpawn(mapId: string, pos: { x: number; y: number }): void {
    const s = sanitizePositionForMap(this, pos.x, pos.y, mapId);
    this.defaultSpawn = s;
    const cached = this.mapCache.get(mapId);
    if (cached) {
      cached.defaultSpawn = s;
    }
    try {
      logger.info('[WorldRoom] Default spawn updated for map', mapId, 'to:', s);
    } catch (e) {
      logger.debug('[WorldRoom] Failed to log default spawn update', e);
    }
  }

  // Map-scoped broadcast. Public so handlers/lifecycle modules can call
  // it without going through the helper import, used externally for
  // example by `setupZoneLockHandlers` indirectly. Implementation lives
  // in utils/broadcastHelpers.ts.
  public broadcastToMap(mapId: string, event: string, data: unknown, except?: Client): void {
    broadcastToMap(this, mapId, event, data, except);
  }

  // H4 hardening: authoritative identity binding + client zone-privacy
  // version gate. Runs before onJoin (Colyseus attaches the return value
  // to client.auth); see lifecycle/onAuth.ts for the fail-closed rules.
  // NOTE: this must stay an ESM-imported `Room` (see the CJS/ESM note in
  // index.ts) for Colyseus to honor an instance-level onAuth at all.
  override async onAuth(_client: Client, options: RoomOptions | undefined, context: AuthContext): Promise<WorldAuth> {
    return authenticateWorldJoin(options, context, this.prismaForPresence ?? createPrismaClient());
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
    // Alle pending Graceful-Leave-Timer abbrechen
    for (const timer of this.pendingLeaves.values()) {
      try {
        clearTimeout(timer);
      } catch {
        /* best-effort */
      }
    }
    this.pendingLeaves.clear();
    this.lastSeen.clear();
    this.playerTenantKey.clear();
    stopAudioZoneRuntime(this);
    activeRooms.delete(this);
    try {
      colyseusRooms.dec();
    } catch (e) {
      logger.debug('[WorldRoom] Failed to decrement colyseusRooms metric', e);
    }
    try {
      if (this.prismaForPresence) {
        void this.prismaForPresence.$disconnect().catch(() => {
          /* silent: disposal */
        });
      }
    } catch (e) {
      logger.debug('[WorldRoom] Failed to disconnect prisma', e);
    }
    logger.info('[WorldRoom] Room disposed');
  }
}

import { Client, type Room } from '@colyseus/sdk';
import { logger } from '../logger.js';
import type { MobilePlayer, MobileServerEvent } from './protocol.js';

/**
 * One Colyseus world-room connection on behalf of one mobile client.
 *
 * The gateway joins the room as the user, not as a service: the caller passes
 * the user's own JWT and it travels on `client.auth.token`, which the SDK
 * turns into the `_authToken` query parameter of the WS handshake — the exact
 * path `rooms/lifecycle/onAuth.ts` reads first (before the cookie). The
 * mobile user therefore appears to every desktop client as an ordinary
 * player, and every tenancy and zone rule applies to them unchanged.
 *
 * Modelled on `apps/npc-service/src/bot/colyseusClient.ts`, which already
 * does programmatic room joins from Node. The difference: NPCs authenticate
 * with a shared service secret and are exempt from the zone-privacy gate,
 * while a mobile user is a real account and is not.
 */

/** Mirrors the world room's `Player` schema fields the mini mode consumes. */
interface PlayerLike {
  identity?: string;
  name?: string;
  x?: number;
  y?: number;
  dnd?: boolean;
  avatarId?: string;
  isNpc?: boolean;
  mapId?: string;
  mapName?: string;
}

interface WorldStateLike {
  players?: { forEach: (cb: (value: PlayerLike, key: string) => void) => void };
}

export interface WorldBridgeOptions {
  /** Base URL of our own HTTP server, e.g. `http://127.0.0.1:2567`. */
  serverUrl: string;
  /** The mobile user's raw JWT, forwarded to the room's auth gate. */
  authToken: string;
  tenantSlug?: string;
  /**
   * Zone-privacy protocol version claimed by the app. Passed through
   * untouched: the gateway must not vouch for a client contract it does not
   * implement itself. A stale or missing value makes `onAuth` reject the
   * join, which is the intended behaviour.
   */
  zonePrivacyVersion: number;
  /** Called for every event that should reach the app. */
  emit: (event: MobileServerEvent) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;

export class WorldBridge {
  private readonly client: Client;
  private room: Room | null = null;
  private alive = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: WorldBridgeOptions) {
    const wsUrl = options.serverUrl.replace(/^http(s?):\/\//, 'ws$1://');
    this.client = new Client(wsUrl);
    // Recognised by onAuth.ts ahead of the cookie; a Node client has no
    // cookie jar, so this is the only channel that carries the identity.
    this.client.auth.token = options.authToken;
  }

  async connect(): Promise<void> {
    this.alive = true;
    this.room = await this.client.joinOrCreate('world', {
      tenant: this.options.tenantSlug,
      zonePrivacyVersion: this.options.zonePrivacyVersion,
    });
    this.reconnectAttempts = 0;
    this.attachListeners();
  }

  private attachListeners(): void {
    const room = this.room;
    if (!room) return;

    room.onStateChange((state: WorldStateLike) => {
      try {
        this.options.emit({ type: 'roster', players: collectPlayers(state) });
      } catch (err) {
        logger.warn({ err }, '[mobile] roster projection failed');
      }
    });

    // Forwarded verbatim — the app applies them to its own LiveKit session.
    room.onMessage('av_zone_permissions', (data: { islandId: string; allow: string[] }) => {
      this.options.emit({ type: 'zone_permissions', islandId: data.islandId, allow: data.allow ?? [] });
    });
    room.onMessage('map_changed', (data: { mapId: string; mapName?: string }) => {
      this.options.emit({ type: 'map_changed', mapId: data.mapId, mapName: data.mapName ?? '' });
    });
    room.onMessage('zone_access_denied', (data: { zoneId: string; reason?: string }) => {
      this.options.emit({ type: 'zone_access_denied', zoneId: data.zoneId, reason: data.reason });
    });
    room.onMessage('zone_lock_state', (data: { zoneId: string; locked: boolean }) => {
      this.options.emit({ type: 'zone_lock_state', zoneId: data.zoneId, locked: Boolean(data.locked) });
    });
    room.onMessage(
      'presence_recent',
      (data: { entries?: Array<{ identity: string; name?: string; lastSeen?: string }> }) => {
        this.options.emit({ type: 'presence_recent', entries: data.entries ?? [] });
      },
    );

    // Deliberately NOT forwarded: `bubble_state` (a world-canvas mechanic the
    // mini mode does not render), `remote_control` (desktop screen control),
    // `change_map_error` (covered by the app's own request handling) and
    // `full_state` (the first onStateChange already carries the full roster,
    // so forwarding both would just duplicate the frame).

    room.onError((code, message) => {
      logger.warn({ code, message }, '[mobile] world room error');
      this.options.emit({ type: 'error', message: message ?? 'world_room_error' });
    });

    room.onLeave((code) => {
      this.room = null;
      if (!this.alive) return;
      // 1000 is a clean close; anything else is worth retrying.
      if (code === 1000) {
        this.options.emit({ type: 'disconnected', code, reason: 'room_closed' });
        return;
      }
      this.scheduleReconnect(code);
    });
  }

  private scheduleReconnect(code: number): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.options.emit({ type: 'disconnected', code, reason: 'reconnect_exhausted' });
      return;
    }
    const delay = Math.min(15_000, RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      void (async () => {
        if (!this.alive) return;
        try {
          await this.connect();
        } catch (err) {
          logger.warn({ err, attempt: this.reconnectAttempts }, '[mobile] world reconnect failed');
          this.scheduleReconnect(code);
        }
      })();
    }, delay);
  }

  /** Fire-and-forget towards the world room. Silent when disconnected. */
  send(type: string, payload?: Record<string, unknown>): void {
    try {
      this.room?.send(type, payload);
    } catch (err) {
      logger.debug({ err, type }, '[mobile] send on closed room');
    }
  }

  async dispose(): Promise<void> {
    this.alive = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      await this.room?.leave();
    } catch {
      /* already gone */
    }
    this.room = null;
  }
}

/** Project the schema state onto the flat shape the app consumes. */
export function collectPlayers(state: WorldStateLike): MobilePlayer[] {
  const players: MobilePlayer[] = [];
  state.players?.forEach((value, key) => {
    players.push({
      id: key,
      identity: value.identity ?? key,
      name: value.name ?? '',
      x: value.x ?? 0,
      y: value.y ?? 0,
      dnd: Boolean(value.dnd),
      avatarId: value.avatarId ?? '',
      isNpc: Boolean(value.isNpc),
      mapId: value.mapId ?? '',
      mapName: value.mapName ?? '',
    });
  });
  return players;
}

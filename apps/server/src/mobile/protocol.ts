import { z } from 'zod';

/**
 * Wire contract between the native mobile clients and the mobile gateway.
 *
 * Why this exists at all: the world state is a Colyseus room with binary
 * schema serialisation and server-side `@view()` filtering (see
 * rooms/WorldRoom.ts). There is no official Colyseus SDK for Swift, and
 * reimplementing the wire format — including the view filter — in a second
 * language is a large, security-sensitive surface we do not want to own. The
 * gateway therefore terminates Colyseus on the server and speaks plain JSON
 * outwards.
 *
 * Transport is Server-Sent Events downstream plus ordinary POSTs upstream,
 * NOT a WebSocket. The Colyseus `WebSocketTransport` shares the HTTP server
 * (index.ts) and its underlying `ws` server claims every upgrade — `ws`
 * decides via `shouldHandle()`, which only filters when a `path` option is
 * set, and Colyseus sets none. A second WebSocket server alongside it would
 * require either forcing a path onto Colyseus (breaking every existing
 * client's connect URL) or reaching around its upgrade handler. SSE avoids
 * the collision entirely and inherits session auth, CORS and rate limiting
 * from the normal Express pipeline.
 *
 * This module is the single source of truth for both directions. Keep the
 * event names aligned with the Colyseus message names they carry, so a
 * reader can follow one term across both protocols.
 */

/** Bumped when a change would break an already-shipped mobile client. */
export const MOBILE_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- downstream

/** A participant as the mini mode needs them: presence, not world geometry. */
export interface MobilePlayer {
  /** Colyseus session id — the key inside `state.players`. */
  id: string;
  /** LiveKit identity. This is what the app matches its audio tracks against. */
  identity: string;
  name: string;
  x: number;
  y: number;
  dnd: boolean;
  avatarId: string;
  isNpc: boolean;
  mapId: string;
  mapName: string;
}

/**
 * Events pushed to the app. `type` is the discriminator; every payload is
 * self-contained so a client that missed an event still converges on the
 * next `roster` push.
 */
export type MobileServerEvent =
  /** First frame after connect. Carries the ids the client needs to talk back. */
  | { type: 'session'; sessionId: string; protocolVersion: number; identity: string }
  /** Full roster. Sent once after the world join and on every resync. */
  | { type: 'roster'; players: MobilePlayer[] }
  /**
   * Audio-zone allow list, forwarded verbatim from the world room. The app
   * MUST apply this to its own LiveKit connection via
   * `setTrackSubscriptionPermissions`; the gateway cannot do it on the
   * client's behalf, because LiveKit only lets a publisher restrict its own
   * tracks. See rooms/audioZones/reconciler.ts.
   */
  | { type: 'zone_permissions'; islandId: string; allow: string[] }
  | { type: 'map_changed'; mapId: string; mapName: string }
  | { type: 'zone_access_denied'; zoneId: string; reason?: string }
  | { type: 'zone_lock_state'; zoneId: string; locked: boolean }
  /**
   * Recently-seen users, forwarded from the world room. Lets the roster show
   * "was here 10 minutes ago" instead of only the currently connected set.
   */
  | { type: 'presence_recent'; entries: Array<{ identity: string; name?: string; lastSeen?: string }> }
  /** The world room went away or refused us. The app should stop and re-auth. */
  | { type: 'disconnected'; code?: number; reason: string }
  | { type: 'error'; message: string };

// ------------------------------------------------------------------ upstream

/**
 * Actions the app may send. Deliberately a subset of the world room's
 * `onMessage` handlers: only what the mini mode can actually trigger. Editor
 * updates, NPC commands and remote control stay out — a phone has no UI for
 * them, and forwarding them would widen the attack surface for free.
 */
export const mobileActionSchema = z.discriminatedUnion('type', [
  /**
   * Position change. The mini mode has no map canvas, so this is not
   * continuous walking but a jump to a zone anchor the user tapped.
   */
  z.object({
    type: z.literal('move'),
    x: z.number().finite(),
    y: z.number().finite(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  }),
  z.object({ type: z.literal('dnd'), dnd: z.boolean() }),
  z.object({ type: z.literal('avatar'), avatarId: z.string().min(1).max(200) }),
  z.object({ type: z.literal('change_map'), mapId: z.string().min(1).max(200) }),
  z.object({ type: z.literal('heartbeat') }),
]);

export type MobileAction = z.infer<typeof mobileActionSchema>;

/**
 * Codepoints that `JSON.stringify` leaves raw but that break a line-oriented
 * reader: U+0085 (NEL), U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH
 * SEPARATOR). `\n` and `\r` are escaped by `JSON.stringify` itself, these
 * three are not — and Unicode line breaking treats all of them as line
 * terminators, so a display name containing one of them would split an SSE
 * frame in two and take out every subsequent frame for that client.
 */
const RAW_LINE_TERMINATORS = /[\u0085\u2028\u2029]/g;

/** Serialise one event as an SSE frame. */
export function encodeSseEvent(event: MobileServerEvent): string {
  const json = JSON.stringify(event).replace(
    RAW_LINE_TERMINATORS,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `data: ${json}\n\n`;
}

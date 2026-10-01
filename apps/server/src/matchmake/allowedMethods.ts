import { ServerError } from 'colyseus';

/**
 * The matchmake methods a client may call over HTTP (`POST /matchmake/<method>/<room>`).
 *
 * Colyseus exposes five (`joinOrCreate`, `create`, `join`, `joinById`,
 * `reconnect`); the clients of this repo call exactly one, so only that one
 * stays open:
 *  - `joinOrCreate`: web (`apps/web/src/lib/colyseus.ts`, `joinWorld`), mobile
 *    bridge (`apps/server/src/mobile/worldBridge.ts`, `connect`), NPC service
 *    (`apps/npc-service/src/bot/colyseusClient.ts`, `joinWithRetry`), loadtest
 *    (`apps/loadtest/src/workers/colyseusBot.ts`). After a dropped connection
 *    the web client (`useColyseusConnection`), the mobile bridge
 *    (`scheduleReconnect`, then `connect()`) and the NPC service
 *    (`scheduleReconnect`, then `joinWithRetry`) join again through this same
 *    method. The SDK's own automatic reconnection re-opens the WebSocket with
 *    the reconnection token and does not touch this route.
 *  - `create` builds a fresh room on every call, whatever tenant it names, so
 *    an anonymous caller could keep building rooms with the (always valid)
 *    default tenant or none at all. Nothing in the repo calls it.
 *  - `join` / `joinById` / `reconnect` are not called by any client either.
 *    `reconnect` would need `allowReconnection` on the room, which WorldRoom
 *    does not use. Open one of them here only together with the client that
 *    needs it.
 *
 * The check is by method alone: for `joinById` and `reconnect` the room slot of
 * the URL carries a room id, not the room name.
 */
export const ALLOWED_MATCHMAKE_METHODS: readonly string[] = ['joinOrCreate'];

/** Refuse a matchmake method no client uses, before anything is looked up or built. */
export function assertAllowedMatchmakeMethod(method: unknown): void {
  if (typeof method === 'string' && ALLOWED_MATCHMAKE_METHODS.includes(method)) return;
  throw new ServerError(400, 'invalid_method');
}

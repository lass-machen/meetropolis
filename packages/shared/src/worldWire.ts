/**
 * Wire protocol version of the Colyseus `world` connection.
 *
 * Every Colyseus client (web, desktop, the mobile bridge, npc-service, the
 * load test) reports it as `wireProtocolVersion` in its join options, and the
 * server refuses a join without it, or with a lower one, with 4426
 * `client_too_old` before any state is sent (apps/server/src/rooms/lifecycle/
 * onAuth.ts). Server and clients import this file so the number lives in one
 * place.
 *
 * It is independent of ZONE_PRIVACY_PROTOCOL_VERSION: that one versions the
 * audio-zone privacy contract and is also checked by the LiveKit token route
 * and the mobile stream route, this one only versions the bytes on the
 * Colyseus socket. Raise it when the wire protocol breaks (a Colyseus or
 * @colyseus/schema major that an older client cannot decode), never for a
 * change in what the messages mean.
 *
 * Versions:
 *   1  Colyseus 0.17 / @colyseus/schema 4. Clients of this generation send no
 *      wire version at all, which the server reads as "older than 2".
 *   2  Colyseus 0.18 / @colyseus/schema 5. The JOIN_ROOM frame carries a length
 *      prefix before the state reflection that a 0.17 client cannot decode.
 */
export const WORLD_WIRE_PROTOCOL_VERSION = 2;

/**
 * Minimum `wireProtocolVersion` the server accepts for a `world` join,
 * including NPC joins and independent of ZONE_PRIVACY_AUTH_ENFORCE.
 *
 * Raise it together with WORLD_WIRE_PROTOCOL_VERSION when the wire protocol
 * breaks. Raising only this value locks out the current client, raising only
 * WORLD_WIRE_PROTOCOL_VERSION leaves older clients in.
 */
export const MIN_WORLD_WIRE_PROTOCOL_VERSION = 2;

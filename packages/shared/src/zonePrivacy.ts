/**
 * H4 audio-zone privacy: client/server protocol version.
 *
 * Bumped whenever the client-side zone-privacy contract changes in a way
 * that requires server-side enforcement — e.g. a new/changed deny-all
 * baseline, or a different `av_zone_permissions` handling contract (see
 * apps/web/src/av/manager/zonePermissionsManager.ts). Server and client
 * both import this constant so there is a single source of truth for the
 * minimum accepted client version; do not duplicate the number elsewhere.
 */
export const ZONE_PRIVACY_PROTOCOL_VERSION = 1;

/**
 * Minimum `zonePrivacyVersion` the server accepts for a Colyseus `world`
 * join (apps/server/src/rooms/lifecycle/onAuth.ts) and for a LiveKit
 * publish grant (apps/server/src/api/routes/health.ts, handleLivekitToken).
 *
 * This is an honesty-based gate: it closes the "outdated official client"
 * vector, not a malicious fork that lies about its version. See SECURITY.md
 * for the documented restrisk.
 */
export const MIN_ZONE_PRIVACY_CLIENT_VERSION = 1;

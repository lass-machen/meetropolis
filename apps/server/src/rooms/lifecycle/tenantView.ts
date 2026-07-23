import { StateView } from '@colyseus/schema';
import type { Client } from 'colyseus';
import type { WorldRoom, Player } from '../WorldRoom.js';
import { isWorldAuth } from './onAuth.js';

/**
 * Per-client tenant isolation of the shared `WorldState.players` map.
 *
 * On an apex/root domain (production, since 2026-07-08) the Colyseus room is
 * partitioned by the client-supplied `options.tenant`, which is `'default'` for
 * every tenant until clients ship the auth-slug send — so two different tenants
 * can share ONE WorldRoom instance. `WorldState.players` is `@view()`-tagged
 * (see WorldRoom.ts), which turns the automatic state sync into a per-client
 * filter: a Player is only encoded for a client whose `client.view` contains it.
 *
 * This module drives those views off the JWT-VERIFIED tenant (client.auth), so
 * a client only ever sees players of its own authenticated tenant. It does not
 * depend on any client rollout or feature flag: the filtering is server-side and
 * transparent to the client SDK (the client simply receives fewer players).
 */

// Sentinel tenant key for joins that carry NO verified tenant (token-less legacy
// joins while ZONE_PRIVACY_AUTH_ENFORCE is off, which only exist in dev — prod
// rejects them). Such clients collapse onto this key so they can only ever see
// each other, never a real tenant's players. Prefixed to never collide with a
// real cuid tenant id.
export const NO_TENANT_KEY = '__no_tenant__';

/**
 * The tenant visibility key for a client: its JWT-verified `auth.tenantId`, or
 * the sentinel when no verified tenant is present. NPC joins also land on the
 * sentinel here, but NPC PLAYERS are made visible to everyone (they carry no
 * user PII), so their key is never used for a comparison.
 */
export function tenantKeyForClient(client: Pick<Client, 'auth'>): string {
  const auth = isWorldAuth(client.auth) ? client.auth : undefined;
  return auth?.tenantId ?? NO_TENANT_KEY;
}

/**
 * Visibility predicate: is a player (with owner key `ownerKey`, or an NPC)
 * visible to a viewer with key `viewerKey`?
 *
 * NPCs are visible to all viewers: they are server-controlled bots with no user
 * PII (identity `npc-*`, a bot display name), and the client renders them
 * map-scoped anyway. Every other player is visible only within its own verified
 * tenant. An unknown owner key (`undefined`, e.g. a player mid-leave with no
 * tracked key) fails closed: hidden rather than leaked.
 */
export function isPlayerVisibleToTenant(isNpc: boolean, ownerKey: string | undefined, viewerKey: string): boolean {
  if (isNpc) return true;
  return ownerKey !== undefined && ownerKey === viewerKey;
}

/** Ensure the client has a StateView. Required for EVERY client because
 * `WorldState.players` is view-tagged: a client without a view sees no players
 * at all (including its own). */
export function ensureTenantView(client: Client): StateView {
  if (!client.view) {
    client.view = new StateView();
  }
  return client.view;
}

/**
 * After `joinedClient`'s player was added to `room.state.players`, wire the
 * per-client views so the tenant boundary holds for the shared map:
 *  1. populate the joined client's (fresh) view with every currently-visible
 *     player — its own, its same-tenant peers', and all NPCs;
 *  2. add the joined player to every existing client's view that is allowed to
 *     see it (same verified tenant, or the join is an NPC).
 *
 * Must run synchronously inside onJoin (before it resolves) so the initial full
 * state Colyseus sends to the joined client is already filtered. `joinedKey` is
 * the joined client's tenant key (also stored in room.playerTenantKey by the
 * caller before this runs).
 */
export function syncTenantViewsOnJoin(
  room: WorldRoom,
  joinedClient: Client,
  joinedPlayer: Player,
  joinedKey: string,
): void {
  const view = ensureTenantView(joinedClient);
  // 1. Joined client sees all players currently visible to its tenant.
  for (const [sid, p] of room.state.players.entries()) {
    const ownerKey = sid === joinedClient.sessionId ? joinedKey : room.playerTenantKey.get(sid);
    if (isPlayerVisibleToTenant(p.isNpc, ownerKey, joinedKey)) {
      view.add(p);
    }
  }
  // 2. Existing clients that may see the joined player get it added to their view.
  for (const other of room.clients) {
    if (other === joinedClient) continue;
    const otherKey = tenantKeyForClient(other);
    if (isPlayerVisibleToTenant(joinedPlayer.isNpc, joinedKey, otherKey)) {
      ensureTenantView(other).add(joinedPlayer);
    }
  }
}

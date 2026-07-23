/**
 * Finding 2 (room-state PII): `WorldState.players` is `@view()`-tagged, so
 * Colyseus only syncs a Player to a client whose `StateView` contains it.
 * `syncTenantViewsOnJoin` populates those views strictly by the JWT-verified
 * tenant, so a client sharing one WorldRoom instance with another tenant only
 * ever sees its own tenant's players (+ NPCs).
 *
 * This exercises the REAL @colyseus/schema StateView plus the REAL
 * WorldState/Player, so `view.add`/`view.has` run the actual encoder contract —
 * and it proves the @view() tag is present (without it, every client would see
 * every player and the visibility asserts below would fail).
 */
import { describe, it, expect, vi } from 'vitest';
import { Encoder } from '@colyseus/schema';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db.js', () => ({ createPrismaClient: () => ({}) }));

import { WorldState, Player } from '../WorldRoom.js';
import type { WorldRoom } from '../WorldRoom.js';
import type { Client } from 'colyseus';
import { isPlayerVisibleToTenant, tenantKeyForClient, syncTenantViewsOnJoin, NO_TENANT_KEY } from './tenantView.js';

function makeRoom(): WorldRoom {
  const state = new WorldState();
  // Root the schema tree so children added to state.players get a ChangeTree
  // and StateView.add works against the real encoder.
  new Encoder(state);
  return {
    state,
    playerTenantKey: new Map<string, string>(),
    clients: [] as Client[],
  } as unknown as WorldRoom;
}

function makeClient(sessionId: string, tenantId?: string, isNpc = false): Client {
  const auth = isNpc
    ? { identity: sessionId, isNpc: true, zonePrivacyVersion: 1 }
    : { identity: sessionId, isNpc: false, zonePrivacyVersion: 1, ...(tenantId ? { tenantId } : {}) };
  return { sessionId, auth } as unknown as Client;
}

// Simulate the view-relevant part of completePendingJoin for one client.
function join(room: WorldRoom, client: Client, isNpc = false): Player {
  const p = new Player();
  p.id = client.sessionId;
  p.identity = client.sessionId;
  p.isNpc = isNpc;
  room.state.players.set(client.sessionId, p);
  const key = tenantKeyForClient(client);
  room.playerTenantKey.set(client.sessionId, key);
  (room.clients as Client[]).push(client);
  syncTenantViewsOnJoin(room, client, p, key);
  return p;
}

describe('isPlayerVisibleToTenant', () => {
  it('NPCs are visible to every viewer', () => {
    expect(isPlayerVisibleToTenant(true, 'tid-a', 'tid-b')).toBe(true);
    expect(isPlayerVisibleToTenant(true, undefined, NO_TENANT_KEY)).toBe(true);
  });
  it('non-NPC players are visible only within the same tenant key', () => {
    expect(isPlayerVisibleToTenant(false, 'tid-a', 'tid-a')).toBe(true);
    expect(isPlayerVisibleToTenant(false, 'tid-a', 'tid-b')).toBe(false);
  });
  it('an unknown owner key fails closed (hidden, not leaked)', () => {
    expect(isPlayerVisibleToTenant(false, undefined, 'tid-a')).toBe(false);
  });
});

describe('tenantKeyForClient', () => {
  it('uses the verified auth.tenantId', () => {
    expect(tenantKeyForClient(makeClient('c', 'tid-a'))).toBe('tid-a');
  });
  it('falls back to the sentinel without a verified tenant', () => {
    expect(tenantKeyForClient(makeClient('c'))).toBe(NO_TENANT_KEY);
    expect(tenantKeyForClient({ auth: { foo: 1 } })).toBe(NO_TENANT_KEY);
  });
});

describe('syncTenantViewsOnJoin: per-client tenant isolation of WorldState.players', () => {
  it('a client only sees its own tenant (cross-tenant hidden), NPCs visible to all', () => {
    const room = makeRoom();
    const a1 = makeClient('a1', 'tid-a');
    const a2 = makeClient('a2', 'tid-a');
    const b1 = makeClient('b1', 'tid-b');
    const npc = makeClient('npc-1', undefined, true);

    const pA1 = join(room, a1);
    const pA2 = join(room, a2);
    const pB1 = join(room, b1);
    const pNpc = join(room, npc, true);

    // Same tenant sees each other.
    expect(a1.view?.has(pA1)).toBe(true);
    expect(a1.view?.has(pA2)).toBe(true);
    expect(a2.view?.has(pA1)).toBe(true);
    // Cross-tenant is invisible — the leak Finding 2 closes.
    expect(a1.view?.has(pB1)).toBe(false);
    expect(a2.view?.has(pB1)).toBe(false);
    expect(b1.view?.has(pA1)).toBe(false);
    expect(b1.view?.has(pA2)).toBe(false);
    // B sees its own player.
    expect(b1.view?.has(pB1)).toBe(true);
    // NPC visible to every tenant.
    expect(a1.view?.has(pNpc)).toBe(true);
    expect(b1.view?.has(pNpc)).toBe(true);
  });

  it('a late joiner sees existing same-tenant players but not the foreign ones', () => {
    const room = makeRoom();
    const b1 = makeClient('b1', 'tid-b');
    const a1 = makeClient('a1', 'tid-a');
    const pB1 = join(room, b1);
    const pA1 = join(room, a1);
    // A joined last; its fresh view must contain only tenant A.
    expect(a1.view?.has(pA1)).toBe(true);
    expect(a1.view?.has(pB1)).toBe(false);
  });
});

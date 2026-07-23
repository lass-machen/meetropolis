/**
 * Skeptic follow-up (zone_lock_state, MAJOR): the zone-lock roster is another
 * room-state channel. Each lock's pendingRequests carries identity (userId) +
 * name (display name, = email when unset) — cross-tenant PII in a shared apex/
 * 'default' room. zoneLocksForClient must strip pendingRequests that belong to
 * other tenants (by the requester's verified room.playerTenantKey) while leaving
 * the lock envelope (sessionIds only) and same-tenant requests fully intact.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { zoneLocksForClient } from './zoneLockHandler.js';
import type { WorldRoom } from '../WorldRoom.js';
import type { Client } from 'colyseus';

type Lock = {
  zoneName: string;
  mapId: string;
  lockedBy: string;
  accessList: string[];
  pendingRequests: { sessionId: string; identity: string; name: string }[];
};

function makeRoom(locks: Map<string, Lock>, playerTenantKey: Map<string, string>): WorldRoom {
  return { zoneLockState: { locks }, playerTenantKey, clients: [] } as unknown as WorldRoom;
}
function client(tenantId?: string): Client {
  return {
    auth: { identity: 'viewer', isNpc: false, zonePrivacyVersion: 1, ...(tenantId ? { tenantId } : {}) },
  } as unknown as Client;
}

describe('zoneLocksForClient: pendingRequests are tenant-scoped (PII channel)', () => {
  it('a viewer only sees same-tenant pendingRequests; the envelope stays intact', () => {
    const lock: Lock = {
      zoneName: 'meeting',
      mapId: 'map-a',
      lockedBy: 'sidOwnerA',
      accessList: ['sidOwnerA'],
      pendingRequests: [
        { sessionId: 'sidA', identity: 'userA', name: 'a@tenant-a.test' },
        { sessionId: 'sidB', identity: 'userB', name: 'secret@tenant-b.test' },
      ],
    };
    const room = makeRoom(
      new Map([['map-a:meeting', lock]]),
      new Map([
        ['sidOwnerA', 'tid-a'],
        ['sidA', 'tid-a'],
        ['sidB', 'tid-b'],
      ]),
    );

    const aView = zoneLocksForClient(room, client('tid-a'));
    const bView = zoneLocksForClient(room, client('tid-b'));

    // Tenant A viewer: only the tenant-A requester, never tenant B's PII.
    expect(aView[0].pendingRequests.map((r) => r.identity)).toEqual(['userA']);
    expect(aView[0].pendingRequests.some((r) => r.name.includes('tenant-b'))).toBe(false);
    // Tenant B viewer: only the tenant-B requester.
    expect(bView[0].pendingRequests.map((r) => r.identity)).toEqual(['userB']);
    // Envelope preserved (sessionIds only, no PII).
    expect(aView[0].zoneName).toBe('meeting');
    expect(aView[0].mapId).toBe('map-a');
    expect(aView[0].lockedBy).toBe('sidOwnerA');
    expect(aView[0].accessList).toEqual(['sidOwnerA']);
  });

  it('shows ALL pendingRequests when every requester is same-tenant (no over-filtering)', () => {
    const lock: Lock = {
      zoneName: 'meeting',
      mapId: 'map-a',
      lockedBy: 'owner',
      accessList: ['owner'],
      pendingRequests: [
        { sessionId: 's1', identity: 'u1', name: 'u1' },
        { sessionId: 's2', identity: 'u2', name: 'u2' },
      ],
    };
    const room = makeRoom(
      new Map([['map-a:meeting', lock]]),
      new Map([
        ['s1', 'tid-a'],
        ['s2', 'tid-a'],
      ]),
    );
    const view = zoneLocksForClient(room, client('tid-a'));
    expect(view[0].pendingRequests.map((r) => r.identity)).toEqual(['u1', 'u2']);
  });

  it('hides a requester whose tenant is unknown (left the room mid-request) — fail closed', () => {
    const lock: Lock = {
      zoneName: 'z',
      mapId: 'm',
      lockedBy: 'o',
      accessList: ['o'],
      pendingRequests: [{ sessionId: 'gone', identity: 'ghost', name: 'ghost@x.test' }],
    };
    const room = makeRoom(new Map([['m:z', lock]]), new Map()); // no key for 'gone'
    const view = zoneLocksForClient(room, client('tid-a'));
    expect(view[0].pendingRequests).toEqual([]);
  });

  it('does not mutate the underlying lock (returns a filtered copy)', () => {
    const lock: Lock = {
      zoneName: 'z',
      mapId: 'm',
      lockedBy: 'o',
      accessList: ['o'],
      pendingRequests: [
        { sessionId: 'a', identity: 'ua', name: 'a' },
        { sessionId: 'b', identity: 'ub', name: 'b' },
      ],
    };
    const room = makeRoom(
      new Map([['m:z', lock]]),
      new Map([
        ['a', 'tid-a'],
        ['b', 'tid-b'],
      ]),
    );
    zoneLocksForClient(room, client('tid-a'));
    expect(lock.pendingRequests.length).toBe(2); // original list untouched
  });
});

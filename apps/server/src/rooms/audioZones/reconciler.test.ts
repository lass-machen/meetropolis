import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const activeRooms = new Set<unknown>();
vi.mock('../WorldRoom.js', () => ({
  getActiveWorldRooms: () => activeRooms,
}));

import type { LivekitAdminClient } from './livekitAdmin.js';
import { createMembershipTracker, onMove } from './membershipTracker.js';
import { createPermissionOrchestrator } from './permissionOrchestrator.js';
import { buildTenantSnapshot, reconcileOnce } from './reconciler.js';

// Minimal fake shaped like the slice of WorldRoom that reconciler.ts
// actually touches: metadata.tenant, audioZones.{tracker,admin,orchestrator},
// state.players, clients. Cast through `unknown` at the call boundary
// rather than importing the real (heavy) WorldRoom class.
function fakeRoom(tenant: string, admin: LivekitAdminClient | null) {
  return {
    metadata: { tenant },
    state: { players: new Map() },
    clients: [],
    audioZones: {
      tracker: createMembershipTracker(),
      admin,
      orchestrator: createPermissionOrchestrator(),
    },
  };
}

function fakeAdmin(overrides: Partial<LivekitAdminClient> = {}): LivekitAdminClient {
  return {
    listParticipants: vi.fn(() => Promise.resolve([])),
    updateSubscriptions: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function participant(identity: string, trackSids: string[]) {
  return { identity, tracks: trackSids.map((sid) => ({ sid })) } as never;
}

beforeEach(() => {
  activeRooms.clear();
});

describe('buildTenantSnapshot', () => {
  it('merges membership trackers across every active room for the same tenant', () => {
    const roomA = fakeRoom('acme', null);
    const roomB = fakeRoom('acme', null);
    const roomOtherTenant = fakeRoom('other', null);
    onMove(roomA.audioZones.tracker, 'alice', 'map-1:zone:kitchen', 0);
    onMove(roomB.audioZones.tracker, 'bob', 'map-1:open', 0);
    onMove(roomOtherTenant.audioZones.tracker, 'mallory', 'map-1:zone:kitchen', 0);
    activeRooms.add(roomA).add(roomB).add(roomOtherTenant);

    const merged = buildTenantSnapshot('acme');
    expect(Object.fromEntries(merged)).toEqual({ alice: 'map-1:zone:kitchen', bob: 'map-1:open' });
  });
});

describe('reconcileOnce: fail-closed semantics', () => {
  it('no-ops without crashing when no LiveKit admin client is configured', async () => {
    const room = fakeRoom('acme', null) as never;
    await expect(reconcileOnce(room)).resolves.toBeUndefined();
  });

  it('still repushes av_zone_permissions when no LiveKit admin client is configured', async () => {
    // Regression guard: the Colyseus repush heal (a lost/never-applied
    // av_zone_permissions push, e.g. after a LiveKit-level reconnect with
    // no zone-membership transition) must not depend on admin credentials
    // being configured — see this module's doc comment.
    vi.useFakeTimers();
    try {
      const room = fakeRoom('acme', null);
      const send = vi.fn();
      room.clients = [{ sessionId: 'sess-1', send }] as never;
      room.state.players = new Map([['sess-1', { identity: 'alice' }]]) as never;
      onMove(room.audioZones.tracker, 'alice', 'map-1:zone:kitchen', 0);
      onMove(room.audioZones.tracker, 'bob', 'map-1:zone:kitchen', 0);

      await reconcileOnce(room as never);
      await vi.runAllTimersAsync();

      expect(send).toHaveBeenCalledWith('av_zone_permissions', { islandId: 'map-1:zone:kitchen', allow: ['bob'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not crash and does not attempt any correction when listParticipants rejects', async () => {
    const admin = fakeAdmin({ listParticipants: vi.fn(() => Promise.reject(new Error('livekit down'))) });
    const room = fakeRoom('acme', admin) as never;
    await expect(reconcileOnce(room)).resolves.toBeUndefined();
    expect(admin.updateSubscriptions).not.toHaveBeenCalled();
  });

  it('continues correcting remaining pairs when one updateSubscriptions call fails', async () => {
    const admin = fakeAdmin({
      listParticipants: vi.fn(() =>
        Promise.resolve([participant('publisher', ['t1']), participant('outsiderA', []), participant('outsiderB', [])]),
      ),
      updateSubscriptions: vi.fn().mockRejectedValueOnce(new Error('rpc failed')).mockResolvedValueOnce(undefined),
    });
    const room = fakeRoom('acme', admin);
    onMove(room.audioZones.tracker, 'publisher', 'map-1:zone:kitchen', 0);
    onMove(room.audioZones.tracker, 'outsiderA', 'map-1:open', 0);
    onMove(room.audioZones.tracker, 'outsiderB', 'map-1:open', 0);
    activeRooms.add(room);

    await expect(reconcileOnce(room as never)).resolves.toBeUndefined();
    expect(admin.updateSubscriptions).toHaveBeenCalledTimes(2);
  });
});

describe('reconcileOnce: cross-island correction', () => {
  it('forces unsubscribe only for participants outside the publisher island, never for islandmates', async () => {
    const admin = fakeAdmin({
      listParticipants: vi.fn(() =>
        Promise.resolve([
          participant('publisher', ['track-a', 'track-b']),
          participant('islandmate', []),
          participant('outsider', []),
        ]),
      ),
    });
    const room = fakeRoom('acme', admin);
    onMove(room.audioZones.tracker, 'publisher', 'map-1:zone:kitchen', 0);
    onMove(room.audioZones.tracker, 'islandmate', 'map-1:zone:kitchen', 0);
    onMove(room.audioZones.tracker, 'outsider', 'map-1:open', 0);
    activeRooms.add(room);

    await reconcileOnce(room as never);

    expect(admin.updateSubscriptions).toHaveBeenCalledTimes(1);
    expect(admin.updateSubscriptions).toHaveBeenCalledWith('acme:world', 'outsider', ['track-a', 'track-b'], false);
  });

  it('skips a publisher with no tracks and a publisher absent from the desired snapshot (untracked identity)', async () => {
    const admin = fakeAdmin({
      listParticipants: vi.fn(() =>
        Promise.resolve([
          participant('no-tracks', []),
          participant('npc-untracked', ['t1']),
          participant('outsider', []),
        ]),
      ),
    });
    const room = fakeRoom('acme', admin);
    onMove(room.audioZones.tracker, 'no-tracks', 'map-1:zone:kitchen', 0);
    onMove(room.audioZones.tracker, 'outsider', 'map-1:open', 0);
    // 'npc-untracked' is deliberately never added to the tracker.
    activeRooms.add(room);

    await reconcileOnce(room as never);

    expect(admin.updateSubscriptions).not.toHaveBeenCalled();
  });
});

import type { Client } from 'colyseus';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { TranscriptionGateChange, TranscriptionModule } from '../../transcriptionLoader.js';
import type { WorldRoom } from '../WorldRoom.js';

const mocks = vi.hoisted(() => ({
  getTranscriptionModuleSync: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../transcriptionLoader.js', () => ({
  getTranscriptionModuleSync: mocks.getTranscriptionModuleSync,
}));

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.loggerWarn, error: vi.fn() },
}));

import { buildPushPayloads, createPermissionOrchestrator, rePushAllForRoom } from './permissionOrchestrator.js';
import { createMembershipTracker, onMove } from './membershipTracker.js';
import { isolatedIslandFor } from './islandModel.js';
import { startAudioZoneRuntime, stopAudioZoneRuntime } from './runtime.js';
import { TRANSCRIBER_IDENTITY } from './islandAttributes.js';

describe('buildPushPayloads', () => {
  it('computes one payload per identity, with the allow-list excluding itself', () => {
    const snapshot = new Map([
      ['alice', 'map-1:zone:kitchen'],
      ['bob', 'map-1:zone:kitchen'],
      ['carol', 'map-1:open'],
    ]);
    const payloads = buildPushPayloads(['alice', 'bob'], snapshot);
    expect(payloads).toEqual([
      { identity: 'alice', islandId: 'map-1:zone:kitchen', allow: ['bob'] },
      { identity: 'bob', islandId: 'map-1:zone:kitchen', allow: ['alice'] },
    ]);
  });

  it('skips an identity that has already departed the snapshot', () => {
    const snapshot = new Map([['alice', 'map-1:open']]);
    const payloads = buildPushPayloads(['alice', 'departed'], snapshot);
    expect(payloads).toEqual([{ identity: 'alice', islandId: 'map-1:open', allow: [] }]);
  });

  it('deduplicates naturally when the same identity is affected twice (Set semantics upstream)', () => {
    const snapshot = new Map([['alice', 'map-1:open']]);
    const payloads = buildPushPayloads(new Set(['alice', 'alice']), snapshot);
    expect(payloads).toHaveLength(1);
  });

  it('appends the transcriber for every admitted publisher, also for one alone on its island', () => {
    const snapshot = new Map([
      ['alice', 'map-1:zone:kitchen'],
      ['bob', 'map-1:zone:kitchen'],
      ['carol', 'map-1:open'],
    ]);
    const payloads = buildPushPayloads(['alice', 'bob', 'carol'], snapshot, (identity) => identity !== 'bob');
    expect(payloads).toEqual([
      { identity: 'alice', islandId: 'map-1:zone:kitchen', allow: ['bob', TRANSCRIBER_IDENTITY] },
      { identity: 'bob', islandId: 'map-1:zone:kitchen', allow: ['alice'] },
      { identity: 'carol', islandId: 'map-1:open', allow: [TRANSCRIBER_IDENTITY] },
    ]);
  });

  it('never appends the transcriber for a publisher on an isolated island', () => {
    const snapshot = new Map([['alice', isolatedIslandFor('alice')]]);
    const admitsTranscriber = vi.fn(() => true);
    const payloads = buildPushPayloads(['alice'], snapshot, admitsTranscriber);
    expect(payloads).toEqual([{ identity: 'alice', islandId: 'isolated:alice', allow: [] }]);
  });
});

// Flush path: the allow-list a publisher's Colyseus client actually receives.
const ROOM_TENANT_ID = 'tenant-acme';
const ROOM_TENANT_SLUG = 'acme';

interface FakeAuth {
  identity: string;
  tenantId?: string;
  tenantSlug?: string;
  isNpc: boolean;
  zonePrivacyVersion: number;
}

function memberAuth(identity: string, overrides: Partial<FakeAuth> = {}): FakeAuth {
  return {
    identity,
    tenantId: ROOM_TENANT_ID,
    tenantSlug: ROOM_TENANT_SLUG,
    isNpc: false,
    zonePrivacyVersion: 2,
    ...overrides,
  };
}

function fakeRoom() {
  return {
    metadata: { tenant: ROOM_TENANT_SLUG },
    state: { players: new Map<string, { identity: string }>() },
    clients: [] as Client[],
    audioZones: {
      tracker: createMembershipTracker(),
      orchestrator: createPermissionOrchestrator(),
      admin: null,
      reconcileInterval: null as ReturnType<typeof setInterval> | null,
      hysteresisSweepInterval: null as ReturnType<typeof setInterval> | null,
      transcriptionGateUnsubscribe: null as (() => void) | null,
    },
  };
}

type FakeRoom = ReturnType<typeof fakeRoom>;

function asWorldRoom(room: FakeRoom): WorldRoom {
  return room as unknown as WorldRoom;
}

function addMember(room: FakeRoom, identity: string, island: string, auth: FakeAuth | undefined) {
  const sessionId = `session-${identity}`;
  const send = vi.fn();
  room.state.players.set(sessionId, { identity });
  room.clients.push({ sessionId, auth, send } as unknown as Client);
  onMove(room.audioZones.tracker, identity, island, 0);
  return send;
}

function lastAllow(send: ReturnType<typeof vi.fn>): string[] {
  const call = send.mock.calls.at(-1);
  if (!call) throw new Error('Expected an av_zone_permissions push');
  expect(call[0]).toBe('av_zone_permissions');
  return (call[1] as { allow: string[] }).allow;
}

async function flushRoom(room: FakeRoom): Promise<void> {
  rePushAllForRoom(room.audioZones.orchestrator, asWorldRoom(room), room.audioZones.tracker);
  await vi.advanceTimersByTimeAsync(100);
}

const activeTenants = new Set<string>();
const gateListeners = new Set<(change: TranscriptionGateChange) => void>();
const isTenantTranscriptionActive = vi.fn((tenantId: string) => activeTenants.has(tenantId));

function moduleWith(extra: Partial<TranscriptionModule>): TranscriptionModule {
  return {
    version: 1,
    publishIslandAttributes: true,
    getJoinRequirement: () => Promise.resolve(null),
    onGateChange: (listener) => {
      gateListeners.add(listener);
      return () => gateListeners.delete(listener);
    },
    setupRoutes: () => undefined,
    ...extra,
  };
}

function emitGateChange(change: TranscriptionGateChange): void {
  for (const listener of gateListeners) listener(change);
}

describe('allow-list push with the transcription module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    activeTenants.clear();
    activeTenants.add(ROOM_TENANT_ID);
    gateListeners.clear();
    isTenantTranscriptionActive.mockClear();
    mocks.loggerWarn.mockReset();
    mocks.getTranscriptionModuleSync.mockReset().mockReturnValue(moduleWith({ isTenantTranscriptionActive }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes exactly the island members without any module', async () => {
    mocks.getTranscriptionModuleSync.mockReturnValue(null);
    const room = fakeRoom();
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));
    addMember(room, 'bob', 'map-1:open', memberAuth('bob'));

    await flushRoom(room);

    expect(lastAllow(alice)).toEqual(['bob']);
  });

  it('keeps the transcriber out when the module lacks the synchronous tenant state', async () => {
    mocks.getTranscriptionModuleSync.mockReturnValue(moduleWith({}));
    const room = fakeRoom();
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));

    await flushRoom(room);

    expect(lastAllow(alice)).toEqual([]);
  });

  it('admits the transcriber while the tenant of the room is active', async () => {
    const room = fakeRoom();
    const alice = addMember(room, 'alice', 'map-1:zone:kitchen', memberAuth('alice'));
    const bob = addMember(room, 'bob', 'map-1:zone:kitchen', memberAuth('bob'));

    await flushRoom(room);

    expect(lastAllow(alice)).toEqual(['bob', TRANSCRIBER_IDENTITY]);
    expect(lastAllow(bob)).toEqual(['alice', TRANSCRIBER_IDENTITY]);
    // One state read per tenant and batch, not per publisher.
    expect(isTenantTranscriptionActive).toHaveBeenCalledTimes(1);
    expect(isTenantTranscriptionActive).toHaveBeenCalledWith(ROOM_TENANT_ID);
  });

  it('keeps the transcriber out while the tenant is not active', async () => {
    activeTenants.clear();
    const room = fakeRoom();
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));
    addMember(room, 'bob', 'map-1:open', memberAuth('bob'));

    await flushRoom(room);

    expect(lastAllow(alice)).toEqual(['bob']);
  });

  it('keeps the transcriber out for a publisher on an isolated island', async () => {
    const room = fakeRoom();
    const alice = addMember(room, 'alice', isolatedIslandFor('alice'), memberAuth('alice'));

    await flushRoom(room);

    expect(lastAllow(alice)).toEqual([]);
  });

  it('keeps the transcriber out for a publisher whose verified tenant is not the room tenant', async () => {
    activeTenants.add('tenant-other');
    const room = fakeRoom();
    const guest = addMember(
      room,
      'guest',
      'map-1:open',
      memberAuth('guest', { tenantId: 'tenant-other', tenantSlug: 'other' }),
    );
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));

    await flushRoom(room);

    expect(lastAllow(guest)).toEqual(['alice']);
    expect(lastAllow(alice)).toEqual(['guest', TRANSCRIBER_IDENTITY]);
  });

  it('keeps the transcriber out for token-less and NPC joins', async () => {
    const room = fakeRoom();
    const tokenless = addMember(
      room,
      'tokenless',
      'map-1:open',
      memberAuth('tokenless', { tenantId: undefined, tenantSlug: undefined }),
    );
    const npc = addMember(room, 'npc-1', 'map-1:open', memberAuth('npc-1', { isNpc: true }));
    const unauthenticated = addMember(room, 'unauthenticated', 'map-1:open', undefined);
    const slugOnly = addMember(room, 'slug-only', 'map-1:open', memberAuth('slug-only', { tenantId: undefined }));

    await flushRoom(room);

    expect(lastAllow(tokenless)).not.toContain(TRANSCRIBER_IDENTITY);
    expect(lastAllow(slugOnly)).not.toContain(TRANSCRIBER_IDENTITY);
    expect(lastAllow(npc)).not.toContain(TRANSCRIBER_IDENTITY);
    expect(lastAllow(unauthenticated)).not.toContain(TRANSCRIBER_IDENTITY);
  });

  it('keeps the transcriber out and warns when the module throws', async () => {
    isTenantTranscriptionActive.mockImplementationOnce(() => {
      throw new Error('state unavailable');
    });
    const room = fakeRoom();
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));

    await flushRoom(room);

    expect(lastAllow(alice)).toEqual([]);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'transcription.tenant_state_check_failed', tenantId: ROOM_TENANT_ID }),
    );
  });

  it('reads the tenant state afresh on every push, so a periodic repush follows a change without any event', async () => {
    const room = fakeRoom();
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));

    await flushRoom(room);
    expect(lastAllow(alice)).toEqual([TRANSCRIBER_IDENTITY]);

    activeTenants.delete(ROOM_TENANT_ID);
    await flushRoom(room);
    expect(lastAllow(alice)).toEqual([]);

    activeTenants.add(ROOM_TENANT_ID);
    await flushRoom(room);
    expect(lastAllow(alice)).toEqual([TRANSCRIBER_IDENTITY]);
  });
});

describe('transcriber admission repush (runtime)', () => {
  let room: FakeRoom;

  beforeEach(() => {
    vi.useFakeTimers();
    activeTenants.clear();
    gateListeners.clear();
    mocks.getTranscriptionModuleSync.mockReset().mockReturnValue(moduleWith({ isTenantTranscriptionActive }));
    room = fakeRoom();
  });

  afterEach(() => {
    stopAudioZoneRuntime(asWorldRoom(room));
    vi.useRealTimers();
  });

  it('repushes right after a gate change of a tenant with clients in the room', async () => {
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));
    startAudioZoneRuntime(asWorldRoom(room));

    activeTenants.add(ROOM_TENANT_ID);
    emitGateChange({ tenantId: ROOM_TENANT_ID });
    await vi.advanceTimersByTimeAsync(100);

    expect(alice).toHaveBeenCalledTimes(1);
    expect(lastAllow(alice)).toEqual([TRANSCRIBER_IDENTITY]);

    activeTenants.delete(ROOM_TENANT_ID);
    emitGateChange({ tenantId: ROOM_TENANT_ID });
    await vi.advanceTimersByTimeAsync(100);

    expect(alice).toHaveBeenCalledTimes(2);
    expect(lastAllow(alice)).toEqual([]);
  });

  it('ignores a gate change of a tenant without clients in the room', async () => {
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));
    startAudioZoneRuntime(asWorldRoom(room));

    emitGateChange({ tenantId: 'tenant-elsewhere' });
    await vi.advanceTimersByTimeAsync(100);

    expect(alice).not.toHaveBeenCalled();
  });

  it('heals a state change without any event within one reconciler cycle', async () => {
    const alice = addMember(room, 'alice', 'map-1:open', memberAuth('alice'));
    startAudioZoneRuntime(asWorldRoom(room));

    activeTenants.add(ROOM_TENANT_ID);
    await vi.advanceTimersByTimeAsync(4_000 + 100);

    expect(lastAllow(alice)).toEqual([TRANSCRIBER_IDENTITY]);
  });

  it('subscribes only with the synchronous tenant state and unsubscribes on stop', () => {
    mocks.getTranscriptionModuleSync.mockReturnValue(moduleWith({}));
    startAudioZoneRuntime(asWorldRoom(room));
    expect(gateListeners.size).toBe(0);
    stopAudioZoneRuntime(asWorldRoom(room));

    mocks.getTranscriptionModuleSync.mockReturnValue(moduleWith({ isTenantTranscriptionActive }));
    startAudioZoneRuntime(asWorldRoom(room));
    expect(gateListeners.size).toBe(1);
    stopAudioZoneRuntime(asWorldRoom(room));
    expect(gateListeners.size).toBe(0);
  });
});

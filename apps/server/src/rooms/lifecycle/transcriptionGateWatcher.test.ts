import type { Client } from 'colyseus';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptionGateChange, TranscriptionModule } from '../../transcriptionLoader.js';

const mocks = vi.hoisted(() => ({
  getTranscriptionModuleSync: vi.fn(),
  getJoinRequirement: vi.fn(),
  createPrismaClient: vi.fn(),
  unsubscribe: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../transcriptionLoader.js', () => ({
  getTranscriptionModuleSync: mocks.getTranscriptionModuleSync,
}));

vi.mock('../../db.js', () => ({ createPrismaClient: mocks.createPrismaClient }));

vi.mock('../../logger.js', () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

import { getActiveWorldRooms, Player, type WorldRoom } from '../WorldRoom.js';
import { onMove } from '../audioZones/membershipTracker.js';
import { rePushAllForRoom } from '../audioZones/permissionOrchestrator.js';
import { TRANSCRIBER_IDENTITY } from '../audioZones/islandAttributes.js';
import { hasTranscriptionClearance, recordTranscriptionGateResult } from './transcriptionClearance.js';
import {
  disposeAllRooms,
  makeFakePrisma,
  matchmake,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

const listeners = new Set<(change: TranscriptionGateChange) => void>();
const getJoinRequirementMock = vi.fn<TranscriptionModule['getJoinRequirement']>(() => Promise.resolve(null));
const moduleImplementation = {
  version: 1 as const,
  publishIslandAttributes: false,
  getJoinRequirement: (
    prisma: Parameters<TranscriptionModule['getJoinRequirement']>[0],
    context: { tenantId: string; userId: string },
  ) => getJoinRequirementMock(prisma, context),
  onGateChange: (listener: (change: TranscriptionGateChange) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      mocks.unsubscribe();
    };
  },
  setupRoutes: () => undefined,
} satisfies TranscriptionModule;

let server: MatchmakeTestServer;

function makeClient(identity: string, tenantId: string, isNpc = false): Client {
  return {
    auth: { identity, tenantId, isNpc, zonePrivacyVersion: 2 },
    error: vi.fn(),
    leave: vi.fn(),
  } as Client;
}

async function createWorldRoom() {
  await matchmake(server, JSON.stringify({ tenant: 'acme' }));
  const room = [...getActiveWorldRooms()][0];
  if (!room) throw new Error('Expected matchmake to create a WorldRoom');
  return room;
}

async function disposeTestRooms(): Promise<void> {
  for (const room of getActiveWorldRooms()) room.clients.splice(0, room.clients.length);
  await disposeAllRooms();
}

function emit(change: TranscriptionGateChange): void {
  for (const listener of listeners) listener(change);
}

beforeAll(async () => {
  mocks.createPrismaClient.mockImplementation(makeFakePrisma);
  server = await startMatchmakeServer();
});

afterAll(async () => {
  await disposeTestRooms();
  await stopMatchmakeServer(server);
});

beforeEach(async () => {
  await disposeTestRooms();
  listeners.clear();
  getJoinRequirementMock.mockReset().mockResolvedValue(null);
  mocks.getTranscriptionModuleSync.mockReset().mockReturnValue(moduleImplementation);
  mocks.unsubscribe.mockReset();
  mocks.loggerWarn.mockReset();
  mocks.loggerError.mockReset();
});

describe('watchTranscriptionGate', () => {
  it('re-checks only clients in the event tenant and disconnects those without consent', async () => {
    const room = await createWorldRoom();
    const needsConsent = makeClient('user-a', 'tenant-a');
    const hasConsent = makeClient('user-b', 'tenant-a');
    room.clients.push(needsConsent, hasConsent);
    getJoinRequirementMock.mockImplementation((_prisma, { userId }) =>
      Promise.resolve(userId === 'user-a' ? { code: 'transcription_consent_required' } : null),
    );

    emit({ tenantId: 'tenant-a' });
    await vi.waitFor(() => {
      expect(getJoinRequirementMock).toHaveBeenCalledTimes(2);
      expect(needsConsent.leave).toHaveBeenCalledWith(4008);
    });

    expect(needsConsent.error).toHaveBeenCalledWith(4008, 'transcription_consent_required');
    expect(needsConsent.leave).toHaveBeenCalledWith(4008);
    expect(hasConsent.error).not.toHaveBeenCalled();
  });

  it('does not disconnect clients when the gate cannot be evaluated and only warns', async () => {
    const room = await createWorldRoom();
    const client = makeClient('user-a', 'tenant-a');
    room.clients.push(client);
    mocks.loggerWarn.mockClear();
    getJoinRequirementMock.mockRejectedValue(new Error('gate lookup failed'));

    emit({ tenantId: 'tenant-a' });
    await vi.waitFor(() =>
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'transcription.gate_recheck_unavailable', userId: 'user-a' }),
      ),
    );

    expect(client.error).not.toHaveBeenCalled();
    expect(client.leave).not.toHaveBeenCalled();
  });

  it('does not disconnect clients when the recheck itself throws and only logs', async () => {
    const room = await createWorldRoom();
    const client = makeClient('user-a', 'tenant-a');
    room.clients.push(client);
    room.prismaForPresence = null;
    mocks.createPrismaClient.mockImplementationOnce(() => {
      throw new Error('db unavailable');
    });

    emit({ tenantId: 'tenant-a' });
    await vi.waitFor(() =>
      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'transcription.gate_recheck_failed', tenantId: 'tenant-a' }),
      ),
    );

    expect(client.error).not.toHaveBeenCalled();
    expect(client.leave).not.toHaveBeenCalled();
  });

  it('targets only the user named by a gate-change event', async () => {
    const room = await createWorldRoom();
    const target = makeClient('user-a', 'tenant-a');
    const other = makeClient('user-b', 'tenant-a');
    room.clients.push(target, other);
    getJoinRequirementMock.mockResolvedValue({ code: 'transcription_consent_required' });

    emit({ tenantId: 'tenant-a', userId: 'user-a' });
    await vi.waitFor(() => expect(target.leave).toHaveBeenCalledWith(4008));

    expect(getJoinRequirementMock).toHaveBeenCalledTimes(1);
    expect(other.error).not.toHaveBeenCalled();
  });

  it('ignores a gate-change event for a tenant with no connected clients in the room', async () => {
    const room = await createWorldRoom();
    const client = makeClient('user-a', 'tenant-a');
    room.clients.push(client);

    emit({ tenantId: 'tenant-b' });
    await Promise.resolve();

    expect(getJoinRequirementMock).not.toHaveBeenCalled();
    expect(client.error).not.toHaveBeenCalled();
  });

  it('never checks or disconnects NPC clients', async () => {
    const room = await createWorldRoom();
    const npc = makeClient('npc-1', 'tenant-a', true);
    const human = makeClient('user-a', 'tenant-a');
    room.clients.push(npc, human);
    getJoinRequirementMock.mockResolvedValue({ code: 'transcription_consent_required' });

    emit({ tenantId: 'tenant-a' });
    await vi.waitFor(() => expect(human.leave).toHaveBeenCalledWith(4008));

    expect(npc.error).not.toHaveBeenCalled();
    expect(npc.leave).not.toHaveBeenCalled();
    expect(getJoinRequirementMock).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from gate changes when the WorldRoom is disposed', async () => {
    await createWorldRoom();

    expect(listeners.size).toBe(1);
    await disposeTestRooms();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('watchTranscriptionGate transcription clearance', () => {
  const activeTenants = new Set<string>();
  type EvaluateJoin = NonNullable<TranscriptionModule['evaluateJoin']>;
  const evaluateJoinMock = vi.fn<EvaluateJoin>();
  const withTenantState = {
    ...moduleImplementation,
    evaluateJoin: (...args: Parameters<EvaluateJoin>) => evaluateJoinMock(...args),
    isTenantTranscriptionActive: (tenantId: string) => activeTenants.has(tenantId),
  } satisfies TranscriptionModule;
  const verified = { requirement: null, consentVerified: true };
  const consentRequired = { requirement: { code: 'transcription_consent_required' as const }, consentVerified: false };

  type TrackedClient = Client & { send: ReturnType<typeof vi.fn> };

  function addTrackedMember(room: WorldRoom, identity: string): TrackedClient {
    const sessionId = `session-${identity}`;
    const client = {
      sessionId,
      auth: { identity, tenantId: 'tenant-a', tenantSlug: 'acme', isNpc: false, zonePrivacyVersion: 2 },
      error: vi.fn(),
      leave: vi.fn(),
      send: vi.fn(),
    } as unknown as TrackedClient;
    const player = new Player();
    player.identity = identity;
    player.mapId = 'map-1';
    room.state.players.set(sessionId, player);
    room.clients.push(client);
    onMove(room.audioZones.tracker, identity, 'map-1:open', 0);
    return client;
  }

  function pushedAllows(client: TrackedClient): string[][] {
    return client.send.mock.calls
      .filter((call) => call[0] === 'av_zone_permissions')
      .map((call) => (call[1] as { allow: string[] }).allow);
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  beforeEach(() => {
    activeTenants.clear();
    evaluateJoinMock.mockReset().mockResolvedValue(verified);
    mocks.getTranscriptionModuleSync.mockReturnValue(withTenantState);
  });

  it('clears a client of a newly active tenant only after its re-check and pushes only then', async () => {
    const room = await createWorldRoom();
    const client = addTrackedMember(room, 'user-a');
    const recheck = deferred<Awaited<ReturnType<EvaluateJoin>>>();
    evaluateJoinMock.mockReturnValue(recheck.promise);

    activeTenants.add('tenant-a');
    emit({ tenantId: 'tenant-a' });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(hasTranscriptionClearance(client, 'tenant-a')).toBe(false);
    expect(pushedAllows(client)).toEqual([]);

    recheck.resolve(verified);
    await vi.waitFor(() => expect(pushedAllows(client)).toEqual([[TRANSCRIBER_IDENTITY]]));
    expect(hasTranscriptionClearance(client, 'tenant-a')).toBe(true);
  });

  it('voids an existing clearance as soon as the gate changes', async () => {
    activeTenants.add('tenant-a');
    const room = await createWorldRoom();
    const client = addTrackedMember(room, 'user-a');
    recordTranscriptionGateResult(client, 'tenant-a', true);
    evaluateJoinMock.mockReturnValue(new Promise(() => undefined));

    emit({ tenantId: 'tenant-a' });

    expect(hasTranscriptionClearance(client, 'tenant-a')).toBe(false);
  });

  it('leaves a client without clearance when its re-check requires consent', async () => {
    activeTenants.add('tenant-a');
    const room = await createWorldRoom();
    const client = addTrackedMember(room, 'user-a');
    recordTranscriptionGateResult(client, 'tenant-a', true);
    evaluateJoinMock.mockResolvedValue(consentRequired);

    emit({ tenantId: 'tenant-a' });
    await vi.waitFor(() => expect(client.leave).toHaveBeenCalledWith(4008));

    expect(hasTranscriptionClearance(client, 'tenant-a')).toBe(false);
    expect(pushedAllows(client).flat()).not.toContain(TRANSCRIBER_IDENTITY);
  });

  it('pushes a list without the transcriber ahead of the consent disconnect', async () => {
    activeTenants.add('tenant-a');
    const room = await createWorldRoom();
    const client = addTrackedMember(room, 'user-a');
    recordTranscriptionGateResult(client, 'tenant-a', true);
    rePushAllForRoom(room.audioZones.orchestrator, room, room.audioZones.tracker);
    await vi.waitFor(() => expect(pushedAllows(client)).toEqual([[TRANSCRIBER_IDENTITY]]));
    evaluateJoinMock.mockResolvedValue(consentRequired);

    emit({ tenantId: 'tenant-a', userId: 'user-a' });
    await vi.waitFor(() => expect(client.leave).toHaveBeenCalledWith(4008));

    expect(pushedAllows(client)).toEqual([[TRANSCRIBER_IDENTITY], []]);
    const lastPushOrder = client.send.mock.invocationCallOrder.at(-1) ?? Infinity;
    expect(lastPushOrder).toBeLessThan(vi.mocked(client.error).mock.invocationCallOrder[0] ?? -Infinity);
  });

  it('pushes a list without the transcriber when the re-check is unavailable', async () => {
    activeTenants.add('tenant-a');
    const room = await createWorldRoom();
    const client = addTrackedMember(room, 'user-a');
    recordTranscriptionGateResult(client, 'tenant-a', true);
    evaluateJoinMock.mockRejectedValue(new Error('gate lookup failed'));

    emit({ tenantId: 'tenant-a' });
    await vi.waitFor(() => expect(pushedAllows(client)).toEqual([[]]));

    expect(hasTranscriptionClearance(client, 'tenant-a')).toBe(false);
    expect(client.leave).not.toHaveBeenCalled();
  });

  it('drops the transcriber after a re-check that verifies no consent', async () => {
    activeTenants.add('tenant-a');
    const room = await createWorldRoom();
    const client = addTrackedMember(room, 'user-a');
    recordTranscriptionGateResult(client, 'tenant-a', true);
    evaluateJoinMock.mockResolvedValue({ requirement: null, consentVerified: false });

    activeTenants.delete('tenant-a');
    emit({ tenantId: 'tenant-a' });
    await vi.waitFor(() => expect(pushedAllows(client)).toEqual([[]]));

    expect(hasTranscriptionClearance(client, 'tenant-a')).toBe(false);
  });
});

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

import { getActiveWorldRooms } from '../WorldRoom.js';
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
      expect(needsConsent.leave).toHaveBeenCalledWith(4006);
    });

    expect(needsConsent.error).toHaveBeenCalledWith(4006, 'transcription_consent_required');
    expect(needsConsent.leave).toHaveBeenCalledWith(4006);
    expect(hasConsent.error).not.toHaveBeenCalled();
  });

  it('targets only the user named by a gate-change event', async () => {
    const room = await createWorldRoom();
    const target = makeClient('user-a', 'tenant-a');
    const other = makeClient('user-b', 'tenant-a');
    room.clients.push(target, other);
    getJoinRequirementMock.mockResolvedValue({ code: 'transcription_consent_required' });

    emit({ tenantId: 'tenant-a', userId: 'user-a' });
    await vi.waitFor(() => expect(target.leave).toHaveBeenCalledWith(4006));

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
    await vi.waitFor(() => expect(human.leave).toHaveBeenCalledWith(4006));

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

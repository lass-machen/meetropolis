import type express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { TranscriptionModule } from '../../transcriptionLoader.js';
import type { LivekitAdminClient } from './livekitAdmin.js';

const mocks = vi.hoisted(() => ({
  getTranscriptionModuleSync: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  requireAuth: vi.fn(),
  getTenantFromReq: vi.fn(),
  requireMembership: vi.fn(),
}));

vi.mock('../../transcriptionLoader.js', () => ({
  getTranscriptionModuleSync: mocks.getTranscriptionModuleSync,
}));

vi.mock('../../logger.js', () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('../../api/utils/authHelpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/utils/authHelpers.js')>();
  return {
    ...actual,
    requireAuth: mocks.requireAuth,
    getTenantFromReq: mocks.getTenantFromReq,
    requireMembership: mocks.requireMembership,
  };
});

import { handleLivekitToken } from '../../api/routes/health.js';
import { Player, WorldRoom, WorldState } from '../WorldRoom.js';
import { disposeOrchestrator } from './permissionOrchestrator.js';
import { onMove } from './membershipTracker.js';
import { trackMove } from './runtime.js';

const moduleImplementation: TranscriptionModule = {
  version: 1,
  publishIslandAttributes: false,
  getJoinRequirement: () => Promise.resolve(null),
  onGateChange: () => () => undefined,
  setupRoutes: () => undefined,
};

function fakeAdmin() {
  const updateParticipantAttributes = vi.fn(() => Promise.resolve());
  const admin: LivekitAdminClient = {
    listParticipants: () => Promise.resolve([]),
    updateSubscriptions: () => Promise.resolve(),
    updateParticipantAttributes,
  };
  return { admin, updateParticipantAttributes };
}

function makeRoom(admin: LivekitAdminClient): WorldRoom {
  const room = new WorldRoom();
  room.setState(new WorldState());
  Object.defineProperty(room, 'metadata', { value: { tenant: 'acme' } });
  room.audioZones.admin = admin;
  room.audioZones.catalog.zones.set('map-1', []);

  const player = new Player();
  player.identity = 'user-1';
  player.mapId = 'map-1';
  room.state.players.set('session-1', player);
  onMove(room.audioZones.tracker, 'user-1', 'previous-island', 0);
  return room;
}

function fakeReq(body: Record<string, unknown>): express.Request {
  return { body, headers: {} } as express.Request;
}

function fakeRes() {
  const res = {} as express.Response;
  const send = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.type = vi.fn().mockReturnValue(res);
  res.send = send;
  return { res, send };
}

const prisma = { $disconnect: vi.fn().mockResolvedValue(undefined) } as PrismaClient;

beforeEach(() => {
  moduleImplementation.publishIslandAttributes = false;
  mocks.getTranscriptionModuleSync.mockReset().mockReturnValue(moduleImplementation);
  mocks.requireAuth.mockReset().mockReturnValue({ userId: 'user-1' });
  mocks.getTenantFromReq.mockReset().mockReturnValue({ id: 'tenant-1', slug: 'acme' });
  mocks.requireMembership.mockReset().mockResolvedValue({ role: 'member' });
  vi.stubEnv('LIVEKIT_API_KEY', '');
  vi.stubEnv('LIVEKIT_API_SECRET', '');
  vi.stubEnv('LIVEKIT_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('trackMove island attributes', () => {
  it('publishes both attributes once after an island change when enabled', () => {
    moduleImplementation.publishIslandAttributes = true;
    const { admin, updateParticipantAttributes } = fakeAdmin();
    const room = makeRoom(admin);

    trackMove(room, 'session-1');

    expect(updateParticipantAttributes).toHaveBeenCalledTimes(1);
    expect(updateParticipantAttributes).toHaveBeenCalledWith(
      'acme:world',
      'user-1',
      expect.objectContaining({
        'meetropolis.island': 'map-1:open',
        'meetropolis.islandSince': expect.any(String),
      }),
    );
    disposeOrchestrator(room.audioZones.orchestrator);
  });

  it('does not publish island attributes when the optional module is absent', () => {
    mocks.getTranscriptionModuleSync.mockReturnValue(null);
    const { admin, updateParticipantAttributes } = fakeAdmin();
    const room = makeRoom(admin);

    trackMove(room, 'session-1');

    expect(updateParticipantAttributes).not.toHaveBeenCalled();
    disposeOrchestrator(room.audioZones.orchestrator);
  });
});

describe('handleLivekitToken participant grants', () => {
  it('does not grant clients permission to update their own metadata', async () => {
    mocks.getTranscriptionModuleSync.mockReturnValue(null);
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';
    const { res, send } = fakeRes();

    await handleLivekitToken(prisma, fakeReq({ roomName: 'world', identity: 'user-1' }), res);

    const token = send.mock.calls[0]?.[0];
    if (typeof token !== 'string') throw new Error('Expected /livekit/token to return a signed token');
    const payload = token.split('.')[1];
    if (!payload) throw new Error('Expected token to contain a payload');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { video?: Record<string, unknown> };
    expect(claims).not.toHaveProperty('video.canUpdateOwnMetadata');
  });
});

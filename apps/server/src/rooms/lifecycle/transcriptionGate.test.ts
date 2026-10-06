import type { Client } from 'colyseus';
import type express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { TranscriptionModule } from '../../transcriptionLoader.js';

const mocks = vi.hoisted(() => ({
  getTranscriptionModuleSync: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  requireAuth: vi.fn(),
  getTenantFromReq: vi.fn(),
  requireMembership: vi.fn(),
  createLivekitToken: vi.fn(),
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

vi.mock('../../api/utils/authHelpers.js', () => ({
  requireAuth: mocks.requireAuth,
  getTenantFromReq: mocks.getTenantFromReq,
  requireMembership: mocks.requireMembership,
}));

vi.mock('../../livekit.js', () => ({
  createLivekitToken: mocks.createLivekitToken,
}));

import { handleLivekitToken } from '../../api/routes/health.js';
import { evaluateTranscriptionGate, enforceTranscriptionGate } from './transcriptionGate.js';

const prisma = { $disconnect: vi.fn().mockResolvedValue(undefined) } as PrismaClient;
const getJoinRequirementMock = vi.fn<TranscriptionModule['getJoinRequirement']>(() => Promise.resolve(null));
const moduleImplementation = {
  version: 1 as const,
  publishIslandAttributes: false,
  getJoinRequirement: (client: PrismaClient, context: { tenantId: string; userId: string }) =>
    getJoinRequirementMock(client, context),
  onGateChange: () => () => undefined,
  setupRoutes: () => undefined,
} satisfies TranscriptionModule;

function makeClient() {
  return { error: vi.fn(), leave: vi.fn() } as Client;
}

function fakeReq(body: Record<string, unknown>): express.Request {
  return { body, headers: {} } as express.Request;
}

function fakeRes(): express.Response {
  const res = {} as express.Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.type = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  getJoinRequirementMock.mockReset().mockResolvedValue(null);
  mocks.getTranscriptionModuleSync.mockReset().mockReturnValue(moduleImplementation);
  mocks.loggerWarn.mockReset();
  mocks.requireAuth.mockReset().mockReturnValue({ userId: 'user-1' });
  mocks.getTenantFromReq.mockReset().mockReturnValue({ id: 'tenant-1', slug: 'acme' });
  mocks.requireMembership.mockReset().mockResolvedValue({ role: 'member' });
  mocks.createLivekitToken.mockReset().mockResolvedValue('livekit-token');
  vi.stubEnv('LIVEKIT_API_KEY', 'test-key');
  vi.stubEnv('LIVEKIT_API_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('evaluateTranscriptionGate', () => {
  it('allows joins when the optional module is absent', async () => {
    mocks.getTranscriptionModuleSync.mockReturnValue(null);

    await expect(evaluateTranscriptionGate(prisma, 'tenant-1', 'user-1')).resolves.toBe('allow');
  });

  it('allows joins when the module reports no requirement', async () => {
    await expect(evaluateTranscriptionGate(prisma, 'tenant-1', 'user-1')).resolves.toBe('allow');
  });

  it('requires consent when the module reports a requirement', async () => {
    getJoinRequirementMock.mockResolvedValue({ code: 'transcription_consent_required' });

    await expect(evaluateTranscriptionGate(prisma, 'tenant-1', 'user-1')).resolves.toBe('consent_required');
  });

  it('fails closed and warns when the module throws', async () => {
    getJoinRequirementMock.mockRejectedValue(new Error('gate lookup failed'));

    await expect(evaluateTranscriptionGate(prisma, 'tenant-1', 'user-1')).resolves.toBe('consent_required');
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'transcription.gate_check_failed', tenantId: 'tenant-1', userId: 'user-1' }),
    );
  });
});

describe('enforceTranscriptionGate', () => {
  it('sends the consent error and leaves when the gate requires consent', async () => {
    getJoinRequirementMock.mockResolvedValue({ code: 'transcription_consent_required' });
    const client = makeClient();

    await expect(enforceTranscriptionGate(client, prisma, 'tenant-1', 'user-1')).resolves.toBe(true);

    expect(client.error).toHaveBeenCalledWith(4008, 'transcription_consent_required');
    expect(client.leave).toHaveBeenCalledWith(1000);
  });

  it('fails closed when the module is loaded but no tenant id is available', async () => {
    const client = makeClient();

    await expect(enforceTranscriptionGate(client, prisma, undefined, 'user-1')).resolves.toBe(true);

    expect(client.error).toHaveBeenCalledWith(4008, 'transcription_consent_required');
    expect(client.leave).toHaveBeenCalledWith(1000);
    expect(getJoinRequirementMock).not.toHaveBeenCalled();
  });
});

describe('handleLivekitToken transcription gate', () => {
  it('returns 403 when the member has not consented', async () => {
    getJoinRequirementMock.mockResolvedValue({ code: 'transcription_consent_required' });
    const res = fakeRes();

    await handleLivekitToken(prisma, fakeReq({ roomName: 'world', identity: 'user-1' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'transcription_consent_required' });
    expect(mocks.createLivekitToken).not.toHaveBeenCalled();
  });

  it('keeps token issuance unchanged when the optional module is absent', async () => {
    mocks.getTranscriptionModuleSync.mockReturnValue(null);
    const res = fakeRes();

    await handleLivekitToken(prisma, fakeReq({ roomName: 'world', identity: 'user-1' }), res);

    expect(mocks.createLivekitToken).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('livekit-token');
  });
});

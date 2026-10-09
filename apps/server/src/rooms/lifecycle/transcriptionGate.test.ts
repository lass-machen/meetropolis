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
import { hasTranscriptionClearance, revokeTranscriptionClearance } from './transcriptionClearance.js';

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

  it('reports the gate as unavailable and warns when the module throws', async () => {
    getJoinRequirementMock.mockRejectedValue(new Error('gate lookup failed'));

    await expect(evaluateTranscriptionGate(prisma, 'tenant-1', 'user-1')).resolves.toBe('unavailable');
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

  it('rejects with the unavailable error when the gate cannot be evaluated', async () => {
    getJoinRequirementMock.mockRejectedValue(new Error('gate lookup failed'));
    const client = makeClient();

    await expect(enforceTranscriptionGate(client, prisma, 'tenant-1', 'user-1')).resolves.toBe(true);

    expect(client.error).toHaveBeenCalledWith(4503, 'transcription_gate_unavailable');
    expect(client.error).not.toHaveBeenCalledWith(4008, expect.anything());
    expect(client.leave).toHaveBeenCalledWith(1000);
  });

  it('fails closed as unavailable when the module is loaded but no tenant id is available', async () => {
    const client = makeClient();

    await expect(enforceTranscriptionGate(client, prisma, undefined, 'user-1')).resolves.toBe(true);

    expect(client.error).toHaveBeenCalledWith(4503, 'transcription_gate_unavailable');
    expect(client.error).not.toHaveBeenCalledWith(4008, expect.anything());
    expect(client.leave).toHaveBeenCalledWith(1000);
    expect(getJoinRequirementMock).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'transcription.gate_tenant_unresolved', userId: 'user-1' }),
    );
  });
});

describe('enforceTranscriptionGate transcription clearance', () => {
  const evaluateJoinMock = vi.fn<NonNullable<TranscriptionModule['evaluateJoin']>>();
  const activeTenants = new Set<string>();
  const withVerdict = {
    ...moduleImplementation,
    evaluateJoin: (...args: Parameters<NonNullable<TranscriptionModule['evaluateJoin']>>) => evaluateJoinMock(...args),
    isTenantTranscriptionActive: (tenantId: string) => activeTenants.has(tenantId),
  } satisfies TranscriptionModule;

  beforeEach(() => {
    activeTenants.clear();
    activeTenants.add('tenant-1');
    evaluateJoinMock.mockReset().mockResolvedValue({ requirement: null, consentVerified: true });
    mocks.getTranscriptionModuleSync.mockReturnValue(withVerdict);
  });

  it('clears a client whose consent the module verified', async () => {
    const client = makeClient();

    await expect(enforceTranscriptionGate(client, prisma, 'tenant-1', 'user-1')).resolves.toBe(false);

    expect(evaluateJoinMock).toHaveBeenCalledWith(prisma, { tenantId: 'tenant-1', userId: 'user-1' });
    expect(getJoinRequirementMock).not.toHaveBeenCalled();
    expect(hasTranscriptionClearance(client, 'tenant-1')).toBe(true);
    expect(hasTranscriptionClearance(client, 'tenant-2')).toBe(false);
  });

  it('admits but does not clear a client whose consent was not verified, whatever the tenant state says', async () => {
    // The tenant left the gated statuses in the database while the synchronous
    // state still reads active: the join is allowed, but proves no consent.
    evaluateJoinMock.mockResolvedValue({ requirement: null, consentVerified: false });
    const client = makeClient();

    await expect(enforceTranscriptionGate(client, prisma, 'tenant-1', 'user-1')).resolves.toBe(false);

    expect(hasTranscriptionClearance(client, 'tenant-1')).toBe(false);
  });

  it('clears on the verdict alone, without the tenant state', async () => {
    activeTenants.clear();
    const client = makeClient();

    await enforceTranscriptionGate(client, prisma, 'tenant-1', 'user-1');

    expect(hasTranscriptionClearance(client, 'tenant-1')).toBe(true);
  });

  it('rejects and does not clear a client whose verdict carries a requirement', async () => {
    evaluateJoinMock.mockResolvedValue({
      requirement: { code: 'transcription_consent_required' },
      consentVerified: true,
    });
    const rejected = makeClient();
    await expect(enforceTranscriptionGate(rejected, prisma, 'tenant-1', 'user-1')).resolves.toBe(true);
    expect(rejected.error).toHaveBeenCalledWith(4008, 'transcription_consent_required');

    evaluateJoinMock.mockRejectedValue(new Error('gate lookup failed'));
    const unavailable = makeClient();
    await expect(enforceTranscriptionGate(unavailable, prisma, 'tenant-1', 'user-1')).resolves.toBe(true);
    expect(unavailable.error).toHaveBeenCalledWith(4503, 'transcription_gate_unavailable');

    expect(hasTranscriptionClearance(rejected, 'tenant-1')).toBe(false);
    expect(hasTranscriptionClearance(unavailable, 'tenant-1')).toBe(false);
  });

  it('does not clear any client of a module without the verdict', async () => {
    mocks.getTranscriptionModuleSync.mockReturnValue({
      ...moduleImplementation,
      isTenantTranscriptionActive: (tenantId: string) => activeTenants.has(tenantId),
    });
    const client = makeClient();

    await expect(enforceTranscriptionGate(client, prisma, 'tenant-1', 'user-1')).resolves.toBe(false);

    expect(getJoinRequirementMock).toHaveBeenCalledTimes(1);
    expect(hasTranscriptionClearance(client, 'tenant-1')).toBe(false);
  });

  it('admits but does not clear a client whose clearance a gate change voided during the evaluation', async () => {
    let resolveVerdict!: (value: { requirement: null; consentVerified: boolean }) => void;
    evaluateJoinMock.mockReturnValue(
      new Promise((resolve) => {
        resolveVerdict = resolve;
      }),
    );
    const client = makeClient();

    const admission = enforceTranscriptionGate(client, prisma, 'tenant-1', 'user-1');
    revokeTranscriptionClearance(client);
    resolveVerdict({ requirement: null, consentVerified: true });

    await expect(admission).resolves.toBe(false);
    expect(hasTranscriptionClearance(client, 'tenant-1')).toBe(false);
  });

  it('answers the LiveKit token gate from the verdict as well', async () => {
    evaluateJoinMock.mockResolvedValue({
      requirement: { code: 'transcription_consent_required' },
      consentVerified: false,
    });

    await expect(evaluateTranscriptionGate(prisma, 'tenant-1', 'user-1')).resolves.toBe('consent_required');
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

  it('returns 503 when the gate cannot be evaluated', async () => {
    getJoinRequirementMock.mockRejectedValue(new Error('gate lookup failed'));
    const res = fakeRes();

    await handleLivekitToken(prisma, fakeReq({ roomName: 'world', identity: 'user-1' }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'transcription_gate_unavailable' });
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

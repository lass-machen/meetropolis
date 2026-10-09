import { describe, expect, it, vi } from 'vitest';
import {
  EXPECTED_TRANSCRIPTION_MODULE_VERSION,
  getTranscriptionModule,
  getTranscriptionModuleSync,
  toTranscriptionModule,
  transcriptionModuleSchema,
} from './transcriptionLoader.js';

describe('transcriptionLoader', () => {
  it('returns null when the optional module is not installed', async () => {
    await expect(getTranscriptionModule()).resolves.toBeNull();
    expect(getTranscriptionModuleSync()).toBeNull();
  });

  it('accepts a compatible module contract', () => {
    const candidate = {
      version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
      publishIslandAttributes: false,
      getJoinRequirement: () => Promise.resolve(null),
      onGateChange: () => () => undefined,
      setupRoutes: () => undefined,
    };

    expect(transcriptionModuleSchema.safeParse(candidate).success).toBe(true);
  });

  it('accepts the optional synchronous tenant state and keeps it after parsing', () => {
    const candidate = {
      version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
      publishIslandAttributes: true,
      getJoinRequirement: () => Promise.resolve(null),
      onGateChange: () => () => undefined,
      isTenantTranscriptionActive: (tenantId: string) => tenantId === 'tenant-1',
      setupRoutes: () => undefined,
    };

    const parsed = transcriptionModuleSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.isTenantTranscriptionActive).toEqual(expect.any(Function));
  });

  it('accepts the optional join verdict and binds both optional methods to the contract', async () => {
    const evaluateJoin = vi.fn(() => Promise.resolve({ requirement: null, consentVerified: true }));
    const isTenantTranscriptionActive = vi.fn(() => true);
    const parsed = transcriptionModuleSchema.parse({
      version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
      publishIslandAttributes: true,
      getJoinRequirement: () => Promise.resolve(null),
      onGateChange: () => () => undefined,
      evaluateJoin,
      isTenantTranscriptionActive,
      setupRoutes: () => undefined,
    });

    const bound = toTranscriptionModule(parsed);
    const prisma = {} as Parameters<NonNullable<typeof bound.evaluateJoin>>[0];
    await expect(bound.evaluateJoin?.(prisma, { tenantId: 't1', userId: 'u1' })).resolves.toEqual({
      requirement: null,
      consentVerified: true,
    });
    expect(evaluateJoin).toHaveBeenCalledWith(prisma, { tenantId: 't1', userId: 'u1' });
    expect(bound.isTenantTranscriptionActive?.('t1')).toBe(true);
    expect(isTenantTranscriptionActive).toHaveBeenCalledWith('t1');
  });

  it('binds a module without the optional methods as one without them', () => {
    const bound = toTranscriptionModule(
      transcriptionModuleSchema.parse({
        version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
        publishIslandAttributes: false,
        getJoinRequirement: () => Promise.resolve(null),
        onGateChange: () => () => undefined,
        setupRoutes: () => undefined,
      }),
    );

    expect(bound.evaluateJoin).toBeUndefined();
    expect(bound.isTenantTranscriptionActive).toBeUndefined();
  });

  it('rejects incompatible or incomplete module contracts', () => {
    const compatible = {
      version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
      publishIslandAttributes: false,
      getJoinRequirement: () => Promise.resolve(null),
      onGateChange: () => () => undefined,
      setupRoutes: () => undefined,
    };

    expect(transcriptionModuleSchema.safeParse({ ...compatible, version: 2 }).success).toBe(false);
    const { getJoinRequirement: _getJoinRequirement, ...missingJoinRequirement } = compatible;
    expect(transcriptionModuleSchema.safeParse(missingJoinRequirement).success).toBe(false);
    expect(transcriptionModuleSchema.safeParse({ ...compatible, isTenantTranscriptionActive: true }).success).toBe(
      false,
    );
    expect(transcriptionModuleSchema.safeParse({ ...compatible, evaluateJoin: true }).success).toBe(false);
  });
});

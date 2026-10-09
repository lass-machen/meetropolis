import { describe, expect, it } from 'vitest';
import {
  EXPECTED_TRANSCRIPTION_MODULE_VERSION,
  getTranscriptionModule,
  getTranscriptionModuleSync,
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
  });
});

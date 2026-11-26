import { describe, expect, it } from 'vitest';
import { EXPECTED_TRANSCRIPTION_MODULE_VERSION, resolveTranscriptionModule } from './transcriptionLoader.js';

/** A module that satisfies the contract, as the optional package exports it. */
function compatibleModule() {
  return {
    version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
    publishIslandAttributes: false,
    getJoinRequirement: () => Promise.resolve(null),
    onGateChange: () => () => undefined,
    setupRoutes: () => undefined,
  };
}

/** Import failure with the code Node reports for an unresolvable package. */
function importError(message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('resolveTranscriptionModule', () => {
  it('reports the package as absent only when exactly @meetropolis/transcription is missing', async () => {
    const missing = importError("Cannot find package '@meetropolis/transcription' imported from loader");

    const resolution = await resolveTranscriptionModule(() => Promise.reject(missing));

    expect(resolution).toEqual({ state: 'absent', module: null });
  });

  it('rejects an installed module whose own dependency cannot be imported', async () => {
    const missingDependency = importError("Cannot find package 'enterprise-db' imported from module");

    const resolution = await resolveTranscriptionModule(() => Promise.reject(missingDependency));

    expect(resolution).toEqual({ state: 'rejected', module: null });
  });

  it('rejects an installed module that violates the runtime schema', async () => {
    const wrongVersion = { ...compatibleModule(), version: 2 };

    const resolution = await resolveTranscriptionModule(() => Promise.resolve(wrongVersion));

    expect(resolution).toEqual({ state: 'rejected', module: null });
  });

  it('loads a module that satisfies the contract', async () => {
    const resolution = await resolveTranscriptionModule(() => Promise.resolve(compatibleModule()));

    expect(resolution.state).toBe('loaded');
    expect(resolution.module).not.toBeNull();
    expect(resolution.module?.version).toBe(EXPECTED_TRANSCRIPTION_MODULE_VERSION);
  });
});

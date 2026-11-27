import { describe, expect, it } from 'vitest';
import { readLivekitCredentials } from './livekitCredentials.js';

const configured = {
  LIVEKIT_API_KEY: 'configured-key',
  LIVEKIT_API_SECRET: 'configured-secret-at-least-32-characters',
};

describe('NPC LiveKit credentials', () => {
  it('preserves configured credentials exactly', () => {
    expect(readLivekitCredentials({ ...configured, NODE_ENV: 'production' })).toEqual({
      apiKey: configured.LIVEKIT_API_KEY,
      apiSecret: configured.LIVEKIT_API_SECRET,
    });
  });

  it('allows defaults only in explicit development mode', () => {
    expect(readLivekitCredentials({ NODE_ENV: 'development' })).toEqual({ apiKey: 'devkey', apiSecret: 'secret' });
  });

  it.each([undefined, 'production', 'test'])('requires both credentials with NODE_ENV=%s', (mode) => {
    for (const key of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
      for (const value of [undefined, '', '   ']) {
        expect(() => readLivekitCredentials({ ...configured, NODE_ENV: mode, [key]: value })).toThrow(key);
      }
    }
  });

  it.each([
    ['LIVEKIT_API_KEY', 'devkey'],
    ['LIVEKIT_API_SECRET', 'secret'],
  ])('rejects the public %s placeholder outside development', (key, value) => {
    expect(() => readLivekitCredentials({ ...configured, NODE_ENV: 'production', [key]: value })).toThrow(key);
  });
});

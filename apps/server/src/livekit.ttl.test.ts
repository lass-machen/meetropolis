import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLivekitToken,
  DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  livekitTokenTtlSeconds,
  tokenTtlForAccess,
} from './livekit.js';

/**
 * LiveKit cannot revoke an issued token, so its lifetime bounds how long a
 * user who lost access could rejoin a call with a cached token. The SDK default
 * was 6 h; the server now sets an explicit lifetime.
 */

function lifetimeOf(jwt: string): number {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    exp: number;
    nbf: number;
  };
  return payload.exp - payload.nbf;
}

describe('LiveKit token lifetime', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to 15 minutes', () => {
    expect(DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS).toBe(900);
    expect(livekitTokenTtlSeconds({})).toBe(900);
  });

  it('accepts an override between one minute and one day', () => {
    expect(livekitTokenTtlSeconds({ LIVEKIT_TOKEN_TTL_SECONDS: '120' })).toBe(120);
    expect(livekitTokenTtlSeconds({ LIVEKIT_TOKEN_TTL_SECONDS: '30' })).toBe(900);
    expect(livekitTokenTtlSeconds({ LIVEKIT_TOKEN_TTL_SECONDS: '172800' })).toBe(900);
    expect(livekitTokenTtlSeconds({ LIVEKIT_TOKEN_TTL_SECONDS: 'soon' })).toBe(900);
  });

  it('signs tokens with that lifetime instead of the SDK default of 6 hours', async () => {
    // The SDK stamps exp and nbf from two separate clock reads, so a second
    // boundary between them yields 899. A frozen clock keeps both reads equal.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.999Z'));
    try {
      vi.stubEnv('LIVEKIT_API_KEY', 'test-key');
      vi.stubEnv('LIVEKIT_API_SECRET', 'test-secret-with-enough-length-0123456789');
      const jwt = await createLivekitToken({ roomName: 'acme:main', identity: 'user-1' });
      expect(lifetimeOf(jwt)).toBe(900);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps a guest token at the end of the guest access', async () => {
    vi.stubEnv('LIVEKIT_API_KEY', 'test-key');
    vi.stubEnv('LIVEKIT_API_SECRET', 'test-secret-with-enough-length-0123456789');
    const accessExpiresAt = new Date(Date.now() + 120_000);
    const jwt = await createLivekitToken({ roomName: 'acme:main', identity: 'guest-1', accessExpiresAt });
    expect(lifetimeOf(jwt)).toBeGreaterThanOrEqual(118);
    expect(lifetimeOf(jwt)).toBeLessThanOrEqual(120);
  });

  it('never lets a guest token outlive the guest access', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(tokenTtlForAccess(null, now)).toBe(900);
    expect(tokenTtlForAccess(new Date('2026-11-06T12:05:00Z'), now)).toBe(300);
    expect(tokenTtlForAccess(new Date('2026-11-07T12:00:00Z'), now)).toBe(900);
    expect(tokenTtlForAccess(new Date('2026-11-06T11:59:00Z'), now)).toBe(1);
  });
});

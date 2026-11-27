import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('LiveKit endpoint configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NPC_SERVICE_SECRET', 'npc-config-test-secret-at-least-32-characters');
    vi.stubEnv('LIVEKIT_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LIVEKIT_API_KEY', 'npc-config-test-key');
    vi.stubEnv('LIVEKIT_API_SECRET', 'npc-config-test-secret-at-least-32-characters');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('defaults to the host endpoint used by the self-host stack', async () => {
    const { config } = await import('./config.js');
    expect(config.livekitUrl).toBe('ws://host.docker.internal:7880');
  });

  it('uses an explicitly configured endpoint', async () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://livekit.example.com');
    const { config } = await import('./config.js');
    expect(config.livekitUrl).toBe('wss://livekit.example.com');
  });

  it.each(['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'])('requires %s in production', async (key) => {
    vi.stubEnv(key, undefined);
    await expect(import('./config.js')).rejects.toThrow(key);
  });

  it.each([
    ['LIVEKIT_API_KEY', 'devkey'],
    ['LIVEKIT_API_SECRET', 'secret'],
  ])('rejects the public %s placeholder in production', async (key, value) => {
    vi.stubEnv(key, value);
    await expect(import('./config.js')).rejects.toThrow(key);
  });

  it('allows public defaults only in explicit development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LIVEKIT_API_KEY', undefined);
    vi.stubEnv('LIVEKIT_API_SECRET', undefined);
    const { config } = await import('./config.js');
    expect(config.livekitApiKey).toBe('devkey');
    expect(config.livekitApiSecret).toBe('secret');
  });
});

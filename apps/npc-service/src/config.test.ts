import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('LiveKit endpoint configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NPC_SERVICE_SECRET', 'npc-config-test-secret-at-least-32-characters');
    vi.stubEnv('LIVEKIT_URL', '');
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
});

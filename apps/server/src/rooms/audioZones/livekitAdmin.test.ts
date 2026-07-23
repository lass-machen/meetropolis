import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const listParticipantsMock = vi.fn();
const updateSubscriptionsMock = vi.fn();

vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    listParticipants = listParticipantsMock;
    updateSubscriptions = updateSubscriptionsMock;
  },
}));

import { mapLivekitUrlToHttp, createLivekitAdminClient } from './livekitAdmin.js';

describe('mapLivekitUrlToHttp', () => {
  it('maps wss:// to https://', () => {
    expect(mapLivekitUrlToHttp('wss://livekit.meetropolis.me')).toBe('https://livekit.meetropolis.me');
  });

  it('maps ws:// to http://', () => {
    expect(mapLivekitUrlToHttp('ws://livekit:7880')).toBe('http://livekit:7880');
  });

  it('passes through an already-http(s) URL unchanged', () => {
    expect(mapLivekitUrlToHttp('https://livekit.meetropolis.me')).toBe('https://livekit.meetropolis.me');
  });
});

describe('createLivekitAdminClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    listParticipantsMock.mockReset();
    updateSubscriptionsMock.mockReset();
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_URL = 'ws://livekit:7880';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns null when credentials are not configured (fail-closed: reconciler disabled, no widening)', () => {
    delete process.env.LIVEKIT_API_KEY;
    expect(createLivekitAdminClient()).toBeNull();
  });

  it('returns a working client that forwards listParticipants', async () => {
    listParticipantsMock.mockResolvedValueOnce([{ identity: 'alice' }]);
    const client = createLivekitAdminClient();
    expect(client).not.toBeNull();
    const participants = await client!.listParticipants('acme:world');
    expect(participants).toEqual([{ identity: 'alice' }]);
    expect(listParticipantsMock).toHaveBeenCalledWith('acme:world');
  });

  it('retries a failing call before eventually resolving', async () => {
    listParticipantsMock.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce([]);
    const client = createLivekitAdminClient({ attempts: 3, baseDelayMs: 0 });
    const result = await client!.listParticipants('acme:world');
    expect(result).toEqual([]);
    expect(listParticipantsMock).toHaveBeenCalledTimes(2);
  });

  it('rejects (does not silently succeed) once every retry attempt is exhausted', async () => {
    listParticipantsMock.mockRejectedValue(new Error('down'));
    const client = createLivekitAdminClient({ attempts: 2, baseDelayMs: 0 });
    await expect(client!.listParticipants('acme:world')).rejects.toThrow('down');
    expect(listParticipantsMock).toHaveBeenCalledTimes(2);
  });

  it('forwards updateSubscriptions(subscribe=false) verbatim', async () => {
    updateSubscriptionsMock.mockResolvedValueOnce(undefined);
    const client = createLivekitAdminClient();
    await client!.updateSubscriptions('acme:world', 'outsider', ['track-1', 'track-2'], false);
    expect(updateSubscriptionsMock).toHaveBeenCalledWith('acme:world', 'outsider', ['track-1', 'track-2'], false);
  });
});

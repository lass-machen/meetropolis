import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { joinLivekitRoom } from './livekit';

// Mock fetch for token retrieval
const originalFetch = global.fetch;

// Mock livekit-client's Room to observe connect calls
vi.mock('livekit-client', () => {
  class Room {
    public connect = vi.fn(async (_url: string, _token: string, _opts: any) => {});
    public disconnect = vi.fn(async (_stopTracks?: boolean) => {});
  }
  return { Room };
});

describe('joinLivekitRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn((): Promise<any> => {
      return Promise.resolve({
        ok: true,
        text: () => 'test-token',
      });
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('connects without waiting for a user gesture and registers no gesture listeners', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const remSpy = vi.spyOn(window, 'removeEventListener');

    const room = await joinLivekitRoom({
      baseUrl: 'http://localhost:2568',
      tokenEndpoint: '/livekit/token',
      roomName: 'world',
      identity: 'me',
      displayName: 'Me',
      useVideo: true,
    });

    // Room was built and connect was called exactly once
    const anyRoom: any = room as any;
    expect(typeof anyRoom.connect).toBe('function');
    expect(anyRoom.connect).toHaveBeenCalledTimes(1);

    // No gesture listeners (pointerdown/click/keydown/touchstart) were registered
    const calls = addSpy.mock.calls.map((args) => args[0]);
    expect(calls.filter((ev) => ['pointerdown', 'click', 'keydown', 'touchstart'].includes(ev as any)).length).toBe(0);

    addSpy.mockRestore();
    remSpy.mockRestore();
  });

  it('throws livekit_token_timeout when the token fetch hangs', async () => {
    vi.useFakeTimers();

    // fetch that never resolves but honors AbortSignal.
    global.fetch = vi.fn((_url: any, init?: any) => {
      return new Promise((_resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (signal) {
          if (signal.aborted) {
            const err: Error = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          signal.addEventListener('abort', () => {
            const err: Error = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }) as any;

    const joinPromise = joinLivekitRoom({
      baseUrl: 'http://localhost:2568',
      tokenEndpoint: '/livekit/token',
      roomName: 'world',
      identity: 'me',
      displayName: 'Me',
      useVideo: true,
    });

    // Swallow rejection so unhandled rejection warnings don't pollute the run.
    const handled = joinPromise.catch((e) => e);

    // Advance past the default 10s token timeout.
    await vi.advanceTimersByTimeAsync(10_001);

    const err = await handled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('livekit_token_timeout');
  });
});

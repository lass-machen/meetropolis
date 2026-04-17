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
    global.fetch = vi.fn(async () => {
      return {
        ok: true,
        text: async () => 'test-token',
      } as any;
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch as any;
    vi.useRealTimers();
  });

  it('verbindet ohne Nutzer-Gesten-Wartebedingung und registriert keine Gesture-Listener', async () => {
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

    // Room wurde gebaut und connect wurde genau einmal aufgerufen
    const anyRoom: any = room as any;
    expect(typeof anyRoom.connect).toBe('function');
    expect(anyRoom.connect).toHaveBeenCalledTimes(1);

    // Es wurden keine Gesture-Listener (pointerdown/click/keydown/touchstart) registriert
    const calls = addSpy.mock.calls.map(args => args[0]);
    expect(calls.filter((ev) => ['pointerdown','click','keydown','touchstart'].includes(ev as any)).length).toBe(0);

    addSpy.mockRestore();
    remSpy.mockRestore();
  });

  it('wirft livekit_token_timeout wenn der Token-Fetch hängt', async () => {
    vi.useFakeTimers();

    // fetch that never resolves but honors AbortSignal.
    global.fetch = vi.fn((_url: any, init?: any) => {
      return new Promise((_resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (signal) {
          if (signal.aborted) {
            const err: any = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          signal.addEventListener('abort', () => {
            const err: any = new Error('aborted');
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



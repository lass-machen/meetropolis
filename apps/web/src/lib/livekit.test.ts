import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { joinLivekitRoom } from './livekit';

// Mock fetch for token retrieval
const originalFetch = global.fetch;

// Mock livekit-client's Room to observe connect calls
vi.mock('livekit-client', () => {
  class Room {
    public connect = vi.fn(async (_url: string, _token: string, _opts: any) => {});
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
});



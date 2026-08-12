import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type express from 'express';
import type { MobilePlayer, MobileServerEvent } from './protocol.js';

/**
 * The bridge is replaced wholesale: these tests are about the shaping between
 * world state and the SSE stream, not about Colyseus. `emit` is captured so a
 * test can push roster frames at any rate it likes.
 */
let capturedEmit: ((event: MobileServerEvent) => void) | null = null;
const bridgeSend = vi.fn();
const bridgeConnect = vi.fn(async () => {});
const bridgeDispose = vi.fn(async () => {});

vi.mock('./worldBridge.js', () => ({
  WorldBridge: class {
    constructor(options: { emit: (event: MobileServerEvent) => void }) {
      capturedEmit = options.emit;
    }
    connect = bridgeConnect;
    send = bridgeSend;
    dispose = bridgeDispose;
  },
}));

const { MobileSession, rosterSignature } = await import('./mobileSession.js');

interface FakeResponse {
  headers: Record<string, string>;
  chunks: string[];
  ended: boolean;
}

function fakeRes(): express.Response & FakeResponse {
  const state: FakeResponse = { headers: {}, chunks: [], ended: false };
  return {
    ...state,
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
    flushHeaders() {},
    write(chunk: string) {
      state.chunks.push(chunk);
      return true;
    },
    end() {
      state.ended = true;
    },
    get chunksRef() {
      return state.chunks;
    },
    headers: state.headers,
    chunks: state.chunks,
  } as unknown as express.Response & FakeResponse;
}

function makeSession(res: express.Response) {
  return new MobileSession({
    sessionId: 'sess-abc',
    userId: 'user-1',
    identity: 'user-1',
    serverUrl: 'http://127.0.0.1:2567',
    authToken: 'jwt',
    zonePrivacyVersion: 1,
    res,
  });
}

function player(overrides: Partial<MobilePlayer> = {}): MobilePlayer {
  return {
    id: 'sess-1',
    identity: 'user-2',
    name: 'Ada',
    x: 0,
    y: 0,
    dnd: false,
    avatarId: 'av-1',
    isNpc: false,
    mapId: 'map-1',
    mapName: 'Office',
    ...overrides,
  };
}

function parseEvents(chunks: string[]): MobileServerEvent[] {
  return chunks
    .filter((c) => c.startsWith('data: '))
    .map((c) => JSON.parse(c.slice('data: '.length).trim()) as MobileServerEvent);
}

beforeEach(() => {
  vi.useFakeTimers();
  capturedEmit = null;
  bridgeSend.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MobileSession SSE framing', () => {
  it('sets the headers an SSE stream needs, including no-transform', () => {
    const res = fakeRes();
    makeSession(res);
    // Without `no-transform` the global compression() middleware buffers the
    // stream and the client receives nothing until the response ends.
    expect(res.headers['Cache-Control']).toContain('no-transform');
    expect(res.headers['Content-Type']).toContain('text/event-stream');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
  });

  it('sends the session frame first so the app learns its session id', () => {
    const res = fakeRes();
    makeSession(res);
    const events = parseEvents(res.chunks);
    expect(events[0]).toMatchObject({ type: 'session', sessionId: 'sess-abc', identity: 'user-1' });
  });
});

describe('MobileSession roster coalescing', () => {
  it('forwards the first roster frame after the throttle window', () => {
    const res = fakeRes();
    makeSession(res);
    capturedEmit?.({ type: 'roster', players: [player()] });
    vi.advanceTimersByTime(600);

    const rosters = parseEvents(res.chunks).filter((e) => e.type === 'roster');
    expect(rosters).toHaveLength(1);
  });

  it('collapses a burst of identical states into nothing', () => {
    const res = fakeRes();
    makeSession(res);
    capturedEmit?.({ type: 'roster', players: [player()] });
    vi.advanceTimersByTime(600);
    for (let i = 0; i < 20; i++) capturedEmit?.({ type: 'roster', players: [player()] });
    vi.advanceTimersByTime(600);

    const rosters = parseEvents(res.chunks).filter((e) => e.type === 'roster');
    expect(rosters).toHaveLength(1);
  });

  it('collapses a burst of changing states into one frame per window', () => {
    const res = fakeRes();
    makeSession(res);
    for (let i = 0; i < 20; i++) capturedEmit?.({ type: 'roster', players: [player({ x: i * 40 })] });
    vi.advanceTimersByTime(600);

    const rosters = parseEvents(res.chunks).filter((e) => e.type === 'roster');
    expect(rosters).toHaveLength(1);
    // The newest state wins, so a dropped frame never leaves the app behind.
    expect((rosters[0] as { players: MobilePlayer[] }).players[0].x).toBe(19 * 40);
  });

  it('passes zone permissions straight through without throttling', () => {
    const res = fakeRes();
    makeSession(res);
    // Privacy boundaries must not sit in a queue behind presence updates.
    capturedEmit?.({ type: 'zone_permissions', islandId: 'map-1:zone:kitchen', allow: ['user-2'] });
    capturedEmit?.({ type: 'zone_permissions', islandId: 'map-1:zone:hall', allow: [] });

    const perms = parseEvents(res.chunks).filter((e) => e.type === 'zone_permissions');
    expect(perms).toHaveLength(2);
  });
});

describe('rosterSignature', () => {
  it('ignores sub-tile jitter', () => {
    expect(rosterSignature([player({ x: 100, y: 100 })])).toBe(rosterSignature([player({ x: 102, y: 101 })]));
  });

  it('reacts to a move large enough to cross a zone border', () => {
    expect(rosterSignature([player({ x: 100 })])).not.toBe(rosterSignature([player({ x: 400 })]));
  });

  it('reacts to a DND change', () => {
    expect(rosterSignature([player({ dnd: false })])).not.toBe(rosterSignature([player({ dnd: true })]));
  });

  it('reacts to someone joining or leaving', () => {
    expect(rosterSignature([player()])).not.toBe(rosterSignature([player(), player({ identity: 'user-3' })]));
  });

  it('is independent of iteration order', () => {
    const a = player({ identity: 'user-2' });
    const b = player({ identity: 'user-3' });
    expect(rosterSignature([a, b])).toBe(rosterSignature([b, a]));
  });
});

describe('MobileSession action translation', () => {
  it('maps app actions onto the world room message names', () => {
    const res = fakeRes();
    const session = makeSession(res);

    session.handleAction({ type: 'move', x: 10, y: 20, direction: 'left' });
    session.handleAction({ type: 'dnd', dnd: true });
    session.handleAction({ type: 'avatar', avatarId: 'av-9' });
    session.handleAction({ type: 'change_map', mapId: 'map-2' });
    session.handleAction({ type: 'heartbeat' });

    expect(bridgeSend.mock.calls).toEqual([
      ['move', { x: 10, y: 20, direction: 'left' }],
      ['dnd_status', { dnd: true }],
      ['avatar_change', { avatarId: 'av-9' }],
      ['change_map', { mapId: 'map-2' }],
      ['heartbeat'],
    ]);
  });

  it('defaults the direction when the app omits it', () => {
    const res = fakeRes();
    makeSession(res).handleAction({ type: 'move', x: 1, y: 2 });
    expect(bridgeSend).toHaveBeenCalledWith('move', { x: 1, y: 2, direction: 'down' });
  });
});

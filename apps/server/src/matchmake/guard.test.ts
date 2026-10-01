/**
 * Matchmake guard (body cap, media type, per-IP rate limit) against a REAL
 * Colyseus server, wired as in index.ts (see testUtils/matchmakeHarness.ts).
 * A refused request must reach neither a room nor a PrismaClient; both are
 * counted through the mocked `createPrismaClient`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createPrismaClientMock = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ createPrismaClient: createPrismaClientMock }));

import {
  disposeAllRooms,
  makeFakePrisma,
  matchmake,
  rawPost,
  startMatchmakeServer,
  stopMatchmakeServer,
  worldRooms,
  type MatchmakeTestServer,
} from '../testUtils/matchmakeHarness.js';
import { MATCHMAKE_BODY_LIMIT_BYTES, isMatchmakeRequest } from './guard.js';

describe('isMatchmakeRequest', () => {
  it.each([
    ['POST', '/matchmake/joinOrCreate/world'],
    ['POST', '/matchmake/joinOrCreate/world?x=1'],
    ['GET', '/matchmake/anything'],
    ['POST', '//matchmake/joinOrCreate/world'],
    ['POST', '/Matchmake/joinOrCreate/world'],
  ])('guards %s %s', (method, url) => {
    expect(isMatchmakeRequest({ method, url })).toBe(true);
  });

  it.each([
    ['OPTIONS', '/matchmake/joinOrCreate/world'],
    ['POST', '/'],
    ['GET', '/healthz'],
    ['POST', '/api/matchmaker'],
    ['POST', '/me/matchmake/x'],
  ])('leaves %s %s alone', (method, url) => {
    expect(isMatchmakeRequest({ method, url })).toBe(false);
  });
});

describe('matchmake guard: body and media type', () => {
  let server: MatchmakeTestServer;

  beforeAll(async () => {
    createPrismaClientMock.mockImplementation(makeFakePrisma);
    // The budget is not under test here; keep it out of the way.
    vi.stubEnv('RATE_LIMIT_MATCHMAKE_MAX', '100000');
    server = await startMatchmakeServer();
  });

  afterAll(async () => {
    await stopMatchmakeServer(server);
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await disposeAllRooms();
    createPrismaClientMock.mockClear();
  });

  it('refuses an oversized tenant with 413 and builds no room and no PrismaClient', async () => {
    const res = await matchmake(server, JSON.stringify({ tenant: 'a'.repeat(900 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ code: 413, error: 'payload_too_large' });
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('cuts off a multi-megabyte tenant without building anything', async () => {
    // The server answers 413 and closes the connection while the client is
    // still writing, so the client sees either the 413 or a reset.
    const outcome = await matchmake(server, JSON.stringify({ tenant: 'a'.repeat(30 * 1024 * 1024) })).then(
      (res) => res.status,
      (error: unknown) => (error instanceof TypeError ? 'reset' : 'other'),
    );
    expect([413, 'reset']).toContain(outcome);
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('refuses an oversized chunked body that declares no Content-Length', async () => {
    const status = await rawPost(server, { 'content-type': 'application/json' }, (req) => {
      req.write('{"tenant":"');
      for (let i = 0; i < 4; i++) req.write('a'.repeat(MATCHMAKE_BODY_LIMIT_BYTES));
      req.end('"}');
    });
    expect(status).toBe(413);
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('accepts a body right at the limit and refuses one byte more', async () => {
    const skeleton = JSON.stringify({ tenant: 'acme', pad: '' }).length;
    const atLimit = JSON.stringify({ tenant: 'acme', pad: 'x'.repeat(MATCHMAKE_BODY_LIMIT_BYTES - skeleton) });
    expect(atLimit.length).toBe(MATCHMAKE_BODY_LIMIT_BYTES);
    expect((await matchmake(server, atLimit)).status).toBe(200);
    expect((await matchmake(server, atLimit.replace('"}', 'x"}'))).status).toBe(413);
  });

  it('refuses a body that is not JSON before Colyseus reads it', async () => {
    const res = await matchmake(server, 'tenant=acme', { headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('unsupported_media_type');
    expect(await worldRooms()).toHaveLength(0);
  });

  it('answers malformed JSON with 400 instead of a server error', async () => {
    const res = await matchmake(server, '{"tenant":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('lets a refusal be read cross-origin', async () => {
    const res = await matchmake(server, JSON.stringify({ tenant: 'a'.repeat(100 * 1024) }), {
      headers: { origin: 'https://app.example' },
    });
    expect(res.status).toBe(413);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  it('keeps a normal join working, including its CORS headers', async () => {
    const body = JSON.stringify({
      identity: 'user-1',
      name: 'Ada',
      tenant: 'acme',
      x: 10,
      y: 20,
      direction: 'down',
      zonePrivacyVersion: 2,
    });
    const res = await matchmake(server, body, { headers: { origin: 'https://app.example' } });
    expect(res.status).toBe(200);
    expect(res.body.roomId).toBeTruthy();
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
    expect(await worldRooms()).toHaveLength(1);
  });

  it('leaves every other route to the Express app', async () => {
    const res = await fetch(`${server.base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('does not touch CORS preflights', async () => {
    const res = await fetch(`${server.base}/matchmake/joinOrCreate/world`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(204);
  });
});

describe('matchmake guard: rate limit', () => {
  beforeEach(() => {
    createPrismaClientMock.mockImplementation(makeFakePrisma);
    createPrismaClientMock.mockClear();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('refuses requests beyond the per-IP budget with 429 and lets other addresses through', async () => {
    vi.stubEnv('RATE_LIMIT_MATCHMAKE_MAX', '5');
    // One trusted proxy hop: the client address is the right-most
    // X-Forwarded-For entry, the one that proxy appended.
    const server = await startMatchmakeServer({ trustProxy: 1 });
    try {
      const body = JSON.stringify({ tenant: 'acme' });
      const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });
      for (let i = 0; i < 5; i++) {
        expect((await matchmake(server, body, from('203.0.113.7'))).status).toBe(200);
      }
      const limited = await matchmake(server, body, from('203.0.113.7'));
      expect(limited.status).toBe(429);
      expect(limited.body).toEqual({ code: 429, error: 'rate_limited' });
      expect(limited.headers.get('retry-after')).toBeTruthy();
      expect(limited.headers.get('access-control-allow-origin')).toBeTruthy();

      // Another client behind the same proxy has its own budget.
      expect((await matchmake(server, body, from('203.0.113.8'))).status).toBe(200);
      // Prepending a forged address does not move the key off the real one.
      expect((await matchmake(server, body, from('198.51.100.1, 203.0.113.7'))).status).toBe(429);

      // A preflight is not counted.
      const preflight = await fetch(`${server.base}/matchmake/joinOrCreate/world`, {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' },
      });
      expect(preflight.status).toBe(204);
    } finally {
      await stopMatchmakeServer(server);
    }
  });

  it('does not build a room or a PrismaClient for a request it refuses', async () => {
    vi.stubEnv('RATE_LIMIT_MATCHMAKE_MAX', '1');
    const server = await startMatchmakeServer();
    try {
      // 'fresh-tenant' would need a new room; the budget is used up first.
      expect((await matchmake(server, JSON.stringify({ tenant: 'first' }))).status).toBe(200);
      createPrismaClientMock.mockClear();
      expect((await matchmake(server, JSON.stringify({ tenant: 'fresh-tenant' }))).status).toBe(429);
      expect(createPrismaClientMock).not.toHaveBeenCalled();
      expect((await worldRooms()).map((r) => r.metadata?.tenant)).toEqual(['first']);
    } finally {
      await stopMatchmakeServer(server);
    }
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    vi.stubEnv('RATE_LIMIT_MATCHMAKE_MAX', '3');
    const server = await startMatchmakeServer({ trustProxy: false });
    try {
      const body = JSON.stringify({ tenant: 'acme' });
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await matchmake(server, body, { headers: { 'x-forwarded-for': `203.0.113.${i}` } })).status);
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
    } finally {
      await stopMatchmakeServer(server);
    }
  });

  it('leaves normal use untouched under the default budget', async () => {
    vi.unstubAllEnvs();
    const server = await startMatchmakeServer();
    try {
      // Many tabs and reconnects from one address, all inside a minute.
      const body = JSON.stringify({ tenant: 'acme', identity: 'user-1', zonePrivacyVersion: 2 });
      const statuses = new Set<number>();
      for (let i = 0; i < 100; i++) statuses.add((await matchmake(server, body)).status);
      expect([...statuses]).toEqual([200]);
    } finally {
      await stopMatchmakeServer(server);
    }
  });

  it('is switched off by RATE_LIMIT_ENABLED=false like every other limiter', async () => {
    vi.stubEnv('RATE_LIMIT_ENABLED', 'false');
    vi.stubEnv('RATE_LIMIT_MATCHMAKE_MAX', '1');
    const server = await startMatchmakeServer();
    try {
      const body = JSON.stringify({ tenant: 'acme' });
      for (let i = 0; i < 4; i++) expect((await matchmake(server, body)).status).toBe(200);
    } finally {
      await stopMatchmakeServer(server);
    }
  });
});

/**
 * Matchmake guard (body cap, media type, per-IP rate limit) against a REAL
 * Colyseus server, wired as in index.ts (see testUtils/matchmakeHarness.ts).
 * A refused request must reach neither a room nor a PrismaClient; both are
 * counted through the mocked `createPrismaClient`.
 */
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createPrismaClientMock = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ createPrismaClient: createPrismaClientMock }));

import { logger } from '../logger.js';
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
import {
  MATCHMAKE_BODY_LIMIT_BYTES,
  REFUSED_BODY_DRAIN_BYTES,
  REFUSED_BODY_DRAIN_MS,
  createMatchmakeGuard,
  isInProcessCaller,
  isLoopbackAddress,
  isMatchmakeRequest,
} from './guard.js';

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

  it('delivers the 413 every time to a client that is still uploading', async () => {
    // Closing the connection with request data unread made the kernel send a reset
    // that could beat the 413 to the client: about one in five 900 KB uploads
    // ended in `write EPIPE` / `write ECONNRESET` instead (50 in a row passed
    // by luck about once in 100,000 runs).
    const body = JSON.stringify({ tenant: 'a'.repeat(900 * 1024) });
    const outcomes = new Set<number | string>();
    for (let i = 0; i < 50; i++) {
      outcomes.add(
        await matchmake(server, body).then(
          (res) => res.status,
          (error: unknown) => `reset (${String((error as { cause?: { code?: string } }).cause?.code)})`,
        ),
      );
    }
    expect([...outcomes]).toEqual([413]);
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

  it('refuses a prototype key in the body, through the whole chain, without building anything', async () => {
    const res = await matchmake(server, '{"__proto__":{"tenant":"zz-evil-1"}}');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 400, error: 'invalid_options' });
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  describe('a compressed body', () => {
    const join = JSON.stringify({ tenant: 'default', identity: 'u1' });
    const gzipped = gzipSync(join);
    const brotlied = brotliCompressSync(join);

    beforeEach(() => {
      vi.mocked(logger.error).mockClear();
    });

    it.each([
      ['gzip that is no gzip', 'gzip', Buffer.from('this is not gzip data at all')],
      ['gzip cut off before its end', 'gzip', gzipped.subarray(0, gzipped.length - 6)],
      [
        'gzip with a flipped byte inside',
        'gzip',
        Buffer.concat([gzipped.subarray(0, 12), Buffer.from([0xff]), gzipped.subarray(13)]),
      ],
      ['deflate that is no deflate', 'deflate', Buffer.from('this is not deflate data at all')],
      ['deflate cut off before its end', 'deflate', deflateSync(join).subarray(0, 4)],
      // Brotli reports other codes than zlib: each of these is a different one
      // (ERR__ERROR_FORMAT_PADDING_1, Z_BUF_ERROR, ERR__ERROR_FORMAT_CL_SPACE, ERR__ERROR_FORMAT_PADDING_2).
      ['brotli that is no brotli', 'br', Buffer.from('this is not brotli data at all, really')],
      ['brotli cut off before its end', 'br', brotlied.subarray(0, brotlied.length - 3)],
      ['brotli of zero bytes', 'br', Buffer.alloc(40, 0)],
      ['brotli of 0xff bytes', 'br', Buffer.alloc(40, 0xff)],
    ])('answers %s with 400, not a server error, and does not log an error for it', async (_label, encoding, body) => {
      const res = await matchmake(server, body, { headers: { 'content-encoding': encoding } });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ code: 400, error: 'invalid_encoding' });
      expect(logger.error).not.toHaveBeenCalled();
      expect(await worldRooms()).toHaveLength(0);
      expect(createPrismaClientMock).not.toHaveBeenCalled();
    });

    it.each([
      ['gzip', 'gzip', gzipped],
      ['deflate', 'deflate', deflateSync(join)],
      ['brotli', 'br', brotlied],
    ])('still joins with a valid %s body', async (_label, encoding, body) => {
      const res = await matchmake(server, body, { headers: { 'content-encoding': encoding } });
      expect(res.status).toBe(200);
      expect(res.body.roomId).toBeTruthy();
    });

    it('still refuses a compression bomb by its size once inflated', async () => {
      const res = await matchmake(
        server,
        gzipSync(JSON.stringify({ tenant: 'a'.repeat(MATCHMAKE_BODY_LIMIT_BYTES * 8) })),
        {
          headers: { 'content-encoding': 'gzip' },
        },
      );
      expect(res.status).toBe(413);
      expect(await worldRooms()).toHaveLength(0);
    });
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

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1'])(
    'knows %s as loopback',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(true);
    },
  );

  it.each([
    '10.0.0.1',
    '172.29.0.4',
    '172.29.0.1',
    '192.168.1.5',
    '128.0.0.1',
    '126.255.255.255',
    '203.0.113.7',
    '::ffff:172.29.0.4',
    '2001:db8::1',
    'fe80::1',
    '::',
    '0.0.0.0',
    'localhost',
    '127.0.0.1.evil.example',
    '127.0.0.1, 203.0.113.7',
    ' 127.0.0.1',
    '',
    undefined,
  ])('does not know %j as loopback', (address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });
});

describe('isInProcessCaller', () => {
  const from = (remoteAddress: string | undefined, headers: Record<string, string> = {}) => ({
    socket: { remoteAddress } as http.IncomingMessage['socket'],
    headers,
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'counts a loopback socket without proxy headers (%s)',
    (address) => {
      expect(isInProcessCaller(from(address))).toBe(true);
      // Ordinary request headers do not matter.
      expect(isInProcessCaller(from(address, { host: '127.0.0.1:2567', 'content-type': 'application/json' }))).toBe(
        true,
      );
    },
  );

  it.each(['203.0.113.7', '172.29.0.4', '10.0.0.5', '::ffff:172.29.0.4', undefined])(
    'does not count a socket that is not loopback (%s), however it is dressed up',
    (address) => {
      expect(isInProcessCaller(from(address))).toBe(false);
      expect(isInProcessCaller(from(address, { 'x-forwarded-for': '127.0.0.1' }))).toBe(false);
      expect(isInProcessCaller(from(address, { forwarded: 'for=127.0.0.1' }))).toBe(false);
      expect(isInProcessCaller(from(address, { 'x-real-ip': '127.0.0.1' }))).toBe(false);
    },
  );

  it.each(['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-client-ip', 'x-forwarded-host', 'x-forwarded-proto'])(
    'does not count a loopback socket that carries %s: a proxy on the same host is no in-process caller',
    (header) => {
      expect(isInProcessCaller(from('127.0.0.1', { [header]: '203.0.113.7' }))).toBe(false);
    },
  );
});

describe('matchmake guard: in-process callers and the rate limit', () => {
  beforeEach(() => {
    createPrismaClientMock.mockImplementation(makeFakePrisma);
    createPrismaClientMock.mockClear();
    vi.stubEnv('RATE_LIMIT_MATCHMAKE_MAX', '3');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('does not count a caller on the loopback interface, as the mobile gateway is one', async () => {
    const server = await startMatchmakeServer({ loopbackExempt: true });
    try {
      // What the gateway sends: the SDK's plain POST, no proxy header.
      const body = JSON.stringify({ tenant: 'default', zonePrivacyVersion: 2 });
      const statuses = new Set<number>();
      for (let i = 0; i < 40; i++) statuses.add((await matchmake(server, body)).status);
      expect([...statuses]).toEqual([200]);
    } finally {
      await stopMatchmakeServer(server);
    }
  });

  it('still limits a loopback caller that forwards a client address, a same-host proxy', async () => {
    const server = await startMatchmakeServer({ loopbackExempt: true, trustProxy: 1 });
    try {
      const body = JSON.stringify({ tenant: 'default' });
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await matchmake(server, body, { headers: { 'x-forwarded-for': '203.0.113.7' } })).status);
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
    } finally {
      await stopMatchmakeServer(server);
    }
  });

  it('does not let a forged X-Forwarded-For: 127.0.0.1 buy an exemption', async () => {
    for (const trustProxy of [false, 1, true]) {
      const server = await startMatchmakeServer({ loopbackExempt: true, trustProxy });
      try {
        const body = JSON.stringify({ tenant: 'default' });
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          statuses.push((await matchmake(server, body, { headers: { 'x-forwarded-for': '127.0.0.1' } })).status);
        }
        // The forged header marks the request as proxied, so it is counted.
        expect(statuses.filter((s) => s === 429).length, `trustProxy=${String(trustProxy)}`).toBeGreaterThan(0);
      } finally {
        await stopMatchmakeServer(server);
      }
    }
  });

  describe('through the real guard, with the socket address of the caller set', () => {
    // A test cannot connect from outside loopback, so the listener sets the
    // peer address the guard reads. Everything behind that is the real guard.
    async function guarded(peer: string, trustProxy: boolean | number) {
      const guard = createMatchmakeGuard((_req, res) => res.end('ok'), { trustProxy });
      const server = http.createServer((req, res) => {
        Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true });
        guard(req, res);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const post = async (headers: Record<string, string> = {}) =>
        (
          await fetch(`http://127.0.0.1:${port}/matchmake/joinOrCreate/world`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: '{}',
          })
        ).status;
      const close = () => {
        server.closeAllConnections();
        return new Promise<void>((resolve) => server.close(() => resolve()));
      };
      return { post, close };
    }

    it.each([
      ['an external peer', '203.0.113.7'],
      ['Traefik on a Docker network', '172.29.0.4'],
      ['a published port, seen as the bridge gateway', '::ffff:172.29.0.1'],
    ])('limits %s, with or without a forged X-Forwarded-For: 127.0.0.1', async (_label, peer) => {
      for (const forged of [false, true]) {
        const { post, close } = await guarded(peer, false);
        try {
          const statuses: number[] = [];
          for (let i = 0; i < 5; i++) statuses.push(await post(forged ? { 'x-forwarded-for': '127.0.0.1' } : {}));
          expect(statuses, `forged=${String(forged)}`).toEqual([200, 200, 200, 429, 429]);
        } finally {
          await close();
        }
      }
    });

    it('limits an external peer behind a trusted proxy hop by the forwarded client, not by 127.0.0.1', async () => {
      const { post, close } = await guarded('172.29.0.4', 1);
      try {
        const forged = { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' };
        expect([await post(forged), await post(forged), await post(forged), await post(forged)]).toEqual([
          200, 200, 200, 429,
        ]);
        // Another real client behind the same proxy is unaffected.
        expect(await post({ 'x-forwarded-for': '203.0.113.10' })).toBe(200);
      } finally {
        await close();
      }
    });

    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('does not limit the in-process caller %s', async (peer) => {
      const { post, close } = await guarded(peer, 1);
      try {
        const statuses = new Set<number>();
        for (let i = 0; i < 20; i++) statuses.add(await post());
        expect([...statuses]).toEqual([200]);
      } finally {
        await close();
      }
    });
  });
});

describe('matchmake guard: how much of a refused body is read', () => {
  // The real guard behind a plain HTTP server that records how many bytes each
  // connection delivered to Node, and a raw client that streams a body of the
  // size it declares for as long as the server lets it.
  async function guardServer() {
    const guard = createMatchmakeGuard((_req, res) => res.end('forwarded'), {
      trustProxy: false,
      isInProcessCaller: () => false,
    });
    const server = http.createServer((req, res) => guard(req, res));
    const bytesRead: number[] = [];
    server.on('connection', (socket) => socket.on('close', () => bytesRead.push(socket.bytesRead)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const close = () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    };
    return { port, bytesRead, close };
  }

  function rawClient(port: number, declaredBytes: number) {
    const socket = net.connect(port, '127.0.0.1');
    let received = '';
    socket.on('data', (chunk: Buffer) => (received += chunk.toString('latin1')));
    // A refusal that cuts the connection may reset it: not an error here.
    socket.on('error', () => undefined);
    socket.write(
      'POST /matchmake/joinOrCreate/world HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\n' +
        `content-length: ${declaredBytes}\r\n\r\n`,
    );
    const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
    return { socket, closed, received: () => received };
  }

  async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_MATCHMAKE_MAX', '100000');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('stops reading at the cap and cuts the connection, however much the client keeps sending', async () => {
    const { port, bytesRead, close } = await guardServer();
    try {
      const declared = 64 * 1024 * 1024;
      const { socket, closed } = rawClient(port, declared);
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      let sent = 0;
      while (!socket.destroyed && sent < declared) {
        sent += chunk.length;
        if (!socket.write(chunk))
          await new Promise<void>((resolve) => socket.once('drain', resolve).once('close', resolve));
      }
      await closed;
      await until(() => bytesRead.length > 0);
      expect(bytesRead).toHaveLength(1);
      // It did read on past the limit (that is what lets the 413 arrive) ...
      expect(bytesRead[0]).toBeGreaterThanOrEqual(REFUSED_BODY_DRAIN_BYTES);
      // ... but not much past the cap: what Node had already pulled off the wire.
      expect(bytesRead[0]).toBeLessThan(REFUSED_BODY_DRAIN_BYTES + 256 * 1024);
      expect(sent).toBeLessThan(declared);
    } finally {
      await close();
    }
  });

  it('answers 413 and keeps the connection when the body ends within the cap', async () => {
    const { port, bytesRead, close } = await guardServer();
    try {
      const declared = 512 * 1024;
      const { socket, received } = rawClient(port, declared);
      socket.write(Buffer.alloc(declared, 0x61));
      await vi.waitFor(() => expect(received()).toContain('payload_too_large'), { interval: 5, timeout: 4000 });
      expect(received()).toMatch(/^HTTP\/1\.1 413 /);
      // The rest of the body was taken off the wire and the connection stays a
      // normal one: a second request on it is parsed and answered.
      const small = '{"tenant":"a"}';
      socket.write(
        'POST /matchmake/joinOrCreate/world HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\n' +
          `content-length: ${small.length}\r\n\r\n${small}`,
      );
      await vi.waitFor(() => expect(received()).toContain('forwarded'), { interval: 5, timeout: 4000 });
      expect(socket.destroyed).toBe(false);
      expect(bytesRead).toHaveLength(0);
      socket.destroy();
    } finally {
      await close();
    }
  });

  it('cuts off a client that stalls instead of finishing its refused body', async () => {
    const { port, bytesRead, close } = await guardServer();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { socket, closed, received } = rawClient(port, 10 * 1024 * 1024);
      socket.write(Buffer.alloc(100 * 1024, 0x61));
      await vi.waitFor(() => expect(received()).toContain('payload_too_large'), { interval: 5, timeout: 4000 });
      expect(socket.destroyed).toBe(false);
      vi.advanceTimersByTime(REFUSED_BODY_DRAIN_MS);
      await closed;
      await vi.waitFor(() => expect(bytesRead).toHaveLength(1), { interval: 5, timeout: 4000 });
    } finally {
      vi.useRealTimers();
      await close();
    }
  });
});

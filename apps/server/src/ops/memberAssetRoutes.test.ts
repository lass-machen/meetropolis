/**
 * Tests for the protected member-asset delivery route (/member-assets/v1)
 * and the legacy static-asset guard. The app mounts the real router over
 * real temporary directories; only the authorization decision is mocked so
 * every status/body/header mapping is exercised without a database.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authzMocks = vi.hoisted(() => ({ authorize: vi.fn() }));

vi.mock('./memberAssetAuthorization.js', () => ({
  authorizeMemberAsset: authzMocks.authorize,
}));

import { createLegacyAssetGuard, createMemberAssetRouter, MEMBER_ASSETS_PREFIX } from './memberAssetRoutes.js';

// One transparent 1x1 PNG; the .png extension drives the Content-Type check.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PACK_UUID = '11111111-1111-1111-1111-111111111111';
const PACK_FILE_PATH = `/packs/${PACK_UUID}/file.png`;
const NPC_FILE_PATH = '/npc-media/acme/npc1/a.png';

interface Roots {
  base: string;
  packs: string;
  media: string;
}

async function makeRoots(): Promise<Roots> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'member-assets-case-'));
  const packs = path.join(base, 'packs');
  const media = path.join(base, 'media');
  await fs.mkdir(path.join(packs, PACK_UUID), { recursive: true });
  await fs.mkdir(path.join(media, 'acme', 'npc1'), { recursive: true });
  await fs.writeFile(path.join(packs, PACK_UUID, 'file.png'), PNG_BYTES);
  await fs.writeFile(path.join(media, 'acme', 'npc1', 'a.png'), PNG_BYTES);
  return { base, packs, media };
}

/** GET with the path sent byte for byte, without client-side dot-segment resolution. */
async function rawGet(
  app: express.Application,
  rawPath: string,
): Promise<{ status: number; cacheControl: string | undefined }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, cacheControl: res.headers['cache-control'] }));
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeApp(roots: Roots): express.Application {
  const app = express();
  // Express wires the app-level etag switch into every sendFile call and
  // overwrites the per-call etag option, so the no-etag assertion below
  // needs the switch off at app level.
  app.set('etag', false);
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.tenant = { id: 't1', slug: 't1', name: 'T1' } as never;
    next();
  });
  app.use(
    MEMBER_ASSETS_PREFIX,
    createMemberAssetRouter({
      prisma: {} as never,
      packsRoot: () => roots.packs,
      npcMediaRoot: () => roots.media,
    }),
  );
  return app;
}

describe('memberAssetRoutes', () => {
  const tempDirs: string[] = [];
  let roots: Roots;
  let app: express.Application;

  beforeEach(async () => {
    authzMocks.authorize.mockReset();
    roots = await makeRoots();
    tempDirs.push(roots.base);
    app = makeApp(roots);
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('serves the file for allowed with private no-store headers and no etag', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`);

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers.etag).toBeUndefined();
  });

  it('answers a byte range with 206 and the first four bytes', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`).set('Range', 'bytes=0-3');

    expect(res.status).toBe(206);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBe(4);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES.subarray(0, 4))).toBe(0);
  });

  it('answers HEAD with 200 and no body', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');

    const res = await request(app).head(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('answers unauthenticated with 401 and no image content type', async () => {
    authzMocks.authorize.mockResolvedValue('unauthenticated');

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthenticated' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).not.toContain('image/png');
  });

  it('answers forbidden with 403', async () => {
    authzMocks.authorize.mockResolvedValue('forbidden');

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers not_found with 404', async () => {
    authzMocks.authorize.mockResolvedValue('not_found');

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 503 when authorization fails with a database error', async () => {
    authzMocks.authorize.mockRejectedValue(new Error('db down'));

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([`${MEMBER_ASSETS_PREFIX}/packs/%2e%2e/x`, `${MEMBER_ASSETS_PREFIX}/packs/a/../b`])(
    'rejects the raw path %s with 404 without calling authorize',
    async (rawPath) => {
      const res = await request(app).get(rawPath);

      expect(res.status).toBe(404);
      expect(authzMocks.authorize).not.toHaveBeenCalled();
    },
  );

  it('answers 404 with the not_found body when an allowed file is missing', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}/packs/${PACK_UUID}/missing.png`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('does not follow a symlink inside the root to a file outside', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');
    const outside = path.join(roots.base, 'outside.png');
    await fs.writeFile(outside, PNG_BYTES);
    await fs.symlink(outside, path.join(roots.packs, PACK_UUID, 'link.png'));

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}/packs/${PACK_UUID}/link.png`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('passes the cookie token as rawToken to authorize', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');

    const res = await request(app)
      .get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`)
      .set('Cookie', ['auth_token=cookie-token-1']);

    expect(res.status).toBe(200);
    expect(authzMocks.authorize).toHaveBeenCalledOnce();
    expect(authzMocks.authorize.mock.calls[0]?.[1]).toMatchObject({ rawToken: 'cookie-token-1' });
  });

  it('passes the bearer token as rawToken to authorize', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');

    const res = await request(app)
      .get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`)
      .set('Authorization', 'Bearer bearer-token-1');

    expect(res.status).toBe(200);
    expect(authzMocks.authorize).toHaveBeenCalledOnce();
    expect(authzMocks.authorize.mock.calls[0]?.[1]).toMatchObject({ rawToken: 'bearer-token-1' });
  });

  it('serves files when the storage root lies below a dot directory', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');
    const dotBase = path.join(roots.base, '.data');
    const dotPacks = path.join(dotBase, 'packs');
    await fs.mkdir(path.join(dotPacks, PACK_UUID), { recursive: true });
    await fs.writeFile(path.join(dotPacks, PACK_UUID, 'file.png'), PNG_BYTES);
    const dotApp = makeApp({ base: dotBase, packs: dotPacks, media: roots.media });

    const res = await request(dotApp).get(`${MEMBER_ASSETS_PREFIX}${PACK_FILE_PATH}`);

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });

  it('serves a nested generation file with range support', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');
    const generation = '22222222-2222-2222-2222-222222222222';
    const dir = path.join(roots.packs, PACK_UUID, 'generations', generation);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'file.png'), PNG_BYTES);
    const url = `${MEMBER_ASSETS_PREFIX}/packs/${PACK_UUID}/generations/${generation}/file.png`;

    const full = await request(app).get(url);
    const range = await request(app).get(url).set('Range', 'bytes=0-3');

    expect(full.status).toBe(200);
    expect(Buffer.compare(full.body as Buffer, PNG_BYTES)).toBe(0);
    expect(range.status).toBe(206);
    expect((range.body as Buffer).length).toBe(4);
    expect(authzMocks.authorize.mock.calls[0]?.[1]?.target).toMatchObject({ kind: 'asset-pack', packUuid: PACK_UUID });
  });

  it('answers a traversal attempt through a generation directory with 404 without authorizing', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');
    // HTTP clients resolve `../` and `%2e%2e` before sending; a raw request keeps them.
    for (const rest of ['generations/../file.png', 'generations/%2e%2e/file.png', 'generations/%2E%2E/file.png']) {
      const res = await rawGet(app, `${MEMBER_ASSETS_PREFIX}/packs/${PACK_UUID}/${rest}`);
      expect({ rest, status: res.status }).toEqual({ rest, status: 404 });
      expect(res.cacheControl).toBe('no-store');
    }
    expect(authzMocks.authorize).not.toHaveBeenCalled();
  });

  it('serves the npc-media namespace for allowed', async () => {
    authzMocks.authorize.mockResolvedValue('allowed');

    const res = await request(app).get(`${MEMBER_ASSETS_PREFIX}${NPC_FILE_PATH}`);

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('createLegacyAssetGuard', () => {
  it('answers 404 with no-store when enforced', async () => {
    const app = express();
    app.use(
      '/legacy',
      createLegacyAssetGuard(() => true),
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );

    const res = await request(app).get('/legacy/some.png');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('calls next when not enforced', async () => {
    const app = express();
    app.use(
      '/legacy',
      createLegacyAssetGuard(() => false),
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );

    const res = await request(app).get('/legacy/some.png');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

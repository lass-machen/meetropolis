import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stable JWT secret so the session-auth middleware verifies the bearer tokens
// minted by `sessionBearer` below. Set at module init — before any request runs
// and thus before `getJwtSecret` caches its value.
process.env.JWT_SECRET = 'test-jwt-secret-api-v2-0123456789abcdef';

// tokenHash -> userId. Shared with the Prisma double's `session.findUnique` so a
// bearer only authenticates while a matching Session row exists (see
// api/utils/sessionAuth.ts). Hoisted so the vi.mock factory can close over it.
const { SESSIONS } = vi.hoisted(() => ({ SESSIONS: new Map<string, string>() }));

// Minimal in-memory prisma for v2 endpoints
type MapRec = {
  id: string;
  name: string;
  tenantId: string;
  meta: any;
  chunkSize?: number;
  width?: number;
  height?: number;
  tileWidth?: number;
  tileHeight?: number;
  version?: number;
};
type LayerRec = { id: string; mapId: string; name: string; chunkSize: number };
type ChunkRec = {
  id: string;
  layerId: string;
  x: number;
  y: number;
  version: number;
  encoding: string;
  data: Uint8Array;
};
type TilesetRec = {
  id: string;
  mapId: string;
  slot: number;
  key: string;
  imageUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  hash?: string;
};

const mem = {
  maps: [] as MapRec[],
  layers: [] as LayerRec[],
  chunks: [] as ChunkRec[],
  tilesets: [] as TilesetRec[],
  zones: [] as any[],
  // Membership of the seeded caller in the resolved tenant. The genuine editor
  // writes (paint, resize, rename, editor-state, zones) require owner/admin;
  // reads AND tileset registration accept any role (tileset registration runs
  // on every member's normal world load); `null` models a caller with no
  // membership in req.tenant (the cross-tenant/X-Tenant-spoof case). Individual
  // tests flip this to exercise resolveEditorMemberTenant.
  membership: { role: 'owner' } as { role: string } | null,
};

// api.ts imports PrismaClient from './generated/prisma/index.js'.
vi.mock('./generated/prisma/index.js', () => {
  class PrismaClientMock {
    map = {
      findFirst({ where }: any) {
        return (
          mem.maps.find((m) => {
            if (where.tenantId && m.tenantId !== where.tenantId) return false;
            if (where.id !== undefined && m.id !== where.id) return false;
            if (where.name !== undefined && m.name !== where.name) return false;
            return true;
          }) || null
        );
      },
      create({ data }: any) {
        const rec: MapRec = { id: `m_${Math.random().toString(36).slice(2, 8)}`, meta: {}, ...data };
        mem.maps.push(rec);
        return rec as any;
      },
      update({ where, data }: any) {
        const m = mem.maps.find((mm) => mm.id === where.id);
        if (!m) throw new Error('map not found');
        Object.assign(m, data);
        return m as any;
      },
    };
    mapLayer = {
      findMany({ where }: any) {
        return mem.layers.filter((l) => l.mapId === where.mapId) as any;
      },
      findUnique({ where }: any) {
        const { mapId, name } = where.mapId_name;
        return mem.layers.find((l) => l.mapId === mapId && l.name === name) || null;
      },
      create({ data }: any) {
        const rec: LayerRec = { id: `l_${Math.random().toString(36).slice(2, 8)}`, ...data };
        mem.layers.push(rec);
        return rec as any;
      },
    };
    mapChunk = {
      findMany({ where, select }: any) {
        const list = mem.chunks.filter(
          (c) => c.layerId === where.layerId && (!where.OR || where.OR.some((k: any) => k.x === c.x && k.y === c.y)),
        );
        if (!select) return list as any;
        return list.map((c) => ({ x: c.x, y: c.y, version: c.version, encoding: c.encoding, data: c.data })) as any;
      },
      findUnique({ where }: any) {
        const { layerId, x, y } = where.layerId_x_y;
        return mem.chunks.find((c) => c.layerId === layerId && c.x === x && c.y === y) || null;
      },
      create({ data }: any) {
        const rec: ChunkRec = { id: `c_${Math.random().toString(36).slice(2, 8)}`, ...data };
        mem.chunks.push(rec);
        return rec as any;
      },
      update({ where, data }: any) {
        const c = mem.chunks.find((cc) => cc.id === where.id);
        if (!c) throw new Error('chunk not found');
        Object.assign(c, data);
        return c as any;
      },
    };
    mapTileset = {
      findMany({ where, orderBy: _orderBy, select: _select }: any) {
        const list = mem.tilesets.filter((t) => t.mapId === where.mapId);
        list.sort((a, b) => a.slot - b.slot);
        return list.map((t) => ({
          id: t.id,
          slot: t.slot,
          key: t.key,
          imageUrl: t.imageUrl,
          tileWidth: t.tileWidth,
          tileHeight: t.tileHeight,
          margin: t.margin,
          spacing: t.spacing,
          hash: t.hash,
        })) as any;
      },
      findFirst({ where, orderBy: _orderBy }: any) {
        const list = mem.tilesets.filter((t) => t.mapId === where.mapId);
        list.sort((a, b) => b.slot - a.slot);
        return list[0] || null;
      },
      create({ data }: any) {
        const rec: TilesetRec = { id: `ts_${Math.random().toString(36).slice(2, 8)}`, ...data };
        mem.tilesets.push(rec);
        return rec as any;
      },
    };
    zone = {
      findMany({ where: _where, select: _select }: any) {
        return [] as any;
      },
      deleteMany() {
        return;
      },
      create() {
        return {} as any;
      },
    };
    tenant = {
      findUnique() {
        return { id: 't1', slug: 'default' } as any;
      },
      create({ data }: any) {
        return { id: 't1', slug: data.slug } as any;
      },
    };
    membership = {
      // Both the v2 read endpoints (resolveMemberTenant) and the editor
      // endpoints (resolveEditorMemberTenant) look up the caller's membership in
      // the resolved tenant. Driven by mem.membership so tests can model owner,
      // plain member, or a non-member (null) of 't1'.
      findUnique() {
        return mem.membership;
      },
    };
    apiToken = {
      findUnique() {
        return null;
      },
      update() {
        return;
      },
    };
    session = {
      findUnique({ where }: any) {
        const userId = SESSIONS.get(where.tokenHash);
        if (!userId) return null;
        return {
          id: `sess_${userId}`,
          userId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          lastActiveAt: new Date(),
        };
      },
      update() {
        return;
      },
    };
  }
  return { PrismaClient: PrismaClientMock };
});

import { registerApi } from './api.js';
import { hashSessionToken } from './api/utils/sessionAuth.js';

/**
 * A session-backed bearer: a JWT the session-auth middleware verifies, plus the
 * Session row (registered in SESSIONS) that keeps it authenticated. The v2 map
 * reads are membership-gated, so requests need a real authenticated identity.
 */
function sessionBearer(userId: string): string {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET as string);
  SESSIONS.set(hashSessionToken(token), userId);
  return `Bearer ${token}`;
}

async function createApp() {
  const app = express();
  app.use(cookieParser() as any);
  app.use(express.json() as any);
  app.use(express.urlencoded({ extended: true }) as any);
  // Attach a default tenant for tests
  app.use((req, _res, next) => {
    (req as any).tenant = { id: 't1', slug: 'default' };
    next();
  });
  await registerApi(app as any);
  // Seed one map and tileset registry entry
  // Map id matches route param (req.params.id) so findMapById() picks it up.
  if (!mem.maps.find((m) => m.id === 'test'))
    mem.maps.push({
      id: 'test',
      name: 'test',
      tenantId: 't1',
      meta: {},
      chunkSize: 32,
      width: 64,
      height: 64,
      tileWidth: 16,
      tileHeight: 16,
    });
  if (!mem.tilesets.find((t) => t.mapId === 'test'))
    mem.tilesets.push({
      id: 'ts1',
      mapId: 'test',
      slot: 0,
      key: 'office_tiles',
      imageUrl: '/tiles.png',
      tileWidth: 16,
      tileHeight: 16,
    });
  return app;
}

describe('v2 map editing', () => {
  beforeEach(() => {
    mem.layers = [];
    mem.chunks = [];
    mem.membership = { role: 'owner' };
  });

  it('paints a ground rect and returns chunk from /chunks', async () => {
    const app = await createApp();
    const patch = await request(app)
      .patch('/maps/test/paint-rect')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ layer: 'ground', rect: { x0: 0, y0: 0, x1: 1, y1: 0 }, tileRefId: (0 << 16) | 2 });
    expect(patch.status).toBe(200);
    const chunks = patch.body.updates;
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks[0].encoding).toBe('rle');

    const get = await request(app)
      .get('/maps/test/chunks')
      .set('Authorization', sessionBearer('u1'))
      .set('x-tenant', 'default')
      .query({ layer: 'ground', keys: '0:0' });
    expect(get.status).toBe(200);
    const payload = get.body.chunks['0:0'];
    expect(payload).toBeTruthy();
    expect(payload.encoding).toBe('rle');
    expect(typeof payload.data).toBe('string');
  });

  it('paints and erases collision using rle-bool', async () => {
    const app = await createApp();
    const setRes = await request(app)
      .patch('/maps/test/paint-rect')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ layer: 'collision', rect: { x0: 2, y0: 2, x1: 3, y1: 2 }, erase: false, tileRefId: 1 });
    expect(setRes.status).toBe(200);
    const setChunk = setRes.body.updates[0];
    expect(setChunk.encoding).toBe('rle-bool');

    const delRes = await request(app)
      .patch('/maps/test/paint-rect')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ layer: 'collision', rect: { x0: 2, y0: 2, x1: 3, y1: 2 }, erase: true });
    expect(delRes.status).toBe(200);
    const get = await request(app)
      .get('/maps/test/chunks')
      .set('Authorization', sessionBearer('u1'))
      .set('x-tenant', 'default')
      .query({ layer: 'collision', keys: '0:0' });
    expect(get.status).toBe(200);
    const payload = get.body.chunks['0:0'];
    expect(payload).toBeTruthy();
    expect(payload.encoding).toBe('rle-bool');
  });
});

/**
 * Regression coverage for the editor auth/membership gate
 * (resolveEditorMemberTenant). Before the fix, paint-rect and tileset writes
 * had no auth at all, and editor-state/zones/resize/rename authenticated but
 * never checked membership in the resolved tenant — so an X-Tenant header could
 * point the request at a foreign tenant. Each case pins one rung of the gate.
 */
describe('v2 map editor auth + membership gate', () => {
  beforeEach(() => {
    mem.layers = [];
    mem.chunks = [];
    mem.membership = { role: 'owner' };
  });

  it('rejects anonymous paint-rect with 401 (was reachable unauthenticated)', async () => {
    const app = await createApp();
    const res = await request(app)
      .patch('/maps/test/paint-rect')
      .set('x-tenant', 'default')
      .send({ layer: 'ground', rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, tileRefId: 1 });
    expect(res.status).toBe(401);
  });

  it('rejects anonymous tileset registration with 401', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/maps/test/tilesets')
      .set('x-tenant', 'default')
      .send({ key: 'k', imageUrl: '/x.png', tileWidth: 16, tileHeight: 16 });
    expect(res.status).toBe(401);
  });

  it('refuses a caller with no membership in the resolved tenant (403)', async () => {
    const app = await createApp();
    mem.membership = null;
    const res = await request(app)
      .patch('/maps/test/paint-rect')
      .set('Authorization', sessionBearer('outsider'))
      .set('x-tenant', 'default')
      .send({ layer: 'ground', rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, tileRefId: 1 });
    expect(res.status).toBe(403);
  });

  it('refuses a non-admin member on a mutating endpoint (403)', async () => {
    const app = await createApp();
    mem.membership = { role: 'member' };
    const res = await request(app)
      .patch('/maps/test/paint-rect')
      .set('Authorization', sessionBearer('member1'))
      .set('x-tenant', 'default')
      .send({ layer: 'ground', rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, tileRefId: 1 });
    expect(res.status).toBe(403);
  });

  it('lets an owner paint (200)', async () => {
    const app = await createApp();
    mem.membership = { role: 'owner' };
    const res = await request(app)
      .patch('/maps/test/paint-rect')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ layer: 'ground', rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, tileRefId: 1 });
    expect(res.status).toBe(200);
  });

  it('lets an admin register a tileset (200)', async () => {
    const app = await createApp();
    mem.membership = { role: 'admin' };
    const res = await request(app)
      .post('/maps/test/tilesets')
      .set('Authorization', sessionBearer('admin1'))
      .set('x-tenant', 'default')
      .send({ key: `k_${Math.random().toString(36).slice(2)}`, imageUrl: '/x.png', tileWidth: 16, tileHeight: 16 });
    expect(res.status).toBe(200);
  });

  // Tileset registration is NOT admin-gated: it fires from every member's
  // normal world load (useEditorLoader seeds default/pack tilesets), so a plain
  // member must be able to register. Membership is still required — that is what
  // keeps the cross-tenant hole closed (covered by the anonymous-401 and
  // no-membership-403 cases above).
  it('lets a plain member register a tileset (200)', async () => {
    const app = await createApp();
    mem.membership = { role: 'member' };
    const res = await request(app)
      .post('/maps/test/tilesets')
      .set('Authorization', sessionBearer('member1'))
      .set('x-tenant', 'default')
      .send({ key: `k_${Math.random().toString(36).slice(2)}`, imageUrl: '/x.png', tileWidth: 16, tileHeight: 16 });
    expect(res.status).toBe(200);
  });

  it('gates editor-state PUT to owner/admin (member -> 403)', async () => {
    const app = await createApp();
    mem.membership = { role: 'member' };
    const res = await request(app)
      .put('/maps/test/editor-state')
      .set('Authorization', sessionBearer('member1'))
      .set('x-tenant', 'default')
      .send({ backgroundColor: '#112233' });
    expect(res.status).toBe(403);
  });

  it('gates resize to owner/admin (member -> 403)', async () => {
    const app = await createApp();
    mem.membership = { role: 'member' };
    const res = await request(app)
      .patch('/maps/test/resize')
      .set('Authorization', sessionBearer('member1'))
      .set('x-tenant', 'default')
      .send({ width: 32, height: 32 });
    expect(res.status).toBe(403);
  });

  it('gates rename to owner/admin (member -> 403)', async () => {
    const app = await createApp();
    mem.membership = { role: 'member' };
    const res = await request(app)
      .patch('/maps/test/rename')
      .set('Authorization', sessionBearer('member1'))
      .set('x-tenant', 'default')
      .send({ newName: 'renamed' });
    expect(res.status).toBe(403);
  });

  it('requires auth for editor-state GET (anonymous -> 401)', async () => {
    const app = await createApp();
    const res = await request(app).get('/maps/test/editor-state').set('x-tenant', 'default');
    expect(res.status).toBe(401);
  });

  it('lets any member read editor-state (200)', async () => {
    const app = await createApp();
    mem.membership = { role: 'member' };
    const res = await request(app)
      .get('/maps/test/editor-state')
      .set('Authorization', sessionBearer('member1'))
      .set('x-tenant', 'default');
    expect(res.status).toBe(200);
  });

  it('requires membership to list map zones (outsider -> 403)', async () => {
    const app = await createApp();
    mem.membership = null;
    const res = await request(app)
      .get('/maps/test/zones')
      .set('Authorization', sessionBearer('outsider'))
      .set('x-tenant', 'default');
    expect(res.status).toBe(403);
  });
});

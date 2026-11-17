/**
 * Write-path footprint limits on the map object routes.
 *
 * PATCH re-checks the stored object before writing: an object already over
 * the 4096-tile limit answers 400 instead of persisting or crashing. DELETE
 * of a colliding oversized object answers 400 (not 500) when the collision
 * reconciler rejects its footprint.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/broadcast.js', () => ({ broadcastMapUpdate: vi.fn() }));

import { registerMapObjectRoutes } from './mapObjects.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import type { MapObject, PrismaClient, Tenant } from '../../generated/prisma/index.js';

const TEST_SECRET = 'map-objects-write-limits-test-secret';
const INTERNAL_TENANT_ID = 'internal-tenant';
const TENANT_LM = 'tenant-lm';

const MAP_ROW = { id: 'map-1', name: 'office', tenantId: TENANT_LM, chunkSize: 32, tileWidth: 16, tileHeight: 16 };

function objectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    mapId: MAP_ROW.id,
    assetPackUuid: 'pixel-agents-furniture',
    itemId: 'desk-01',
    tileX: 4,
    tileY: 4,
    chunkX: 0,
    chunkY: 0,
    width: 1024,
    height: 1024,
    collide: false,
    scaleFactor: 1,
    collisionBaseHeight: 0,
    dataUrl: '/packs/pixel-agents-furniture/desk.png',
    ...overrides,
  };
}

const MEMBERSHIPS: ReadonlySet<string> = new Set([`${TENANT_LM}:lm-user`]);

function makePrisma(existing: Record<string, unknown>): PrismaClient {
  const prisma = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug?: string } }) =>
        Promise.resolve(where.slug === 'internal' ? { id: INTERNAL_TENANT_ID, slug: 'internal' } : null),
      ),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        return Promise.resolve(MEMBERSHIPS.has(`${tenantId}:${userId}`) ? { role: 'member' } : null);
      }),
    },
    apiToken: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      update: vi.fn(() => Promise.resolve({})),
    },
    session: {
      findUnique: vi.fn(({ where }: { where: { tokenHash: string } }) => {
        const userId = SESSIONS.get(where.tokenHash);
        if (!userId) return Promise.resolve(null);
        return Promise.resolve({
          id: `sess-${userId}`,
          userId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          lastActiveAt: new Date(),
        });
      }),
      update: vi.fn(() => Promise.resolve({})),
    },
    assetPack: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          uuid: 'pixel-agents-furniture',
          terrain: [],
          structures: [],
          objects: [{ id: 'desk-01', dataURL: '/packs/pixel-agents-furniture/desk.png' }],
        }),
      ),
      findMany: vi.fn(() =>
        Promise.resolve([
          {
            uuid: 'pixel-agents-furniture',
            terrain: [],
            structures: [],
            objects: [{ id: 'desk-01', dataURL: '/packs/pixel-agents-furniture/desk.png' }],
          },
        ]),
      ),
    },
    mapLayer: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'layer-1', ...data })),
    },
    mapChunk: {
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 1, ...data })),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    mapAutotile: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
    map: {
      findFirst: vi.fn(({ where }: { where: { id: string; tenantId: string } }) =>
        Promise.resolve(where.id === MAP_ROW.id && where.tenantId === MAP_ROW.tenantId ? MAP_ROW : null),
      ),
    },
    mapObject: {
      findMany: vi.fn(() => Promise.resolve([existing])),
      findFirst: vi.fn(() => Promise.resolve(existing)),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 99, ...data })),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...existing, ...data })),
      delete: vi.fn(() => Promise.resolve(existing)),
    },
  } as unknown as PrismaClient;
  prisma.$transaction = vi.fn((callback) => callback(prisma));
  return prisma;
}

const TENANTS: Record<string, Partial<Tenant>> = {
  'lass-machen': { id: TENANT_LM, slug: 'lass-machen', name: 'Lass Machen' },
};

function tenantHeaderMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const slug = String(req.headers['x-tenant'] ?? '');
  const tenant = TENANTS[slug];
  if (tenant) (req as unknown as { tenant: Partial<Tenant> }).tenant = tenant;
  next();
}

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use(createSessionAuthMiddleware(prisma));
  app.use(tenantHeaderMiddleware);
  registerMapObjectRoutes(app, prisma);
  return app;
}

const SESSIONS = new Map<string, string>();

function sessionBearer(userId: string): string {
  const token = jwt.sign({ sub: userId }, TEST_SECRET);
  SESSIONS.set(hashSessionToken(token), userId);
  return `Bearer ${token}`;
}

function authHeaders() {
  return { Authorization: sessionBearer('lm-user'), 'X-Tenant': 'lass-machen' };
}

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe('PATCH /maps/:id/objects/:objId: stored footprint re-checked', () => {
  it('updates an object at exactly 4096 tiles (1024 x 1024 px)', async () => {
    const prisma = makePrisma(objectRow());
    const app = makeApp(prisma);
    const headers = authHeaders();
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send({ tileX: 5 });
    expect(res.status).toBe(200);
    expect(prisma.mapObject.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an object at 4160 tiles (1040 x 1024 px) with 400 and updates nothing', async () => {
    const prisma = makePrisma(objectRow({ width: 1040, height: 1024 }));
    const app = makeApp(prisma);
    const headers = authHeaders();
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send({ tileX: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'object_footprint_too_large' });
    expect(prisma.mapObject.update).not.toHaveBeenCalled();
  });

  it('rejects a scaled 512 x 512 px object with scaleFactor 2.5 with 400', async () => {
    const prisma = makePrisma(objectRow({ width: 512, height: 512, scaleFactor: 2.5 }));
    const app = makeApp(prisma);
    const headers = authHeaders();
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send({ tileX: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'object_footprint_too_large' });
    expect(prisma.mapObject.update).not.toHaveBeenCalled();
  });
});

const POST_BODY = {
  assetPackUuid: 'pixel-agents-furniture',
  itemId: 'desk-01',
  category: 'objects',
  tileX: 4,
  tileY: 4,
  width: 1024,
  height: 1024,
  collide: true,
  dataUrl: '/packs/pixel-agents-furniture/desk.png',
};

/** Stored colliding objects for the map budget: 1024 x 1024 px = 4096 tiles each on 16 px tiles. */
function storedColliding(count: number): Array<MapObject> {
  // Partial test double: the budget check only reads width, height,
  // scaleFactor and collide, so the remaining columns are omitted.
  return Array.from({ length: count }, () => ({ width: 1024, height: 1024, scaleFactor: 1 }) as unknown as MapObject);
}

function postHeaders() {
  const headers = authHeaders();
  return headers;
}

describe('POST /maps/:id/objects: map collision budget (65536 tiles)', () => {
  it('allows a colliding object when the map total is exactly 65536', async () => {
    const prisma = makePrisma(objectRow());
    vi.mocked(prisma.mapObject.findMany).mockResolvedValue(storedColliding(15));
    const app = makeApp(prisma);
    const headers = postHeaders();
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send(POST_BODY);
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a colliding object one tile over budget with 400 and creates nothing', async () => {
    const prisma = makePrisma(objectRow());
    vi.mocked(prisma.mapObject.findMany).mockResolvedValue(storedColliding(16));
    const app = makeApp(prisma);
    const headers = postHeaders();
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send({ ...POST_BODY, width: 16, height: 16 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'map_collision_footprint_too_large' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('allows a non-colliding object on a full map', async () => {
    const prisma = makePrisma(objectRow());
    vi.mocked(prisma.mapObject.findMany).mockResolvedValue(storedColliding(16));
    const app = makeApp(prisma);
    const headers = postHeaders();
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send({ ...POST_BODY, collide: false });
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a bulk with a colliding object over budget with 400 and creates nothing', async () => {
    const prisma = makePrisma(objectRow());
    vi.mocked(prisma.mapObject.findMany).mockResolvedValue(storedColliding(16));
    const app = makeApp(prisma);
    const headers = postHeaders();
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send({
        objects: [
          { ...POST_BODY, collide: false, width: 32, height: 32 },
          { ...POST_BODY, width: 16, height: 16 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'map_collision_footprint_too_large' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('allows a bulk of non-colliding objects on a full map', async () => {
    const prisma = makePrisma(objectRow());
    vi.mocked(prisma.mapObject.findMany).mockResolvedValue(storedColliding(16));
    const app = makeApp(prisma);
    const headers = postHeaders();
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant'])
      .send({ objects: [{ ...POST_BODY, collide: false, width: 32, height: 32 }] });
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /maps/:id/objects/:objId: oversized colliding footprint', () => {
  it('answers 400 object_footprint_too_large instead of 500', async () => {
    const prisma = makePrisma(objectRow({ width: 1040, height: 1024, collide: true }));
    const app = makeApp(prisma);
    const headers = authHeaders();
    const res = await request(app)
      .delete('/maps/map-1/objects/7')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant']);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'object_footprint_too_large' });
  });

  it('never checks the budget on delete: over-budget map still deletes 200', async () => {
    const prisma = makePrisma(objectRow({ width: 32, height: 32, collide: true }));
    vi.mocked(prisma.mapObject.findMany).mockResolvedValue(storedColliding(17));
    const app = makeApp(prisma);
    const headers = authHeaders();
    const res = await request(app)
      .delete('/maps/map-1/objects/7')
      .set('Authorization', headers.Authorization)
      .set('X-Tenant', headers['X-Tenant']);
    expect(res.status).toBe(200);
  });
});

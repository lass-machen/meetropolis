/**
 * Role gate of the /maps/:id/objects surface.
 *
 * Reads stay open to every membership role — objects are fetched on every
 * ordinary world join, not only inside the editor — but writes (single
 * create, bulk create, update, delete) require `owner` or `admin`, mirroring
 * `resolveEditorMemberTenant` with `requireAdmin` (maps.editor.ts), which
 * answers `{ error: 'forbidden - admin required' }`.
 *
 * The `Role` enum (apps/server/prisma/schema.prisma) knows `guest` besides
 * `owner`, `admin` and `member`, so guests get their own rejection cases: a
 * guest holds a membership row and therefore passes today's membership-only
 * `gateRequest` (mapObjects.ts) exactly like a member.
 *
 * Every rejection case below is red without the role gate: the gate accepts
 * any membership, so member and guest writes go through with 2xx today. The
 * pass-through controls stay green before and after the fix.
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
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

const TEST_SECRET = 'map-objects-roles-test-secret';
const TENANT_LM = 'tenant-lm';

/** The one map every case aims at; owned by TENANT_LM. */
const MAP_ROW = { id: 'map-1', name: 'office', tenantId: TENANT_LM, chunkSize: 32, tileWidth: 16, tileHeight: 16 };

/** The one object that map already holds. */
const OBJECT_ROW = {
  id: 7,
  mapId: MAP_ROW.id,
  assetPackUuid: 'pixel-agents-furniture',
  itemId: 'desk-01',
  tileX: 4,
  tileY: 4,
  chunkX: 0,
  chunkY: 0,
  width: 32,
  height: 32,
  collide: false,
  scaleFactor: 1,
  collisionBaseHeight: 0,
  dataUrl: '/packs/pixel-agents-furniture/desk.png',
};

/** userId -> membership role. Every user below belongs to TENANT_LM. */
const ROLES: Record<string, string> = {
  'member-user': 'member',
  'guest-user': 'guest',
  'admin-user': 'admin',
  'owner-user': 'owner',
};

function makePrisma(): PrismaClient {
  const prisma = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug?: string } }) =>
        Promise.resolve(where.slug === 'internal' ? { id: 'internal-tenant', slug: 'internal' } : null),
      ),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        if (tenantId !== TENANT_LM) return Promise.resolve(null);
        const role = ROLES[userId];
        return Promise.resolve(role ? { role } : null);
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
    map: {
      findFirst: vi.fn(({ where }: { where: { id: string; tenantId: string } }) =>
        Promise.resolve(where.id === MAP_ROW.id && where.tenantId === MAP_ROW.tenantId ? MAP_ROW : null),
      ),
    },
    mapObject: {
      findMany: vi.fn(() => Promise.resolve([OBJECT_ROW])),
      findFirst: vi.fn(() => Promise.resolve(OBJECT_ROW)),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 99, ...data })),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...OBJECT_ROW, ...data })),
      delete: vi.fn(() => Promise.resolve(OBJECT_ROW)),
    },
  } as unknown as PrismaClient;
  prisma.$transaction = vi.fn((callback) => callback(prisma));
  return prisma;
}

const TENANTS: Record<string, Partial<Tenant>> = {
  'lass-machen': { id: TENANT_LM, slug: 'lass-machen', name: 'Lass Machen' },
};

/**
 * Stand-in for tenancy.ts `tenantMiddleware`: the client-supplied X-Tenant
 * header wins and is deliberately NOT authorised here. That is production
 * behaviour and exactly the spoofing surface the role gate has to close.
 */
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

/** tokenHash -> userId, the session rows the Prisma double serves. */
const SESSIONS = new Map<string, string>();

function sessionBearer(userId: string): string {
  const token = jwt.sign({ sub: userId }, TEST_SECRET);
  SESSIONS.set(hashSessionToken(token), userId);
  return `Bearer ${token}`;
}

const OBJECT_BODY = {
  assetPackUuid: 'pixel-agents-furniture',
  itemId: 'desk-01',
  category: 'objects',
  tileX: 4,
  tileY: 4,
  width: 32,
  height: 32,
  collide: false,
  dataUrl: '/packs/pixel-agents-furniture/desk.png',
};

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe('member writes require owner or admin', () => {
  it('rejects POST from a member and creates nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('member-user'))
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('rejects the bulk POST from a member — the batch path is no bypass', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', sessionBearer('member-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ objects: [OBJECT_BODY] });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('rejects PATCH from a member and updates nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('member-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ tileX: 9 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.update).not.toHaveBeenCalled();
  });

  it('rejects DELETE from a member and deletes nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .delete('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('member-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.delete).not.toHaveBeenCalled();
  });
});

describe('guest writes require owner or admin', () => {
  it('rejects POST from a guest and creates nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('guest-user'))
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('rejects the bulk POST from a guest — the batch path is no bypass', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', sessionBearer('guest-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ objects: [OBJECT_BODY] });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('rejects PATCH from a guest and updates nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('guest-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ tileX: 9 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.update).not.toHaveBeenCalled();
  });

  it('rejects DELETE from a guest and deletes nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .delete('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('guest-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden - admin required' });
    expect(prisma.mapObject.delete).not.toHaveBeenCalled();
  });
});

describe('owner and admin keep write access', () => {
  it('lets an admin place an object', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('admin-user'))
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalled();
  });

  it('lets an admin use the bulk path', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', sessionBearer('admin-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ objects: [OBJECT_BODY] });
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalled();
  });

  it('lets an admin move an object', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('admin-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ tileX: 9 });
    expect(res.status).toBe(200);
    expect(prisma.mapObject.update).toHaveBeenCalled();
  });

  it('lets an admin remove an object', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .delete('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('admin-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(prisma.mapObject.delete).toHaveBeenCalled();
  });

  it('lets an owner place an object', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('owner-user'))
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalled();
  });

  it('lets an owner use the bulk path', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', sessionBearer('owner-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ objects: [OBJECT_BODY] });
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalled();
  });

  it('lets an owner move an object', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('owner-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ tileX: 9 });
    expect(res.status).toBe(200);
    expect(prisma.mapObject.update).toHaveBeenCalled();
  });

  it('lets an owner remove an object', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .delete('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('owner-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(prisma.mapObject.delete).toHaveBeenCalled();
  });
});

describe('members keep read access', () => {
  it('serves GET objects to a member', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/maps/map-1/objects')
      .set('Authorization', sessionBearer('member-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

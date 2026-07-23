/**
 * Tenant isolation of the /maps/:id/objects surface.
 *
 * These routes carry the placed contents of a map — `assetPackUuid` and the
 * `dataUrl` sprite of every object. Tenant resolution is NOT authorisation:
 * tenancy.ts lets the client-supplied `X-Tenant` header win over the session
 * JWT, so `req.tenant` can name any tenant. Only a membership row turns that
 * into access, exactly as in maps.read.ts and maps.editor.ts.
 *
 * Before the gate existed, `GET /maps/:id/objects` required no authentication
 * at all and the mutations required only *some* logged-in user, so a single
 * header handed out (or wrote into) a foreign tenant's map — re-opening through
 * the map surface what the pack scope closes on the palette surface. Every case
 * below is red without that gate.
 *
 * The pack-scope half of the placement check lives in assetPacks.scope.test.ts;
 * here the concern is purely "may this caller touch this tenant's map at all".
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

const TEST_SECRET = 'map-objects-access-test-secret';
const INTERNAL_TENANT_ID = 'internal-tenant';
const TENANT_LM = 'tenant-lm';
const TENANT_OTHER = 'tenant-other';

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

/** `${tenantId}:${userId}` memberships. `lonely-user` deliberately holds none. */
const MEMBERSHIPS: ReadonlySet<string> = new Set([`${TENANT_LM}:lm-user`, `${TENANT_OTHER}:other-user`]);

interface PrismaOpts {
  apiTokenUserId?: string;
  membershipThrows?: boolean;
}

function makePrisma(opts: PrismaOpts = {}): PrismaClient {
  const { apiTokenUserId, membershipThrows = false } = opts;
  return {
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug?: string } }) =>
        Promise.resolve(where.slug === 'internal' ? { id: INTERNAL_TENANT_ID, slug: 'internal' } : null),
      ),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        if (membershipThrows) return Promise.reject(new Error('db down'));
        const { tenantId, userId } = where.tenantId_userId;
        return Promise.resolve(MEMBERSHIPS.has(`${tenantId}:${userId}`) ? { role: 'member' } : null);
      }),
    },
    apiToken: {
      findUnique: vi.fn(() => Promise.resolve(apiTokenUserId ? { userId: apiTokenUserId } : null)),
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
      findFirst: vi.fn(() => Promise.resolve({ uuid: 'pixel-agents-furniture' })),
      findMany: vi.fn(() => Promise.resolve([{ uuid: 'pixel-agents-furniture' }])),
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
}

const TENANTS: Record<string, Partial<Tenant>> = {
  'lass-machen': { id: TENANT_LM, slug: 'lass-machen', name: 'Lass Machen' },
  other: { id: TENANT_OTHER, slug: 'other', name: 'Other GmbH' },
};

/**
 * Stand-in for tenancy.ts `tenantMiddleware`: the client-supplied X-Tenant
 * header wins and is deliberately NOT authorised here. That is production
 * behaviour and exactly the spoofing surface the gate has to close.
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

describe('GET /maps/:id/objects: authenticated and membership-scoped', () => {
  it('rejects an anonymous read with 401 and touches no object row', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app).get('/maps/map-1/objects').set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(401);
    expect(prisma.mapObject.findMany).not.toHaveBeenCalled();
  });

  it('rejects an anonymous chunked read too — the query variant is no bypass', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app).get('/maps/map-1/objects?chunks=0:0').set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(401);
    expect(prisma.mapObject.findMany).not.toHaveBeenCalled();
  });

  it('rejects a spoofed X-Tenant read by a user without membership', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .get('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lonely-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
    expect(prisma.mapObject.findMany).not.toHaveBeenCalled();
  });

  it('rejects a member of ANOTHER tenant pointing X-Tenant at a foreign map', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .get('/maps/map-1/objects')
      .set('Authorization', sessionBearer('other-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(403);
    expect(prisma.mapObject.findMany).not.toHaveBeenCalled();
  });

  it('serves a member of the owning tenant', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('answers 400 when no tenant could be resolved at all', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/maps/map-1/objects').set('Authorization', sessionBearer('lm-user'));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'tenant_required' });
  });

  it('still answers 404 for an unknown map of the caller own tenant', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/maps/no-such-map/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(404);
  });

  it('fails closed with 500 when the membership lookup errors', async () => {
    const prisma = makePrisma({ membershipThrows: true });
    const app = makeApp(prisma);
    const res = await request(app)
      .get('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(500);
    expect(prisma.mapObject.findMany).not.toHaveBeenCalled();
  });
});

describe('map object mutations: membership-scoped, not merely authenticated', () => {
  it('rejects POST from a logged-in non-member and creates nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lonely-user'))
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(403);
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('rejects POST from a member of another tenant spoofing X-Tenant', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('other-user'))
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(403);
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('rejects the bulk POST from a non-member — the batch path is no bypass', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', sessionBearer('lonely-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ objects: [OBJECT_BODY] });
    expect(res.status).toBe(403);
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });

  it('rejects PATCH from a non-member and updates nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .patch('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('lonely-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ tileX: 9 });
    expect(res.status).toBe(403);
    expect(prisma.mapObject.update).not.toHaveBeenCalled();
  });

  it('rejects DELETE from a non-member and deletes nothing', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .delete('/maps/map-1/objects/7')
      .set('Authorization', sessionBearer('lonely-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(403);
    expect(prisma.mapObject.delete).not.toHaveBeenCalled();
  });

  it('lets a member of the owning tenant place an object', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(200);
    expect(prisma.mapObject.create).toHaveBeenCalledTimes(1);
  });
});

describe('API tokens reach exactly as far as their owning user', () => {
  it('serves a token whose owner is a member of the resolved tenant', async () => {
    const app = makeApp(makePrisma({ apiTokenUserId: 'lm-user' }));
    const res = await request(app)
      .get('/maps/map-1/objects')
      .set('Authorization', 'Bearer plain-api-token-no-dots')
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
  });

  it('refuses a token whose owner holds no membership in the resolved tenant', async () => {
    const prisma = makePrisma({ apiTokenUserId: 'lonely-user' });
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', 'Bearer plain-api-token-no-dots')
      .set('X-Tenant', 'lass-machen')
      .send(OBJECT_BODY);
    expect(res.status).toBe(403);
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });
});

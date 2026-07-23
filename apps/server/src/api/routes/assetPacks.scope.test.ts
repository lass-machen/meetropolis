/**
 * Tenant scoping for the AssetPack read routes and for object placement.
 *
 * `AssetPack.tenantId` is an ownership marker: NULL means catalog (every tenant
 * sees it), a value means the pack is private to that one tenant. The twin of
 * the AvatarPack rules in avatarPacks.test.ts, and deliberately checked the
 * same way — both pack kinds resolve through the single scope in
 * services/packScope.ts, so a drift between them would show up here.
 *
 * Reads stay public (the editor loads the palette before any tenant binding
 * exists) but are scoped. Because tenancy.ts lets the X-Tenant header override
 * the JWT, "belongs to" is decided by a membership lookup, never by the header.
 *
 * Placement is checked too: `POST /maps/:id/objects` (and its bulk twin)
 * validate `assetPackUuid` against the SAME scope. That is the AssetPack
 * counterpart to `isAllowedAvatarId` — without it a foreign tenant could not
 * see a private pack yet could still place its objects.
 *
 * Write routes (upload/delete) keep their super-admin guard and are covered by
 * the existing assetPacks tests; the cases here only assert that the read scope
 * did not widen them.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/broadcast.js', () => ({ broadcastMapUpdate: vi.fn() }));

import { registerAssetPackRoutes } from './assetPacks.js';
import { registerMapObjectRoutes } from './mapObjects.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

const TEST_SECRET = 'asset-pack-test-secret';
const INTERNAL_TENANT_ID = 'internal-tenant';
const TENANT_LM = 'tenant-lm';
const TENANT_OTHER = 'tenant-other';

/** userId -> role held in the internal tenant. Absent userIds have no membership. */
const INTERNAL_ROLES: Record<string, string> = {
  'owner-root': 'owner',
  'member-joe': 'member',
};

/** `${tenantId}:${userId}` memberships outside the internal tenant. */
const TENANT_MEMBERSHIPS: ReadonlySet<string> = new Set([`${TENANT_LM}:lm-user`, `${TENANT_OTHER}:other-user`]);

interface PackRow {
  id: number;
  uuid: string;
  name: string;
  tenantId: string | null;
}

/** Pack fixture: one catalog pack plus one private pack per tenant. */
const PACKS: readonly PackRow[] = [
  { id: 1, uuid: 'pixel-agents-furniture', name: 'Pixel Agents Furniture', tenantId: null },
  { id: 2, uuid: 'meetropolis-office', name: 'Meetropolis Office', tenantId: TENANT_LM },
  { id: 3, uuid: 'other-tenant-pack', name: 'Foreign Pack', tenantId: TENANT_OTHER },
];

/** The where shapes the scoped handlers build — nothing else is supported. */
interface PackWhere {
  id?: number;
  uuid?: string | { in: string[] };
  tenantId?: string | null;
  OR?: Array<{ tenantId: string | null }>;
}

function matchesWhere(row: PackRow, where: PackWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (typeof where.uuid === 'string' && row.uuid !== where.uuid) return false;
  if (where.uuid && typeof where.uuid === 'object' && !where.uuid.in.includes(row.uuid)) return false;
  if (where.OR) return where.OR.some((clause) => clause.tenantId === row.tenantId);
  if (where.tenantId !== undefined) return row.tenantId === where.tenantId;
  return true;
}

/** The one map every placement test writes into; owned by TENANT_LM. */
const MAP_ROW = { id: 'map-1', name: 'office', tenantId: TENANT_LM, chunkSize: 32, tileWidth: 16, tileHeight: 16 };

interface PrismaOpts {
  apiTokenUserId?: string;
  internalTenantExists?: boolean;
}

function makePrisma(opts: PrismaOpts = {}): PrismaClient {
  const { apiTokenUserId, internalTenantExists = true } = opts;
  return {
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug?: string } }) =>
        Promise.resolve(
          where.slug === 'internal' && internalTenantExists ? { id: INTERNAL_TENANT_ID, slug: 'internal' } : null,
        ),
      ),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        if (tenantId === INTERNAL_TENANT_ID) {
          const role = INTERNAL_ROLES[userId];
          return Promise.resolve(role ? { role } : null);
        }
        return Promise.resolve(TENANT_MEMBERSHIPS.has(`${tenantId}:${userId}`) ? { role: 'member' } : null);
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
      // Unscoped lookup, reachable only from the super-admin write routes.
      findUnique: vi.fn(({ where }: { where: { id?: number; uuid?: string } }) =>
        Promise.resolve(PACKS.find((row) => row.id === where.id || row.uuid === where.uuid) ?? null),
      ),
      findFirst: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(PACKS.find((row) => matchesWhere(row, where)) ?? null),
      ),
      findMany: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(PACKS.filter((row) => matchesWhere(row, where))),
      ),
      delete: vi.fn(() => Promise.resolve({ id: 1, uuid: 'pixel-agents-furniture' })),
    },
    map: {
      findFirst: vi.fn(({ where }: { where: { id: string; tenantId: string } }) =>
        Promise.resolve(where.id === MAP_ROW.id && where.tenantId === MAP_ROW.tenantId ? MAP_ROW : null),
      ),
    },
    mapObject: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 99, ...data })),
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
 * behaviour and exactly the spoofing surface the scope guard has to close.
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
  registerAssetPackRoutes(app, prisma);
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

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

/** Pack ids in a list response, for order-independent assertions. */
function idsOf(body: unknown): number[] {
  return (body as PackRow[]).map((pack) => pack.id).sort((a, b) => a - b);
}

describe('GET /asset-packs (list): public but tenant-scoped', () => {
  it('returns only catalog packs without any auth', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/asset-packs');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1]);
  });

  it('returns catalog packs plus the caller own tenant pack for a member', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1, 2]);
  });

  it('never leaks a foreign tenant private pack to a legitimate member', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(idsOf(res.body)).not.toContain(3);
  });

  it('ignores a spoofed X-Tenant header when the caller holds no membership', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs')
      .set('Authorization', sessionBearer('member-joe'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1]);
  });

  it('ignores a spoofed X-Tenant header naming a tenant other than the caller own', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'other');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1]);
  });

  it('ignores an X-Tenant header on an unauthenticated request', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/asset-packs').set('X-Tenant', 'lass-machen');
    expect(idsOf(res.body)).toEqual([1]);
  });

  it('serves a platform super-admin every pack, even alongside an X-Tenant header', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs')
      .set('Authorization', sessionBearer('owner-root'))
      .set('X-Tenant', 'lass-machen');
    expect(idsOf(res.body)).toEqual([1, 2, 3]);
  });

  it('resolves the tenant scope for an API token, not only for a session JWT', async () => {
    const app = makeApp(makePrisma({ apiTokenUserId: 'lm-user' }));
    const res = await request(app)
      .get('/asset-packs')
      .set('Authorization', 'Bearer plain-api-token-no-dots')
      .set('X-Tenant', 'lass-machen');
    expect(idsOf(res.body)).toEqual([1, 2]);
  });

  it('grants an API token no more reach than its owning user has', async () => {
    const app = makeApp(makePrisma({ apiTokenUserId: 'member-joe' }));
    const res = await request(app)
      .get('/asset-packs')
      .set('Authorization', 'Bearer plain-api-token-no-dots')
      .set('X-Tenant', 'lass-machen');
    expect(idsOf(res.body)).toEqual([1]);
  });

  it('falls back to catalog packs when the internal tenant does not exist (OSS)', async () => {
    const app = makeApp(makePrisma({ internalTenantExists: false }));
    const res = await request(app).get('/asset-packs').set('Authorization', sessionBearer('owner-root'));
    expect(idsOf(res.body)).toEqual([1]);
  });
});

describe('GET /asset-packs/:id (single): scoped, non-enumerable', () => {
  it('returns a catalog pack without any auth', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/asset-packs/1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, uuid: 'pixel-agents-furniture' });
  });

  it('returns 404 for a private pack to an anonymous caller', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/asset-packs/2');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'not found' });
  });

  it('returns the own private pack to a member of that tenant', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs/2')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 2, uuid: 'meetropolis-office' });
  });

  it('returns 404 — not 403 — for a foreign private pack fetched via X-Tenant spoof', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs/2')
      .set('Authorization', sessionBearer('member-joe'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'not found' });
  });

  it('returns 404 for a foreign private pack even for a member of another tenant', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/asset-packs/3')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(404);
  });

  it('serves a platform super-admin a private pack by id', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/asset-packs/2').set('Authorization', sessionBearer('owner-root'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 2, uuid: 'meetropolis-office' });
  });

  it('rejects a non-numeric id with 400 before any lookup', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app).get('/asset-packs/not-a-number');
    expect(res.status).toBe(400);
    expect(prisma.assetPack.findFirst).not.toHaveBeenCalled();
  });
});

describe('AssetPack write routes stay super-admin-only', () => {
  it('rejects DELETE /asset-packs/:id for an unauthenticated caller with 401', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).delete('/asset-packs/1');
    expect(res.status).toBe(401);
  });

  it('rejects DELETE /asset-packs/:id for a tenant member holding the read scope', async () => {
    // lm-user owns the lass-machen READ scope; the scope guard must not have
    // widened the write surface.
    const app = makeApp(makePrisma());
    const res = await request(app)
      .delete('/asset-packs/2')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
  });
});

const OBJECT_BODY = {
  itemId: 'desk-01',
  category: 'objects',
  tileX: 4,
  tileY: 4,
  width: 32,
  height: 32,
  collide: false,
  dataUrl: '/packs/x/desk.png',
};

/**
 * Placement is the AssetPack counterpart to `isAllowedAvatarId`: seeing a pack
 * and using its objects resolve through the same scope, so a pack that is
 * hidden is also unplaceable.
 */
describe('POST /maps/:id/objects: placement honours the pack scope', () => {
  it('accepts a catalog pack for a member of the map tenant', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ ...OBJECT_BODY, assetPackUuid: 'pixel-agents-furniture' });
    expect(res.status).toBe(200);
  });

  it('accepts the map tenant own private pack', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ ...OBJECT_BODY, assetPackUuid: 'meetropolis-office' });
    expect(res.status).toBe(200);
  });

  it('rejects a foreign tenant private pack with the same 400 as a missing one', async () => {
    // Non-enumerable on purpose: "exists but not yours" must be
    // indistinguishable from "does not exist".
    const app = makeApp(makePrisma());
    const res = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ ...OBJECT_BODY, assetPackUuid: 'other-tenant-pack' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'asset_pack_not_found' });

    const missing = await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ ...OBJECT_BODY, assetPackUuid: 'no-such-pack' });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual(res.body);
  });

  it('never places an object when the pack is out of scope', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    await request(app)
      .post('/maps/map-1/objects')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ ...OBJECT_BODY, assetPackUuid: 'other-tenant-pack' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });
});

describe('POST /maps/:id/objects/bulk: the bulk path is no bypass', () => {
  it('accepts a batch drawn from catalog and own packs', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({
        objects: [
          { ...OBJECT_BODY, assetPackUuid: 'pixel-agents-furniture' },
          { ...OBJECT_BODY, assetPackUuid: 'meetropolis-office' },
        ],
      });
    expect(res.status).toBe(200);
  });

  it('rejects the whole batch when one entry names a foreign private pack', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/maps/map-1/objects/bulk')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({
        objects: [
          { ...OBJECT_BODY, assetPackUuid: 'pixel-agents-furniture' },
          { ...OBJECT_BODY, assetPackUuid: 'other-tenant-pack' },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'asset_pack_not_found', uuid: 'other-tenant-pack' });
    expect(prisma.mapObject.create).not.toHaveBeenCalled();
  });
});

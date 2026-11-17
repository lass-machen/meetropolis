/**
 * Archive/restore coverage for AvatarPack routes (AssetPack twin).
 *
 * Soft-archive hides packs from GET /avatar-packs while GET /avatar-packs/:id
 * and wear/resolve stay readable. Writes stay internal-owner only, same gate
 * as DELETE. Separate file: avatarPacks.test.ts is already near the LoC hard
 * limit (566/600).
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerAvatarPackRoutes } from './avatarPacks.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

const TEST_SECRET = 'avatar-pack-archive-test-secret';
const INTERNAL_TENANT_ID = 'internal-tenant';
const TENANT_LM = 'tenant-lm';
const TENANT_OTHER = 'tenant-other';

const INTERNAL_ROLES: Record<string, string> = {
  'owner-root': 'owner',
  'admin-al': 'admin',
  'member-joe': 'member',
};

const TENANT_MEMBERSHIPS: ReadonlySet<string> = new Set([`${TENANT_LM}:lm-user`, `${TENANT_OTHER}:other-user`]);

interface PackRow {
  id: number;
  uuid: string;
  name: string;
  tenantId: string | null;
  archived: boolean;
}

const PACKS: readonly PackRow[] = [
  { id: 1, uuid: 'default-characters', name: 'Default Characters', tenantId: null, archived: false },
  { id: 2, uuid: 'lass-machen-avatar-pack', name: 'Internal Avatars', tenantId: TENANT_LM, archived: false },
  { id: 3, uuid: 'other-tenant-pack', name: 'Foreign Avatars', tenantId: TENANT_OTHER, archived: false },
  { id: 4, uuid: 'legacy-archive', name: 'Legacy Archive', tenantId: null, archived: true },
];

interface PackWhere {
  id?: number;
  tenantId?: string | null;
  archived?: boolean;
  OR?: Array<{ tenantId: string | null }>;
}

function matchesWhere(row: PackRow, where: PackWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.archived !== undefined && row.archived !== where.archived) return false;
  if (where.OR) return where.OR.some((clause) => clause.tenantId === row.tenantId);
  if (where.tenantId !== undefined) return row.tenantId === where.tenantId;
  return true;
}

interface PrismaOpts {
  apiTokenUserId?: string;
  internalTenantExists?: boolean;
}

function makePrisma(opts: PrismaOpts = {}): PrismaClient {
  const { apiTokenUserId, internalTenantExists = true } = opts;
  const packs = PACKS.map((pack) => ({ ...pack }));
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
    avatarPack: {
      findUnique: vi.fn(({ where }: { where: { id?: number; uuid?: string } }) => {
        if (typeof where.id === 'number') {
          return Promise.resolve(packs.find((row) => row.id === where.id) ?? null);
        }
        if (typeof where.uuid === 'string') {
          return Promise.resolve(packs.find((row) => row.uuid === where.uuid) ?? null);
        }
        return Promise.resolve(null);
      }),
      findFirst: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(packs.find((row) => matchesWhere(row, where)) ?? null),
      ),
      findMany: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(packs.filter((row) => matchesWhere(row, where))),
      ),
      update: vi.fn(({ where, data }: { where: { id: number }; data: { archived: boolean } }) => {
        const pack = packs.find((row) => row.id === where.id);
        if (!pack) throw new Error('missing pack');
        pack.archived = data.archived;
        return Promise.resolve(pack);
      }),
      delete: vi.fn(() => Promise.resolve({ id: 1, uuid: 'default-characters' })),
    },
  } as unknown as PrismaClient;
}

const TENANTS: Record<string, Partial<Tenant>> = {
  'lass-machen': { id: TENANT_LM, slug: 'lass-machen', name: 'Lass Machen' },
  other: { id: TENANT_OTHER, slug: 'other', name: 'Other GmbH' },
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
  registerAvatarPackRoutes(app, prisma);
  return app;
}

const SESSIONS = new Map<string, string>();

function sessionBearer(userId: string): string {
  const token = jwt.sign({ sub: userId }, TEST_SECRET);
  SESSIONS.set(hashSessionToken(token), userId);
  return `Bearer ${token}`;
}

function idsOf(body: unknown): number[] {
  return (body as PackRow[]).map((pack) => pack.id).sort((a, b) => a - b);
}

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
  SESSIONS.clear();
});

afterEach(() => {
  process.env = originalEnv;
});

describe('GET /avatar-packs hides archived packs', () => {
  it('hides archived packs from a platform super-admin too', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/avatar-packs')
      .set('Authorization', sessionBearer('owner-root'))
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1, 2, 3]);
    expect(idsOf(res.body)).not.toContain(4);
  });

  it('hides archived catalogue packs from anonymous list callers', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/avatar-packs');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1]);
    expect(idsOf(res.body)).not.toContain(4);
  });
});

describe('GET /avatar-packs/:id keeps archived packs readable', () => {
  it('serves an archived pack by id while keeping it out of palette lists', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/avatar-packs/4');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 4, uuid: 'legacy-archive', archived: true });
  });
});

describe('PATCH /avatar-packs/:id/archive', () => {
  it('rejects archive changes from an ordinary tenant member', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .patch('/avatar-packs/2/archive')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ archived: true });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
  });

  it('rejects unauthenticated archive calls with 401', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).patch('/avatar-packs/1/archive').send({ archived: true });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid payload with 400', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .patch('/avatar-packs/1/archive')
      .set('Authorization', sessionBearer('owner-root'))
      .send({ archived: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid payload' });
  });

  it('rejects a non-numeric id with 400', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .patch('/avatar-packs/not-a-number/archive')
      .set('Authorization', sessionBearer('owner-root'))
      .send({ archived: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid id' });
    expect(prisma.avatarPack.update).not.toHaveBeenCalled();
  });

  it.each(['1.5', '0', '-1'] as const)('rejects non-positive-integer id %s with 400', async (rawId) => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const res = await request(app)
      .patch(`/avatar-packs/${rawId}/archive`)
      .set('Authorization', sessionBearer('owner-root'))
      .send({ archived: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid id' });
    expect(prisma.avatarPack.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing pack id', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app)
      .patch('/avatar-packs/999/archive')
      .set('Authorization', sessionBearer('owner-root'))
      .send({ archived: true });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'not found' });
  });

  it('lets a platform owner archive and restore a pack by id', async () => {
    const prisma = makePrisma();
    const app = makeApp(prisma);
    const auth = sessionBearer('owner-root');

    const archived = await request(app)
      .patch('/avatar-packs/1/archive')
      .set('Authorization', auth)
      .send({ archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ id: 1, archived: true });

    const listWhileArchived = await request(app).get('/avatar-packs').set('Authorization', auth);
    expect(idsOf(listWhileArchived.body)).not.toContain(1);

    const restored = await request(app)
      .patch('/avatar-packs/1/archive')
      .set('Authorization', auth)
      .send({ archived: false });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ id: 1, archived: false });
    expect(prisma.avatarPack.update).toHaveBeenCalledTimes(2);

    const listAfterRestore = await request(app).get('/avatar-packs').set('Authorization', auth);
    expect(idsOf(listAfterRestore.body)).toContain(1);
  });
});

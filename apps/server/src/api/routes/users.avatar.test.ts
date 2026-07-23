/**
 * Route test for PATCH /me/avatar — the write path a user drives directly.
 *
 * The regression it pins: a private AvatarPack (`tenantId` set) must be
 * unwearable outside its owning tenant. Hiding it from GET /avatar-packs alone
 * is not enough — the id is guessable, and once persisted here it is broadcast
 * to everyone in the room (rooms/handlers/avatarHandler.ts). "Not listable" and
 * "not wearable" therefore have to resolve through the SAME scope.
 *
 * Tenant resolution is reproduced the way production behaves: the
 * client-supplied X-Tenant header wins (tenancy.ts), deliberately unauthorised,
 * so the spoofing surface the scope guard closes is actually exercised.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerUserRoutes } from './users.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

const TEST_SECRET = 'users-avatar-test-secret';
const INTERNAL_TENANT_ID = 'internal-tenant';
const TENANT_LM = 'tenant-lm';
const TENANT_NEW = 'tenant-new';

/** Memberships as `${tenantId}:${userId}`. Nobody here owns the internal
 * tenant, so no request resolves to the super-admin scope. */
const MEMBERSHIPS: ReadonlySet<string> = new Set([`${TENANT_LM}:lm-user`, `${TENANT_NEW}:new-user`]);

const PACKS = [
  { uuid: 'default-extras', tenantId: null, avatars: [{ key: 'extra-one' }] },
  { uuid: 'lass-machen-avatar-pack', tenantId: TENANT_LM, avatars: [{ key: 'old-man' }] },
];

interface PackWhere {
  uuid: string;
  tenantId?: string | null;
  OR?: Array<{ tenantId: string | null }>;
}

function makePrisma() {
  const saved: string[] = [];
  const prisma = {
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
    apiToken: { findUnique: vi.fn(() => Promise.resolve(null)), update: vi.fn(() => Promise.resolve({})) },
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
    // findFirst, matching the scoped lookup in avatarAccess.ts. No custom
    // avatar exists in these fixtures; the delegate only has to be present.
    customAvatar: { findFirst: vi.fn(() => Promise.resolve(null)) },
    avatarPack: {
      findFirst: vi.fn(({ where }: { where: PackWhere }) => {
        const row = PACKS.find((pack) => {
          if (pack.uuid !== where.uuid) return false;
          if (where.OR) return where.OR.some((clause) => clause.tenantId === pack.tenantId);
          if (where.tenantId !== undefined) return pack.tenantId === where.tenantId;
          return true;
        });
        return Promise.resolve(row ? { avatars: row.avatars } : null);
      }),
    },
    user: {
      update: vi.fn(({ data }: { data: { avatarId: string } }) => {
        saved.push(data.avatarId);
        return Promise.resolve({ id: 'u', avatarId: data.avatarId });
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, saved };
}

const TENANTS: Record<string, Partial<Tenant>> = {
  'lass-machen': { id: TENANT_LM, slug: 'lass-machen', name: 'Lass Machen' },
  newcomer: { id: TENANT_NEW, slug: 'newcomer', name: 'Newcomer GmbH' },
};

function tenantHeaderMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const slug = String(req.headers['x-tenant'] ?? '');
  const tenant = TENANTS[slug];
  if (tenant) (req as unknown as { tenant: Partial<Tenant> }).tenant = tenant;
  next();
}

const SESSIONS = new Map<string, string>();

function sessionBearer(userId: string): string {
  const token = jwt.sign({ sub: userId }, TEST_SECRET);
  SESSIONS.set(hashSessionToken(token), userId);
  return `Bearer ${token}`;
}

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use(createSessionAuthMiddleware(prisma));
  app.use(tenantHeaderMiddleware);
  registerUserRoutes(app, prisma, requireAuth, getTenantFromReq);
  return app;
}

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe('PATCH /me/avatar — private-pack scope', () => {
  it('rejects a private pack avatar for a foreign tenant and persists nothing', async () => {
    const { prisma, saved } = makePrisma();
    const res = await request(makeApp(prisma))
      .patch('/me/avatar')
      .set('Authorization', sessionBearer('new-user'))
      .set('X-Tenant', 'newcomer')
      .send({ avatarId: 'lass-machen-avatar-pack:old-man' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid avatarId' });
    expect(saved).toEqual([]);
  });

  it('rejects a private pack avatar claimed via a spoofed X-Tenant header', async () => {
    const { prisma, saved } = makePrisma();
    const res = await request(makeApp(prisma))
      .patch('/me/avatar')
      .set('Authorization', sessionBearer('new-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ avatarId: 'lass-machen-avatar-pack:old-man' });
    expect(res.status).toBe(400);
    expect(saved).toEqual([]);
  });

  it('accepts a private pack avatar for a member of the OWNING tenant', async () => {
    const { prisma, saved } = makePrisma();
    const res = await request(makeApp(prisma))
      .patch('/me/avatar')
      .set('Authorization', sessionBearer('lm-user'))
      .set('X-Tenant', 'lass-machen')
      .send({ avatarId: 'lass-machen-avatar-pack:old-man' });
    expect(res.status).toBe(200);
    expect(saved).toEqual(['lass-machen-avatar-pack:old-man']);
  });

  it('accepts a catalog pack avatar for any tenant', async () => {
    const { prisma, saved } = makePrisma();
    const res = await request(makeApp(prisma))
      .patch('/me/avatar')
      .set('Authorization', sessionBearer('new-user'))
      .set('X-Tenant', 'newcomer')
      .send({ avatarId: 'default-extras:extra-one' });
    expect(res.status).toBe(200);
    expect(saved).toEqual(['default-extras:extra-one']);
  });

  it('accepts a built-in default avatar even without a resolved tenant', async () => {
    const { prisma, saved } = makePrisma();
    const res = await request(makeApp(prisma))
      .patch('/me/avatar')
      .set('Authorization', sessionBearer('new-user'))
      .send({ avatarId: 'default-characters:business_man' });
    expect(res.status).toBe(200);
    expect(saved).toEqual(['default-characters:business_man']);
  });

  it('rejects an unauthenticated request', async () => {
    const { prisma } = makePrisma();
    const res = await request(makeApp(prisma)).patch('/me/avatar').send({ avatarId: 'default-extras:extra-one' });
    expect(res.status).toBe(401);
  });
});

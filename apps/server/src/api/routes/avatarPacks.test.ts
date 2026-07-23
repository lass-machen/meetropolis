/**
 * Authorisation tests for the AvatarPack routes.
 *
 * Writes: a pack created here always lands as a catalogue pack (tenantId NULL)
 * and is therefore visible in every tenant, so POST /avatar-packs, DELETE
 * /avatar-packs/:id and POST /avatar-packs/upload-sprite must be restricted to
 * a platform super-admin (owner of the internal tenant), exactly like the twin
 * global AssetPack registry. Before that fix these routes accepted any
 * authenticated user (member/guest included).
 *
 * Reads: GET /avatar-packs and GET /avatar-packs/:id stay public — the avatar
 * registry loads them before any tenant binding exists — but are tenant-scoped.
 * A pack with a `tenantId` belongs to that tenant alone; everyone else must
 * neither see it in the list nor fetch it by id. Because tenancy.ts lets the
 * X-Tenant header override the JWT, "belongs to" is decided by a membership
 * lookup, not by the header.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
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

const TEST_SECRET = 'avatar-pack-test-secret';
const INTERNAL_TENANT_ID = 'internal-tenant';
const TENANT_LM = 'tenant-lm';
const TENANT_OTHER = 'tenant-other';

/** userId -> role held in the internal tenant. Absent userIds have no membership. */
const INTERNAL_ROLES: Record<string, string> = {
  'owner-root': 'owner',
  'admin-al': 'admin',
  'member-joe': 'member',
  'guest-gwen': 'guest',
};

/** `${tenantId}:${userId}` memberships outside the internal tenant. */
const TENANT_MEMBERSHIPS: ReadonlySet<string> = new Set([`${TENANT_LM}:lm-user`, `${TENANT_OTHER}:other-user`]);

interface PackRow {
  id: number;
  uuid: string;
  name: string;
  tenantId: string | null;
}

/** Pack fixture: one catalogue pack plus one private pack per tenant. */
const PACKS: readonly PackRow[] = [
  { id: 1, uuid: 'default-characters', name: 'Default Characters', tenantId: null },
  { id: 2, uuid: 'lass-machen-avatar-pack', name: 'Internal Avatars', tenantId: TENANT_LM },
  { id: 3, uuid: 'other-tenant-pack', name: 'Foreign Avatars', tenantId: TENANT_OTHER },
];

/** The where shapes the read handlers build — nothing else is supported. */
interface PackWhere {
  id?: number;
  tenantId?: string | null;
  OR?: Array<{ tenantId: string | null }>;
}

function matchesWhere(row: PackRow, where: PackWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.OR) return where.OR.some((clause) => clause.tenantId === row.tenantId);
  if (where.tenantId !== undefined) return row.tenantId === where.tenantId;
  return true;
}

interface PrismaOpts {
  /** If set, any bearer API token resolves to this user id. */
  apiTokenUserId?: string;
  /** If false, the internal tenant does not exist (super-admin lookup fails closed). */
  internalTenantExists?: boolean;
}

/**
 * In-memory Prisma double covering exactly the delegates the AvatarPack routes
 * and their auth guard touch. `avatarPack.create`/`update`/`delete` echo a
 * deterministic record so the success assertions can inspect the response.
 */
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
    // Session lookup performed by the session-auth middleware: a JWT only
    // authenticates while a live Session row backs it (see sessionAuth.ts).
    // `sessionBearer()` registers the token's hash here.
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
      // Unscoped lookup, used only by the super-admin write routes.
      findUnique: vi.fn(({ where }: { where: { id?: number; uuid?: string } }) => {
        if (typeof where.id === 'number') return Promise.resolve({ id: where.id, uuid: 'pack-uuid' });
        return Promise.resolve(null);
      }),
      findFirst: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(PACKS.find((row) => matchesWhere(row, where)) ?? null),
      ),
      findMany: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(PACKS.filter((row) => matchesWhere(row, where))),
      ),
      create: vi.fn(({ data }: { data: { uuid: string; version: string } }) =>
        Promise.resolve({ id: 42, uuid: data.uuid, version: data.version }),
      ),
      update: vi.fn(({ data }: { data: { version: string } }) =>
        Promise.resolve({ id: 42, uuid: 'pack-uuid', version: data.version }),
      ),
      delete: vi.fn(() => Promise.resolve({ id: 1, uuid: 'pack-uuid' })),
    },
  } as unknown as PrismaClient;
}

/** Tenants addressable via the X-Tenant header. */
const TENANTS: Record<string, Partial<Tenant>> = {
  'lass-machen': { id: TENANT_LM, slug: 'lass-machen', name: 'Lass Machen' },
  other: { id: TENANT_OTHER, slug: 'other', name: 'Other GmbH' },
};

/**
 * Stand-in for tenancy.ts `tenantMiddleware`: the client-supplied X-Tenant
 * header wins and is deliberately NOT authorised here. That is production
 * behaviour ("resolution is not authorization") and exactly the spoofing
 * surface the read scope guard has to close, so the tests must reproduce it
 * rather than pre-filter it away.
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
  // Mirrors the production wiring (api.ts): auth is resolved once, up front,
  // then the tenant is resolved from the request.
  app.use(createSessionAuthMiddleware(prisma));
  app.use(tenantHeaderMiddleware);
  registerAvatarPackRoutes(app, prisma);
  return app;
}

/** tokenHash -> userId, the session rows the Prisma double serves. */
const SESSIONS = new Map<string, string>();

/**
 * A valid session Bearer (JWT with a `sub`) plus the Session row that makes it
 * count as authenticated. The API-token guard skips JWTs.
 */
function sessionBearer(userId: string): string {
  const token = jwt.sign({ sub: userId }, TEST_SECRET);
  SESSIONS.set(hashSessionToken(token), userId);
  return `Bearer ${token}`;
}

const VALID_CREATE_BODY = {
  uuid: 'pack-uuid',
  name: 'Test Pack',
  description: 'desc',
  author: 'author',
  version: '1.0.0',
  type: 'full',
  avatars: [{ id: 'a1' }],
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let tmpPacksDir: string;
const originalEnv = process.env;

beforeEach(() => {
  tmpPacksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-packs-test-'));
  process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET, ASSET_PACKS_DIR: tmpPacksDir };
});

afterEach(() => {
  process.env = originalEnv;
  fs.rmSync(tmpPacksDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('AvatarPack write routes: authorisation', () => {
  describe('POST /avatar-packs (create)', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).post('/avatar-packs').send(VALID_CREATE_BODY);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: 'unauthorized' });
    });

    it('rejects an authenticated internal member with 403', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', sessionBearer('member-joe'))
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'forbidden' });
    });

    it('rejects an authenticated internal guest with 403', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', sessionBearer('guest-gwen'))
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(403);
    });

    it('rejects an internal admin (non-owner) with 403 — write is owner-only', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', sessionBearer('admin-al'))
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(403);
    });

    it('rejects an authenticated non-member (no internal membership) with 403', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', sessionBearer('stranger'))
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(403);
    });

    it('fails closed with 403 when no internal tenant exists (OSS edge case)', async () => {
      // Without an internal tenant the super-admin lookup cannot resolve, so
      // even the would-be owner must be refused rather than silently allowed.
      const app = makeApp(makePrisma({ internalTenantExists: false }));
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', sessionBearer('owner-root'))
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'forbidden' });
    });

    it('allows a platform super-admin (internal owner) and upserts', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', sessionBearer('owner-root'))
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, uuid: 'pack-uuid', version: '1.0.0' });
    });

    it('allows an API token owned by an internal owner', async () => {
      const app = makeApp(makePrisma({ apiTokenUserId: 'owner-root' }));
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', 'Bearer plain-api-token-no-dots')
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });

    it('is unaffected by the X-Tenant header — tenant scope grants no write right', async () => {
      // lm-user owns the lass-machen tenant scope for READS; writes stay
      // super-admin-only, so the scope guard must not have widened them.
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', sessionBearer('lm-user'))
        .set('X-Tenant', 'lass-machen')
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'forbidden' });
    });

    it('rejects an API token owned by a member with 403', async () => {
      const app = makeApp(makePrisma({ apiTokenUserId: 'member-joe' }));
      const res = await request(app)
        .post('/avatar-packs')
        .set('Authorization', 'Bearer plain-api-token-no-dots')
        .send(VALID_CREATE_BODY);
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /avatar-packs/:id', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).delete('/avatar-packs/1');
      expect(res.status).toBe(401);
    });

    it('rejects an authenticated internal member with 403', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).delete('/avatar-packs/1').set('Authorization', sessionBearer('member-joe'));
      expect(res.status).toBe(403);
    });

    it('allows a platform super-admin (internal owner)', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).delete('/avatar-packs/1').set('Authorization', sessionBearer('owner-root'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });
  });

  describe('POST /avatar-packs/upload-sprite', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs/upload-sprite')
        .field('packUuid', 'pack-uuid')
        .attach('file', PNG_MAGIC, 'sprite.png');
      expect(res.status).toBe(401);
    });

    it('rejects an authenticated internal member with 403', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs/upload-sprite')
        .set('Authorization', sessionBearer('member-joe'))
        .field('packUuid', 'pack-uuid')
        .attach('file', PNG_MAGIC, 'sprite.png');
      expect(res.status).toBe(403);
    });

    it('allows a platform super-admin (internal owner) and stores the sprite', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .post('/avatar-packs/upload-sprite')
        .set('Authorization', sessionBearer('owner-root'))
        .field('packUuid', 'pack-uuid')
        .attach('file', PNG_MAGIC, 'sprite.png');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
      expect(res.body.url).toMatch(/^\/packs\/avatars\/pack-uuid\/.+\.png$/);
    });
  });
});

/** Pack ids in a list response, for order-independent assertions. */
function idsOf(body: unknown): number[] {
  return (body as PackRow[]).map((pack) => pack.id).sort((a, b) => a - b);
}

describe('AvatarPack read routes: public but tenant-scoped', () => {
  describe('GET /avatar-packs (list)', () => {
    it('returns 200 and only catalogue packs without any auth', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).get('/avatar-packs');
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toEqual([1]);
    });

    it('returns catalogue packs plus the caller own tenant pack for a member', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .get('/avatar-packs')
        .set('Authorization', sessionBearer('lm-user'))
        .set('X-Tenant', 'lass-machen');
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toEqual([1, 2]);
    });

    it('never leaks a foreign tenant private pack to a legitimate member', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .get('/avatar-packs')
        .set('Authorization', sessionBearer('lm-user'))
        .set('X-Tenant', 'lass-machen');
      expect(idsOf(res.body)).not.toContain(3);
    });

    it('ignores a spoofed X-Tenant header when the caller holds no membership', async () => {
      // member-joe is authenticated (internal member) but has no membership in
      // lass-machen; the header alone must not widen visibility.
      const app = makeApp(makePrisma());
      const res = await request(app)
        .get('/avatar-packs')
        .set('Authorization', sessionBearer('member-joe'))
        .set('X-Tenant', 'lass-machen');
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toEqual([1]);
    });

    it('ignores a spoofed X-Tenant header naming a tenant other than the caller own', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .get('/avatar-packs')
        .set('Authorization', sessionBearer('lm-user'))
        .set('X-Tenant', 'other');
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toEqual([1]);
    });

    it('ignores an X-Tenant header on an unauthenticated request', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).get('/avatar-packs').set('X-Tenant', 'lass-machen');
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toEqual([1]);
    });
  });

  describe('GET /avatar-packs/:id (single)', () => {
    it('returns a catalogue pack without any auth', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).get('/avatar-packs/1');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 1, uuid: 'default-characters' });
    });

    it('returns 404 for a private pack to an anonymous caller', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app).get('/avatar-packs/2');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('returns the own private pack to a member of that tenant', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .get('/avatar-packs/2')
        .set('Authorization', sessionBearer('lm-user'))
        .set('X-Tenant', 'lass-machen');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 2, uuid: 'lass-machen-avatar-pack' });
    });

    it('returns 404 — not 403 — for a foreign private pack fetched via X-Tenant spoof', async () => {
      // The status must not distinguish "exists but not yours" from "missing",
      // otherwise pack ids become enumerable across tenants.
      const app = makeApp(makePrisma());
      const res = await request(app)
        .get('/avatar-packs/2')
        .set('Authorization', sessionBearer('member-joe'))
        .set('X-Tenant', 'lass-machen');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('returns 404 for a foreign private pack even for a member of another tenant', async () => {
      const app = makeApp(makePrisma());
      const res = await request(app)
        .get('/avatar-packs/3')
        .set('Authorization', sessionBearer('lm-user'))
        .set('X-Tenant', 'lass-machen');
      expect(res.status).toBe(404);
    });

    it('rejects a non-numeric id with 400 before any lookup', async () => {
      const prisma = makePrisma();
      const app = makeApp(prisma);
      const res = await request(app).get('/avatar-packs/not-a-number');
      expect(res.status).toBe(400);
      expect(prisma.avatarPack.findFirst).not.toHaveBeenCalled();
    });
  });
});

/**
 * The two paths that make a private pack MANAGEABLE rather than merely hidden.
 * Without them the scope guard would turn "private to its tenant" into
 * "invisible to everyone, including the platform operator": the pack-management
 * tools (tools/avatar-pack-manager.html, tools/npc-admin.html) would no longer
 * list the pack, so it could neither be edited nor deleted, and an API-token
 * caller would be stuck on catalog packs regardless of who owns the token.
 */
describe('AvatarPack read routes: super-admin and API-token scope', () => {
  it('serves a platform super-admin every pack, without an X-Tenant header', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/avatar-packs').set('Authorization', sessionBearer('owner-root'));
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1, 2, 3]);
  });

  it('serves a platform super-admin a private pack by id', async () => {
    const app = makeApp(makePrisma());
    const res = await request(app).get('/avatar-packs/2').set('Authorization', sessionBearer('owner-root'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 2, uuid: 'lass-machen-avatar-pack' });
  });

  it('keeps the super-admin scope even while an X-Tenant header names one tenant', async () => {
    // A super-admin who also holds an ordinary membership must not be narrowed
    // down to that one tenant — the management tools need the full inventory.
    const app = makeApp(makePrisma());
    const res = await request(app)
      .get('/avatar-packs')
      .set('Authorization', sessionBearer('owner-root'))
      .set('X-Tenant', 'lass-machen');
    expect(idsOf(res.body)).toEqual([1, 2, 3]);
  });

  it('resolves the tenant scope for an API token, not only for a session JWT', async () => {
    const app = makeApp(makePrisma({ apiTokenUserId: 'lm-user' }));
    const res = await request(app)
      .get('/avatar-packs')
      .set('Authorization', 'Bearer plain-api-token-no-dots')
      .set('X-Tenant', 'lass-machen');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([1, 2]);
  });

  it('serves every pack to an API token owned by a super-admin', async () => {
    const app = makeApp(makePrisma({ apiTokenUserId: 'owner-root' }));
    const res = await request(app).get('/avatar-packs').set('Authorization', 'Bearer plain-api-token-no-dots');
    expect(idsOf(res.body)).toEqual([1, 2, 3]);
  });

  it('grants an API token no more reach than its owning user has', async () => {
    // member-joe holds no membership in lass-machen; the token inherits exactly
    // that — the spoofed header must not widen it.
    const app = makeApp(makePrisma({ apiTokenUserId: 'member-joe' }));
    const res = await request(app)
      .get('/avatar-packs')
      .set('Authorization', 'Bearer plain-api-token-no-dots')
      .set('X-Tenant', 'lass-machen');
    expect(idsOf(res.body)).toEqual([1]);
  });

  it('falls back to catalog packs when the internal tenant does not exist (OSS)', async () => {
    // No internal tenant -> no super-admin can be proven. The would-be owner
    // must land on the ordinary membership path, not on an open scope.
    const app = makeApp(makePrisma({ internalTenantExists: false }));
    const res = await request(app).get('/avatar-packs').set('Authorization', sessionBearer('owner-root'));
    expect(idsOf(res.body)).toEqual([1]);
  });
});

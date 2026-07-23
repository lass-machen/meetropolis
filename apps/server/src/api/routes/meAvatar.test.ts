/**
 * Route tests for the character-editor endpoints. Covers the feature flag gate,
 * auth, config validation, server-set avatarId, the ~2-files-per-user lifecycle
 * (old sprite removed on a real change, idempotent on an unchanged re-save) and
 * — the security-critical part — the TENANT SCOPE of POST /avatars/resolve.
 *
 * Both HALVES of the tenant rule are covered, because they only hold together:
 * the resolve suite pins the READ scope, and the compose suite pins the WRITE
 * stamp — a row may only be attributed to a tenant the composing session has
 * proven, so it can never be born unresolvable (and a spoofed X-Tenant can
 * never plant an avatar in a foreign tenant).
 *
 * The resolve suite reproduces a leak that was confirmed live on production: a
 * user of tenant B could POST `custom:<uuid of tenant A>` and receive the full
 * manifest, because the handler only checked that somebody was logged in and
 * then queried `findMany({ where: { uuid: { in: [...] } } })` with no tenant
 * filter. Every case below exists to keep that request red.
 *
 * Uses an in-memory Prisma double, so no database is required. Auth and tenancy
 * are NOT stubbed away: the tests drive the real `requireAuth` (via a published
 * auth resolution, exactly as sessionAuth.ts does) and the real
 * `resolvePackScope`, so the membership check that defeats an X-Tenant spoof is
 * genuinely exercised rather than mocked into agreement.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The compose limiter is module-level state built ONCE, while the route module
// is evaluated, and every test in this file shares one client IP — so the whole
// file draws on a single budget (20/min by default) and adding a test can turn
// an unrelated one into a 429. Raising it has to happen before the route import
// below, and ESM hoists imports above every ordinary statement, so `vi.hoisted`
// is the only window that works. The two env vars below it are read lazily, per
// request, which is why they may stay where they are.
vi.hoisted(() => {
  process.env.RATE_LIMIT_AVATAR_COMPOSE_MAX = '500';
});

const packsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meavatar-route-'));
process.env.ASSET_PACKS_DIR = packsDir;
process.env.AVATAR_EDITOR_ENABLED = 'true';

import { registerMeAvatarRoutes } from './meAvatar.js';
import { requireAuth } from '../utils/authHelpers.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const INTERNAL_TENANT_ID = 'internal-tenant';

interface Row {
  uuid: string;
  userId: string;
  tenantId: string | null;
  config: unknown;
  spriteUrl: string;
  previewUrl: string | null;
  configHash: string;
}

interface MembershipRow {
  tenantId: string;
  userId: string;
  role: string;
}

/** The `where` shape `handleResolve` builds — nothing else is supported. */
interface ResolveWhere {
  uuid: { in: string[] };
  tenantId?: string;
}

/**
 * Stateful in-memory double covering exactly the delegates the routes touch,
 * plus the two `resolvePackScope` consults (`membership` for the tenant proof,
 * `tenant` for the internal/super-admin lookup).
 *
 * `customAvatar.findMany` implements the tenant predicate faithfully — absent
 * `where.tenantId` matches every row. That is deliberate: if the handler ever
 * loses its filter again, the double happily returns the foreign row and the
 * assertions below fail, which is the whole point of this file.
 */
function makePrisma(memberships: MembershipRow[] = []) {
  const byUser = new Map<string, Row>();
  const userAvatarId = new Map<string, string>();
  const prisma = {
    customAvatar: {
      findUnique: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(byUser.get(where.userId) ?? null),
      ),
      upsert: vi.fn(({ where, create, update }: { where: { userId: string }; create: Row; update: Partial<Row> }) => {
        const existing = byUser.get(where.userId);
        const row: Row = existing ? { ...existing, ...update } : { ...create };
        byUser.set(where.userId, row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn(({ where }: { where: ResolveWhere }) =>
        Promise.resolve(
          Array.from(byUser.values()).filter(
            (r) => where.uuid.in.includes(r.uuid) && (where.tenantId === undefined || r.tenantId === where.tenantId),
          ),
        ),
      ),
      update: vi.fn(({ where, data }: { where: { userId: string }; data: Partial<Row> }) => {
        const existing = byUser.get(where.userId);
        // Mirrors Prisma: `update` on a missing row throws, it does not create.
        if (!existing) return Promise.reject(new Error('record not found'));
        const row: Row = { ...existing, ...data };
        byUser.set(where.userId, row);
        return Promise.resolve(row);
      }),
    },
    user: {
      update: vi.fn(({ where, data }: { where: { id: string }; data: { avatarId: string } }) => {
        userAvatarId.set(where.id, data.avatarId);
        return Promise.resolve({ id: where.id, avatarId: data.avatarId });
      }),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        const row = memberships.find((m) => m.tenantId === tenantId && m.userId === userId);
        return Promise.resolve(row ? { role: row.role } : null);
      }),
    },
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug?: string } }) =>
        Promise.resolve(where.slug === 'internal' ? { id: INTERNAL_TENANT_ID, slug: 'internal' } : null),
      ),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, byUser, userAvatarId };
}

/**
 * Reproduce the request shape the route table actually sees:
 *
 *  - `x-user` / `x-session-tenant` stand in for the verified session — the
 *    identity and the JWT `tid` that sessionAuth.ts publishes for `requireAuth`.
 *  - `x-tenant` is the CLIENT-SUPPLIED tenant signal, and it deliberately WINS
 *    over the session tenant, mirroring the tenancy.ts priority chain
 *    (explicit header > token `tid` > host/default). Modelling that precedence
 *    is what gives the spoof test its meaning: resolution is not authorisation,
 *    only the membership lookup is.
 */
function authAndTenantMiddleware(): express.RequestHandler {
  return (req, _res, next) => {
    const rawUser = req.headers['x-user'];
    const rawSessionTenant = req.headers['x-session-tenant'];
    const userId = typeof rawUser === 'string' ? rawUser : null;
    const sessionTenant = typeof rawSessionTenant === 'string' ? rawSessionTenant : null;
    setAuthResolution(req, {
      auth: userId
        ? {
            userId,
            ...(sessionTenant ? { tenantId: sessionTenant } : {}),
            sessionId: `sess-${userId}`,
            tokenHash: `hash-${userId}`,
          }
        : null,
    });
    const rawExplicit = req.headers['x-tenant'];
    const resolved = typeof rawExplicit === 'string' ? rawExplicit : sessionTenant;
    if (resolved) req.tenant = { id: resolved, slug: resolved, name: resolved } as never;
    next();
  };
}

function makeApp(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use(authAndTenantMiddleware());
  registerMeAvatarRoutes(app, prisma, requireAuth);
  return app;
}

const validConfig = {
  skin: 'light',
  hair: 'messy',
  hair_color: 'braun',
  outfit: 'trousers',
  top: 'shirt_white',
  pants: 'dark',
  shoes: 'black',
};
const spritePath = (avatarId: string) =>
  path.join(packsDir, 'avatars', 'custom', `${avatarId.slice('custom:'.length)}.png`);

/** Compose an avatar as `userId`, with `tenantId` coming from the session. */
async function composeAs(
  app: express.Express,
  userId: string,
  tenantId: string | null,
  config: Record<string, unknown> = validConfig,
): Promise<string> {
  const req = request(app).post('/me/avatar/compose').set('x-user', userId);
  if (tenantId) req.set('x-session-tenant', tenantId);
  const res = await req.send(config).expect(200);
  return res.body.avatarId as string;
}

/** Resolve `ids` as `userId`, optionally forcing an explicit `X-Tenant`. */
function resolveAs(
  app: express.Express,
  userId: string,
  sessionTenant: string | null,
  ids: string[],
  explicitTenant?: string,
) {
  const req = request(app).post('/avatars/resolve').set('x-user', userId);
  if (sessionTenant) req.set('x-session-tenant', sessionTenant);
  if (explicitTenant) req.set('x-tenant', explicitTenant);
  return req.send({ ids });
}

afterAll(() => {
  fs.rmSync(packsDir, { recursive: true, force: true });
  delete process.env.RATE_LIMIT_AVATAR_COMPOSE_MAX;
});

describe('feature flag gate', () => {
  beforeEach(() => {
    process.env.AVATAR_EDITOR_ENABLED = 'false';
  });
  it('returns 404 for compose, resolve and getMine when disabled', async () => {
    const app = makeApp(makePrisma().prisma);
    await request(app).post('/me/avatar/compose').set('x-user', 'u1').send(validConfig).expect(404);
    await request(app).post('/avatars/resolve').set('x-user', 'u1').send({ ids: [] }).expect(404);
    await request(app).get('/me/avatar/custom').set('x-user', 'u1').expect(404);
    process.env.AVATAR_EDITOR_ENABLED = 'true';
  });
});

describe('POST /me/avatar/compose', () => {
  beforeEach(() => {
    process.env.AVATAR_EDITOR_ENABLED = 'true';
  });

  it('rejects unauthenticated requests', async () => {
    await request(makeApp(makePrisma().prisma)).post('/me/avatar/compose').send(validConfig).expect(401);
  });

  it('rejects an invalid config with 400', async () => {
    const app = makeApp(makePrisma().prisma);
    await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u1')
      .send({ ...validConfig, hair: 'mohawk' })
      .expect(400);
    // hood + base is a combination violation surfaced by the shared validator.
    await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u1')
      .send({ skin: 'light', hair: 'bald', hair_color: 'braun', outfit: 'base', hat: 'hood' })
      .expect(400);
  });

  it('composes, writes the sheet, sets User.avatarId and returns a manifest', async () => {
    const { prisma, userAvatarId } = makePrisma([{ tenantId: 't1', userId: 'u1', role: 'member' }]);
    const res = await request(makeApp(prisma))
      .post('/me/avatar/compose')
      .set('x-user', 'u1')
      .set('x-session-tenant', 't1')
      .send(validConfig)
      .expect(200);
    const avatarId: string = res.body.avatarId;
    expect(avatarId.startsWith('custom:')).toBe(true);
    expect(res.body.manifest.spriteUrl).toBe(`/packs/avatars/custom/${avatarId.slice(7)}.png`);
    expect(userAvatarId.get('u1')).toBe(avatarId);
    expect(fs.existsSync(spritePath(avatarId))).toBe(true);
  });

  it('stamps the row with the SESSION tenant, never a client-supplied one', async () => {
    // `tenantId` is what every later scope check compares against, so it must
    // come from the JWT-verified session and not from the X-Tenant header — a
    // caller could otherwise plant an avatar into a foreign tenant. The header
    // here names the caller's OWN other tenant, so the only thing standing
    // between the request and a tenant-B row is the rule that the stamp follows
    // the session.
    const { prisma, byUser } = makePrisma([
      { tenantId: TENANT_A, userId: 'u-stamp', role: 'member' },
      { tenantId: TENANT_B, userId: 'u-stamp', role: 'member' },
    ]);
    const app = makeApp(prisma);
    await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u-stamp')
      .set('x-session-tenant', TENANT_A)
      .set('x-tenant', TENANT_B)
      .send(validConfig)
      .expect(403);
    expect(byUser.get('u-stamp')).toBeUndefined();

    await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u-stamp')
      .set('x-session-tenant', TENANT_A)
      .send(validConfig)
      .expect(200);
    expect(byUser.get('u-stamp')?.tenantId).toBe(TENANT_A);
  });

  it('refuses to compose when the session tenant is not backed by a membership', async () => {
    // Write side of the read rule: the row would be stamped with a tenant that
    // no scope resolution can ever reproduce, so it could never be resolved —
    // not even by its owner. Refuse instead of writing a dead row.
    const { prisma, byUser } = makePrisma();
    await request(makeApp(prisma))
      .post('/me/avatar/compose')
      .set('x-user', 'u-unproven')
      .set('x-session-tenant', TENANT_A)
      .send(validConfig)
      .expect(403);
    expect(byUser.get('u-unproven')).toBeUndefined();
  });

  it('refuses to compose when the session carries no tenant at all', async () => {
    // A NULL stamp is not a fallback: `customAvatarScopeWhere` resolves an
    // unattributed row for NOBODY, so writing one is writing a broken avatar.
    const { prisma, byUser } = makePrisma();
    await request(makeApp(prisma))
      .post('/me/avatar/compose')
      .set('x-user', 'u-tenantless')
      .send(validConfig)
      .expect(403);
    expect(byUser.get('u-tenantless')).toBeUndefined();
  });

  it('lets a platform super-admin compose, stamping its session tenant', async () => {
    // The documented `all`-scope exception: an internal owner short-circuits
    // before the membership lookup, so there is no membership for the `tid` to
    // agree with and the verified `tid` is taken as-is.
    const { prisma, byUser } = makePrisma([{ tenantId: INTERNAL_TENANT_ID, userId: 'root', role: 'owner' }]);
    await request(makeApp(prisma))
      .post('/me/avatar/compose')
      .set('x-user', 'root')
      .set('x-session-tenant', TENANT_A)
      .send(validConfig)
      .expect(200);
    expect(byUser.get('root')?.tenantId).toBe(TENANT_A);
  });

  it('re-stamps a legacy NULL tenantId on an unchanged re-save', async () => {
    // The healing path packScope.ts and avatarAccess.ts both promise. The
    // config hash of a legacy row is unchanged by definition, so the idempotent
    // early return must still refresh the attribution — otherwise the row stays
    // unresolvable however often its owner saves.
    const { prisma, byUser } = makePrisma([{ tenantId: TENANT_A, userId: 'u-legacy', role: 'member' }]);
    const app = makeApp(prisma);
    const first = await composeAs(app, 'u-legacy', TENANT_A);
    byUser.set('u-legacy', { ...byUser.get('u-legacy')!, tenantId: null }); // simulate a pre-column row

    const second = await composeAs(app, 'u-legacy', TENANT_A);
    expect(second).toBe(first); // same uuid, no re-encode
    expect(byUser.get('u-legacy')?.tenantId).toBe(TENANT_A);
    // ... and the healed row is resolvable again by a peer of that tenant.
    const res = await resolveAs(app, 'u-legacy', TENANT_A, [second]).expect(200);
    expect(Object.keys(res.body.manifests)).toEqual([second]);
  });

  it('is idempotent on an unchanged re-save (same uuid, no orphan)', async () => {
    const { prisma } = makePrisma([{ tenantId: TENANT_A, userId: 'u2', role: 'member' }]);
    const app = makeApp(prisma);
    const first = await composeAs(app, 'u2', TENANT_A);
    const second = await composeAs(app, 'u2', TENANT_A);
    expect(second).toBe(first);
    expect(fs.existsSync(spritePath(first))).toBe(true);
  });

  it('removes the previous sprite when the appearance changes', async () => {
    const { prisma } = makePrisma([{ tenantId: TENANT_A, userId: 'u3', role: 'member' }]);
    const app = makeApp(prisma);
    const first = await composeAs(app, 'u3', TENANT_A);
    const second = await composeAs(app, 'u3', TENANT_A, { ...validConfig, hair: 'bald' });
    expect(second).not.toBe(first);
    expect(fs.existsSync(spritePath(first))).toBe(false); // old cleaned up
    expect(fs.existsSync(spritePath(second))).toBe(true);
  });
});

describe('POST /avatars/resolve — tenant isolation', () => {
  beforeEach(() => {
    process.env.AVATAR_EDITOR_ENABLED = 'true';
  });

  /** owner-a lives in tenant A, owner-b and peer-b in tenant B. */
  const MEMBERSHIPS: MembershipRow[] = [
    { tenantId: TENANT_A, userId: 'owner-a', role: 'member' },
    { tenantId: TENANT_A, userId: 'peer-a', role: 'member' },
    { tenantId: TENANT_B, userId: 'owner-b', role: 'member' },
  ];

  it('lets a member of the OWNING tenant resolve the avatar (the legitimate case)', async () => {
    const { prisma } = makePrisma(MEMBERSHIPS);
    const app = makeApp(prisma);
    const avatarA = await composeAs(app, 'owner-a', TENANT_A);

    const res = await resolveAs(app, 'peer-a', TENANT_A, [avatarA]).expect(200);
    expect(Object.keys(res.body.manifests)).toEqual([avatarA]);
    expect(res.body.manifests[avatarA].spriteUrl).toContain('/packs/avatars/custom/');
    // The composer's real name never travels with the manifest.
    expect(res.body.manifests[avatarA].displayName).toBe('Custom Avatar');
  });

  it('gives a user of ANOTHER tenant nothing (production repro)', async () => {
    // The exact request that leaked: authenticated in tenant B, asking for a
    // uuid that belongs to tenant A.
    const { prisma } = makePrisma(MEMBERSHIPS);
    const app = makeApp(prisma);
    const avatarA = await composeAs(app, 'owner-a', TENANT_A);

    const res = await resolveAs(app, 'owner-b', TENANT_B, [avatarA]).expect(200);
    expect(res.body.manifests).toEqual({});
  });

  it('gives an X-Tenant spoof without membership nothing', async () => {
    // Tenant resolution obeys the header, so req.tenant IS tenant A here. Only
    // the missing membership row stops the request — which is precisely the
    // guarantee `resolvePackScope` exists to provide.
    const { prisma } = makePrisma(MEMBERSHIPS);
    const app = makeApp(prisma);
    const avatarA = await composeAs(app, 'owner-a', TENANT_A);

    const res = await resolveAs(app, 'owner-b', TENANT_B, [avatarA], TENANT_A).expect(200);
    expect(res.body.manifests).toEqual({});
  });

  it('returns ONLY the in-scope entry of a mixed batch', async () => {
    // The endpoint takes an array, so a foreign uuid must be dropped without
    // taking the caller's legitimate ids down with it.
    const { prisma } = makePrisma(MEMBERSHIPS);
    const app = makeApp(prisma);
    const avatarA = await composeAs(app, 'owner-a', TENANT_A);
    const avatarB = await composeAs(app, 'owner-b', TENANT_B, { ...validConfig, hair: 'bald' });

    const res = await resolveAs(app, 'owner-b', TENANT_B, [
      avatarA,
      avatarB,
      'custom:does-not-exist',
      'default-characters:business_man',
    ]).expect(200);
    expect(Object.keys(res.body.manifests)).toEqual([avatarB]);
  });

  it('gives an authenticated caller with no proven tenant nothing', async () => {
    // Fail-closed: unlike packs, there is no "catalog" custom avatar, so an
    // unbound caller resolves none at all.
    const { prisma } = makePrisma(MEMBERSHIPS);
    const app = makeApp(prisma);
    const avatarA = await composeAs(app, 'owner-a', TENANT_A);

    const res = await resolveAs(app, 'drifter', null, [avatarA]).expect(200);
    expect(res.body.manifests).toEqual({});
  });

  it('resolves a legacy row with a NULL tenantId for NOBODY', async () => {
    // Documented decision: NULL is not a catalog marker on CustomAvatar, it is
    // an unattributable row from before the column existed. Fail-closed means
    // nobody resolves it — not even a member of the tenant the owner happens to
    // be in now. Re-saving in the editor heals the row (covered above).
    //
    // The route no longer writes such a row (compose refuses without a proven
    // tenant), so the NULL is planted straight into the store — that is what a
    // pre-migration row looks like on disk.
    const { prisma, byUser } = makePrisma([
      ...MEMBERSHIPS,
      { tenantId: TENANT_A, userId: 'legacy-user', role: 'member' },
    ]);
    const app = makeApp(prisma);
    const legacyAvatar = await composeAs(app, 'legacy-user', TENANT_A);
    byUser.set('legacy-user', { ...byUser.get('legacy-user')!, tenantId: null });

    expect((await resolveAs(app, 'peer-a', TENANT_A, [legacyAvatar]).expect(200)).body.manifests).toEqual({});
    expect((await resolveAs(app, 'legacy-user', TENANT_A, [legacyAvatar]).expect(200)).body.manifests).toEqual({});
  });

  it('lets a platform super-admin resolve across tenants', async () => {
    // The `all` scope of resolvePackScope, reused here unchanged: an internal
    // owner already administers every tenant through /admin/*, so gating it out
    // would be a false denial rather than added safety.
    const { prisma } = makePrisma([...MEMBERSHIPS, { tenantId: INTERNAL_TENANT_ID, userId: 'root', role: 'owner' }]);
    const app = makeApp(prisma);
    const avatarA = await composeAs(app, 'owner-a', TENANT_A);

    const res = await resolveAs(app, 'root', TENANT_B, [avatarA]).expect(200);
    expect(Object.keys(res.body.manifests)).toEqual([avatarA]);
  });

  it('requires auth', async () => {
    await request(makeApp(makePrisma().prisma)).post('/avatars/resolve').send({ ids: [] }).expect(401);
  });

  it('rejects a payload with more than 200 ids', async () => {
    const app = makeApp(makePrisma().prisma);
    const tooMany = Array.from({ length: 201 }, (_, i) => `custom:${i}`);
    await request(app).post('/avatars/resolve').set('x-user', 'ud').send({ ids: tooMany }).expect(400);
  });
});

describe('POST /avatars/resolve rate limiting', () => {
  beforeEach(() => {
    process.env.AVATAR_EDITOR_ENABLED = 'true';
  });

  // `avatarResolveRateLimiter` reads its RATE_LIMIT_AVATAR_RESOLVE_MAX override
  // once, at module-evaluation time (see createRateLimiter), not per request.
  // The route module (and transitively the limiter) is imported once at the
  // top of this file, so exercising a non-default limit requires resetting the
  // module registry, setting the env override, and re-importing — this leaves
  // the top-of-file import (used by every other test in this file) untouched.
  // The error handler must be re-imported from the same fresh module graph
  // too: otherwise its `err instanceof AppError` check compares against a
  // stale AppError class from before the reset and misclassifies the 429 as
  // an unhandled 500.
  it('returns 429 once the per-IP resolve budget is exhausted', async () => {
    vi.resetModules();
    process.env.RATE_LIMIT_AVATAR_RESOLVE_MAX = '2';
    try {
      const { registerMeAvatarRoutes: freshRegister } = await import('./meAvatar.js');
      const { errorHandler: freshErrorHandler } = await import('../errorHandler.js');
      // Auth helpers must come from the SAME fresh graph: authState keeps its
      // resolutions in a module-level WeakMap, so a stale setter would write
      // where the fresh `requireAuth` never looks.
      const { requireAuth: freshRequireAuth } = await import('../utils/authHelpers.js');
      const { setAuthResolution: freshSetAuth } = await import('../utils/authState.js');

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const rawUser = req.headers['x-user'];
        const userId = typeof rawUser === 'string' ? rawUser : null;
        freshSetAuth(req, {
          auth: userId ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
        });
        next();
      });
      freshRegister(app, makePrisma().prisma, freshRequireAuth);
      app.use(freshErrorHandler);

      const call = () => request(app).post('/avatars/resolve').set('x-user', 'ue').send({ ids: [] });
      expect((await call()).status).toBe(200);
      expect((await call()).status).toBe(200);
      const blocked = await call();
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    } finally {
      delete process.env.RATE_LIMIT_AVATAR_RESOLVE_MAX;
      vi.resetModules();
    }
  });
});

/**
 * End-to-end tests for the auth surface as it is actually wired: the
 * session-auth middleware in front of the real /auth/* route table, driven
 * through supertest against an in-memory Prisma double.
 *
 * These cover the three findings this block exists for, at the level a live QA
 * pass would hit them:
 *
 *   1. Revoking a session kills the cookie. It used to report success and
 *      change nothing — /auth/me kept answering 200 for another 30 days.
 *   2. Registration establishes a revocable session, and does NOT stamp the
 *      e-mail as verified; it triggers verification instead.
 *   3. A reset token is single-use, expires, and takes every session with it.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set before the module graph is imported: the limiters below are built at
// import time, and getJwtSecret/getApiTokenPepper cache on first read.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'auth-flow-test-secret';
  process.env.API_TOKEN_PEPPER = 'auth-flow-test-pepper';
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  process.env.NODE_ENV = 'test';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The limiters are process-global and stateful, which would make these flow
// tests order-dependent (the per-address forgot budget is 3/hour, and several
// tests below deliberately fail a login). Their real behaviour is covered in
// rateLimit.test.ts and rateLimit.forgotPassword.test.ts.
vi.mock('../middleware/rateLimit.js', () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    loginRateLimiter: passthrough,
    registrationRateLimiter: passthrough,
    passwordResetRateLimiter: passthrough,
    forgotPasswordEmailRateLimiter: passthrough,
    emailVerificationRateLimiter: passthrough,
  };
});

/** Captured outbound mail, in send order. */
const sentMail: Array<{ kind: string; to: string; body: string }> = [];
let mailerAvailable = true;
/** Simulates a mail provider that never answers. */
let mailerHangs = false;

vi.mock('../../emailLoader.js', () => ({
  sendIfAvailable: vi.fn(async (fn: (mod: unknown) => Promise<boolean>) => {
    if (mailerHangs) return new Promise<boolean>(() => {});
    if (!mailerAvailable) return false;
    const mod = {
      sendVerify: (p: { to: string; verifyUrl: string }) => {
        sentMail.push({ kind: 'verify', to: p.to, body: p.verifyUrl });
        return Promise.resolve(true);
      },
      sendRaw: (p: { to: string; text: string }) => {
        sentMail.push({ kind: 'raw', to: p.to, body: p.text });
        return Promise.resolve(true);
      },
      sendInvite: (p: { to: string; inviteUrl: string }) => {
        sentMail.push({ kind: 'invite', to: p.to, body: p.inviteUrl });
        return Promise.resolve(true);
      },
    };
    return fn(mod);
  }),
}));

import { registerAuthRoutes } from './auth.js';
import { createSessionAuthMiddleware } from '../utils/sessionAuth.js';
import { clearSessionCache } from '../utils/sessionCache.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const TENANT = { id: 'tenant-1', slug: 'acme' };

// ---------------------------------------------------------------------------
// In-memory Prisma double
//
// Lives in this file rather than a shared helper module because the server
// tsconfig only excludes `*.test.ts` from the build — a helper module would be
// compiled into dist/ and shipped. It covers exactly the delegates the /auth/*
// handlers touch, and it enforces the two constraints these tests depend on:
// the unique `User.email` and the unique `Session.tokenHash`.
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  locale: string;
  avatarId: string | null;
  onboardingCompleted: boolean;
}
interface InviteRow {
  code: string;
  email: string | null;
  tenantId: string;
  role: string;
  usedAt: Date | null;
  usedById?: string;
}
interface MembershipRow {
  tenantId: string;
  userId: string;
  role: string;
  expiresAt?: Date | null;
  createdAt: Date;
}
interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: Date;
  expiresAt: Date;
  createdAt: Date;
}
interface ResetRow {
  token: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}
interface VerificationRow {
  token: string;
  userId: string;
  email: string;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

interface TestDb {
  users: Map<string, UserRow>;
  invites: Map<string, InviteRow>;
  memberships: MembershipRow[];
  sessions: SessionRow[];
  resets: ResetRow[];
  verifications: VerificationRow[];
  /** Forces `session.create` to fail, standing in for a database outage. */
  failSessionCreate?: boolean;
}

/** The Prisma error a unique-constraint violation surfaces as. */
function uniqueViolation(target: string): Error & { code: string } {
  return Object.assign(new Error(`Unique constraint failed on ${target}`), { code: 'P2002' });
}

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

function matchesEmail(row: { email: string }, where: unknown): boolean {
  const filter = (where as { email?: { equals?: string } | string } | undefined)?.email;
  const wanted = typeof filter === 'string' ? filter : filter?.equals;
  return typeof wanted === 'string' && row.email.toLowerCase() === wanted.toLowerCase();
}

function makeTestPrisma(db: TestDb): PrismaClient {
  return {
    user: {
      create: ({ data }: { data: Partial<UserRow> & { email: string } }) => {
        if ([...db.users.values()].some((u) => u.email.toLowerCase() === data.email.toLowerCase())) {
          return Promise.reject(uniqueViolation('User.email'));
        }
        const row: UserRow = {
          id: nextId('user'),
          email: data.email,
          name: data.name ?? null,
          passwordHash: data.passwordHash ?? null,
          emailVerifiedAt: data.emailVerifiedAt ?? null,
          locale: data.locale ?? 'de',
          avatarId: null,
          onboardingCompleted: false,
        };
        db.users.set(row.id, row);
        return Promise.resolve({ ...row });
      },
      findUnique: ({ where, include }: { where: { id: string }; include?: { presences?: unknown } }) => {
        const row = db.users.get(where.id);
        if (!row) return Promise.resolve(null);
        return Promise.resolve(include?.presences ? { ...row, presences: [] } : { ...row });
      },
      findFirst: ({ where }: { where: unknown }) => {
        const row = [...db.users.values()].find((u) => matchesEmail(u, where));
        return Promise.resolve(row ? { ...row } : null);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = db.users.get(where.id);
        if (!row) return Promise.reject(new Error('user not found'));
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      },
    },
    invite: {
      findUnique: ({ where }: { where: { code: string } }) => Promise.resolve(db.invites.get(where.code) ?? null),
      update: ({ where, data }: { where: { code: string }; data: Partial<InviteRow> }) => {
        const row = db.invites.get(where.code);
        if (row) Object.assign(row, data);
        return Promise.resolve(row ?? null);
      },
    },
    membership: {
      findUnique: ({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        const row = db.memberships.find((m) => m.tenantId === tenantId && m.userId === userId);
        return Promise.resolve(row ? { id: `m-${row.userId}`, ...row } : null);
      },
      findFirst: ({ where }: { where: { userId?: string; role?: string } }) => {
        const row = db.memberships.find(
          (m) => (!where.userId || m.userId === where.userId) && (!where.role || m.role === where.role),
        );
        return Promise.resolve(row ? { ...row, tenant: { ...TENANT } } : null);
      },
      upsert: ({
        where,
        create,
      }: {
        where: { tenantId_userId: { tenantId: string; userId: string } };
        create: MembershipRow;
      }) => {
        const { tenantId, userId } = where.tenantId_userId;
        const existing = db.memberships.find((m) => m.tenantId === tenantId && m.userId === userId);
        if (existing) return Promise.resolve(existing);
        const row = { ...create, createdAt: new Date() };
        db.memberships.push(row);
        return Promise.resolve(row);
      },
    },
    tenant: {
      findUnique: () => Promise.resolve(null),
    },
    session: {
      create: ({ data }: { data: Omit<SessionRow, 'id' | 'lastActiveAt' | 'createdAt'> }) => {
        if (db.failSessionCreate) return Promise.reject(new Error('db_down'));
        if (db.sessions.some((s) => s.tokenHash === data.tokenHash)) {
          return Promise.reject(uniqueViolation('Session.tokenHash'));
        }
        const row: SessionRow = { id: nextId('sess'), lastActiveAt: new Date(), createdAt: new Date(), ...data };
        db.sessions.push(row);
        return Promise.resolve({ ...row });
      },
      findUnique: ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        const row = db.sessions.find((s) => (where.tokenHash ? s.tokenHash === where.tokenHash : s.id === where.id));
        return Promise.resolve(row ? { ...row } : null);
      },
      findMany: ({ where }: { where: { userId: string } }) =>
        Promise.resolve(db.sessions.filter((s) => s.userId === where.userId).map((s) => ({ ...s }))),
      delete: ({ where }: { where: { id: string } }) => {
        const idx = db.sessions.findIndex((s) => s.id === where.id);
        if (idx < 0) return Promise.reject(new Error('not found'));
        return Promise.resolve(db.sessions.splice(idx, 1)[0]);
      },
      deleteMany: ({ where }: { where: { userId?: string; tokenHash?: unknown; expiresAt?: { lt: Date } } }) => {
        const notHash = (where.tokenHash as { not?: string } | undefined)?.not;
        const eqHash = typeof where.tokenHash === 'string' ? where.tokenHash : undefined;
        const before = db.sessions.length;
        db.sessions = db.sessions.filter((s) => {
          if (where.userId && s.userId !== where.userId) return true;
          if (eqHash && s.tokenHash !== eqHash) return true;
          if (notHash && s.tokenHash === notHash) return true;
          if (where.expiresAt?.lt && s.expiresAt >= where.expiresAt.lt) return true;
          return false;
        });
        return Promise.resolve({ count: before - db.sessions.length });
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
        const row = db.sessions.find((s) => s.id === where.id);
        if (!row) return Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' }));
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      },
    },
    passwordReset: {
      create: ({ data }: { data: Omit<ResetRow, 'usedAt' | 'createdAt'> }) => {
        const row: ResetRow = { usedAt: null, createdAt: new Date(), ...data };
        db.resets.push(row);
        return Promise.resolve({ ...row });
      },
      findUnique: ({ where }: { where: { token: string } }) => {
        const row = db.resets.find((r) => r.token === where.token);
        return Promise.resolve(row ? { ...row } : null);
      },
      deleteMany: ({ where }: { where: { userId: string; usedAt: null } }) => {
        const before = db.resets.length;
        db.resets = db.resets.filter((r) => !(r.userId === where.userId && r.usedAt === null));
        return Promise.resolve({ count: before - db.resets.length });
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { token: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }) => {
        const rows = db.resets.filter(
          (r) => r.token === where.token && r.usedAt === null && r.expiresAt > where.expiresAt.gt,
        );
        rows.forEach((r) => (r.usedAt = data.usedAt));
        return Promise.resolve({ count: rows.length });
      },
    },
    emailVerification: {
      create: ({ data }: { data: Omit<VerificationRow, 'usedAt' | 'createdAt'> }) => {
        const row: VerificationRow = { usedAt: null, createdAt: new Date(), ...data };
        db.verifications.push(row);
        return Promise.resolve({ ...row });
      },
      findFirst: ({ where }: { where: { userId: string; createdAt: { gte: Date } } }) => {
        const row = db.verifications.find((v) => v.userId === where.userId && v.createdAt >= where.createdAt.gte);
        return Promise.resolve(row ? { ...row } : null);
      },
      findUnique: ({ where }: { where: { token: string } }) => {
        const row = db.verifications.find((v) => v.token === where.token);
        return Promise.resolve(row ? { ...row } : null);
      },
      update: ({ where, data }: { where: { token: string }; data: Partial<VerificationRow> }) => {
        const row = db.verifications.find((v) => v.token === where.token);
        if (row) Object.assign(row, data);
        return Promise.resolve(row ?? null);
      },
    },
  } as unknown as PrismaClient;
}

let db: TestDb;

function makeApp(): express.Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const prisma = makeTestPrisma(db);
  app.use(createSessionAuthMiddleware(prisma));
  // Stands in for tenantMiddleware, which resolves the tenant in production.
  app.use((req, _res, next) => {
    (req as express.Request & { tenant?: unknown }).tenant = { ...TENANT, bypassLimits: false, isInternal: false };
    next();
  });
  registerAuthRoutes(app, prisma);
  return app;
}

/** The auth_token value out of a Set-Cookie header, or null. */
function cookieFrom(res: request.Response): string | null {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = list.find((c) => c.startsWith('auth_token='));
  if (!cookie) return null;
  const value = cookie.split(';')[0].slice('auth_token='.length);
  return value.length > 0 ? value : null;
}

/**
 * Let detached work settle — registration kicks off the verification mail in a
 * floating promise so a slow provider cannot fail the request.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function registerUser(app: express.Application, email = 'new@example.test') {
  db.invites.set('invite-code', { code: 'invite-code', email, tenantId: TENANT.id, role: 'member', usedAt: null });
  const res = await request(app)
    .post('/auth/register')
    .send({ code: 'invite-code', email, password: 'hunter2hunter2' });
  await flush();
  return res;
}

beforeEach(() => {
  db = { users: new Map(), invites: new Map(), memberships: [], sessions: [], resets: [], verifications: [] };
  sentMail.length = 0;
  mailerAvailable = true;
  mailerHangs = false;
  clearSessionCache();
});

describe('session revocation (finding 1)', () => {
  it('makes the revoked cookie stop authenticating immediately', async () => {
    const app = makeApp();
    const registration = await registerUser(app);
    const cookie = cookieFrom(registration);
    expect(cookie).toBeTruthy();

    // Logged in.
    const before = await request(app).get('/auth/me').set('Cookie', `auth_token=${cookie}`);
    expect(before.status).toBe(200);

    const list = await request(app).get('/auth/sessions').set('Cookie', `auth_token=${cookie}`);
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(1);
    const sessionId = list.body.sessions[0].id;
    expect(list.body.sessions[0].isCurrent).toBe(true);

    const revoke = await request(app).delete(`/auth/sessions/${sessionId}`).set('Cookie', `auth_token=${cookie}`);
    expect(revoke.status).toBe(200);

    // The regression: this used to stay 200 — the success tick was a lie.
    const after = await request(app).get('/auth/me').set('Cookie', `auth_token=${cookie}`);
    expect(after.status).toBe(401);
    expect(db.sessions).toHaveLength(0);
  });

  it('kills the cookie on logout', async () => {
    const app = makeApp();
    const cookie = cookieFrom(await registerUser(app));

    await request(app).post('/auth/logout').set('Cookie', `auth_token=${cookie}`).expect(200);

    const after = await request(app).get('/auth/me').set('Cookie', `auth_token=${cookie}`);
    expect(after.status).toBe(401);
  });

  it('revokes every other session but keeps the caller signed in', async () => {
    const app = makeApp();
    const first = cookieFrom(await registerUser(app));
    const second = cookieFrom(
      await request(app).post('/auth/login').send({ email: 'new@example.test', password: 'hunter2hunter2' }),
    );
    expect(db.sessions).toHaveLength(2);

    const res = await request(app).delete('/auth/sessions').set('Cookie', `auth_token=${second}`);
    expect(res.body.revokedCount).toBe(1);

    await request(app).get('/auth/me').set('Cookie', `auth_token=${second}`).expect(200);
    await request(app).get('/auth/me').set('Cookie', `auth_token=${first}`).expect(401);
  });

  it('refuses a foreign session id with 404 rather than revoking it', async () => {
    const app = makeApp();
    const victimCookie = cookieFrom(await registerUser(app, 'victim@example.test'));
    const victimSessionId = db.sessions[0].id;

    db.invites.set('invite-code-2', {
      code: 'invite-code-2',
      email: 'mallory@example.test',
      tenantId: TENANT.id,
      role: 'member',
      usedAt: null,
    });
    const attacker = await request(app)
      .post('/auth/register')
      .send({ code: 'invite-code-2', email: 'mallory@example.test', password: 'hunter2hunter2' });
    expect(attacker.status, JSON.stringify(attacker.body)).toBe(200);

    const res = await request(app)
      .delete(`/auth/sessions/${victimSessionId}`)
      .set('Cookie', `auth_token=${cookieFrom(attacker)}`);

    expect(res.status).toBe(404);
    await request(app).get('/auth/me').set('Cookie', `auth_token=${victimCookie}`).expect(200);
  });
});

describe('registration establishes a session (finding 2)', () => {
  it('creates exactly one session row and lists it as active', async () => {
    const app = makeApp();
    const res = await registerUser(app);

    expect(res.status).toBe(200);
    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0].userId).toBe(res.body.id);

    const list = await request(app)
      .get('/auth/sessions')
      .set('Cookie', `auth_token=${cookieFrom(res)}`);
    expect(list.body.sessions).toHaveLength(1);
  });

  it('hands out no cookie when the session row cannot be written', async () => {
    db.failSessionCreate = true;
    const app = makeApp();

    const res = await registerUser(app);

    expect(res.status).toBe(500);
    expect(cookieFrom(res)).toBeNull();
    expect(db.sessions).toHaveLength(0);
  });

  it('gives two logins in the same second distinct sessions', async () => {
    const app = makeApp();
    await registerUser(app);
    const login = () =>
      request(app).post('/auth/login').send({ email: 'new@example.test', password: 'hunter2hunter2' });

    const [a, b] = await Promise.all([login(), login()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // 1 from registration + 2 logins. Identical JWTs would have collided on
    // the unique tokenHash and silently lost a session row.
    expect(db.sessions).toHaveLength(3);
    expect(new Set(db.sessions.map((s) => s.tokenHash)).size).toBe(3);
  });
});

describe('e-mail verification (finding 4)', () => {
  it('does not stamp the address as verified and mails a token instead', async () => {
    const app = makeApp();
    const res = await registerUser(app);

    const user = db.users.get(res.body.id);
    expect(user?.emailVerifiedAt).toBeNull();
    expect(db.verifications).toHaveLength(1);
    expect(sentMail.filter((m) => m.kind === 'verify')).toHaveLength(1);
    expect(sentMail[0].to).toBe('new@example.test');
    expect(sentMail[0].body).toContain(db.verifications[0].token);
  });

  it('lets an unverified user in and reports the status to the client', async () => {
    const app = makeApp();
    const cookie = cookieFrom(await registerUser(app));

    const me = await request(app).get('/auth/me').set('Cookie', `auth_token=${cookie}`);

    expect(me.status).toBe(200);
    expect(me.body.emailVerified).toBe(false);
    expect(me.body.emailVerifiedAt).toBeNull();
  });

  it('flips the status once the token is redeemed', async () => {
    const app = makeApp();
    const cookie = cookieFrom(await registerUser(app));

    await request(app).post('/auth/verify').send({ token: db.verifications[0].token }).expect(200);

    const me = await request(app).get('/auth/me').set('Cookie', `auth_token=${cookie}`);
    expect(me.body.emailVerified).toBe(true);
    expect(me.body.emailVerifiedAt).toBeTruthy();
  });
});

describe('password reset (finding 3)', () => {
  /**
   * /auth/forgot answers before the mail work finishes (deliberately — an
   * awaited send would leak by timing whether the address exists), so let the
   * detached task settle before inspecting what it did.
   */
  async function forgot(app: express.Application, email: string) {
    const res = await request(app).post('/auth/forgot').send({ email });
    await flush();
    return res;
  }

  /** The reset token out of the mail the flow sent. */
  function tokenFromResetMail(): string {
    const mail = sentMail.find((m) => m.kind === 'raw');
    const match = mail?.body.match(/token=([a-f0-9]+)/);
    if (!match) throw new Error('no reset token in mail');
    return match[1];
  }

  it('mails a reset link and stores the token hashed, never in the clear', async () => {
    const app = makeApp();
    await registerUser(app, 'user@example.test');
    sentMail.length = 0;

    const res = await forgot(app, 'user@example.test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // The raw token is not in the response either — only in the mail.
    expect(JSON.stringify(res.body)).not.toContain(tokenFromResetMail());
    expect(db.resets).toHaveLength(1);
    expect(db.resets[0].token).not.toBe(tokenFromResetMail());
    expect(db.resets[0].token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('answers 200 for an unknown address and sends nothing', async () => {
    const app = makeApp();

    const res = await forgot(app, 'nobody@example.test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sentMail).toHaveLength(0);
    expect(db.resets).toHaveLength(0);
  });

  it('answers without waiting for the mail, so timing tells nothing apart', async () => {
    const app = makeApp();
    await registerUser(app, 'user@example.test');
    sentMail.length = 0;
    // A provider that never resolves: the response must not depend on it.
    mailerHangs = true;

    const res = await request(app).post('/auth/forgot').send({ email: 'user@example.test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('resets the password, burns the token and kills every session', async () => {
    const app = makeApp();
    const cookie = cookieFrom(await registerUser(app, 'user@example.test'));
    sentMail.length = 0;
    await forgot(app, 'user@example.test');
    const token = tokenFromResetMail();

    const reset = await request(app).post('/auth/reset').send({ token, password: 'newpassword123' });
    expect(reset.status).toBe(200);

    // Every session is gone — including the one the attacker might hold.
    expect(db.sessions).toHaveLength(0);
    await request(app).get('/auth/me').set('Cookie', `auth_token=${cookie}`).expect(401);

    // The new password works, the old one does not.
    await request(app).post('/auth/login').send({ email: 'user@example.test', password: 'newpassword123' }).expect(200);
    await request(app).post('/auth/login').send({ email: 'user@example.test', password: 'hunter2hunter2' }).expect(401);

    // Single use.
    const replay = await request(app).post('/auth/reset').send({ token, password: 'thirdpassword123' });
    expect(replay.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const app = makeApp();
    await registerUser(app, 'user@example.test');
    sentMail.length = 0;
    await forgot(app, 'user@example.test');
    const token = tokenFromResetMail();

    db.resets[0].expiresAt = new Date(Date.now() - 1000);

    const res = await request(app).post('/auth/reset').send({ token, password: 'newpassword123' });
    expect(res.status).toBe(400);
    expect(db.users.get(db.resets[0].userId)?.passwordHash).toBeTruthy();
    await request(app).post('/auth/login').send({ email: 'user@example.test', password: 'newpassword123' }).expect(401);
  });

  it('rejects a token whose email does not match', async () => {
    const app = makeApp();
    await registerUser(app, 'user@example.test');
    sentMail.length = 0;
    await forgot(app, 'user@example.test');
    const token = tokenFromResetMail();

    const res = await request(app)
      .post('/auth/reset')
      .send({ token, email: 'someone@example.test', password: 'newpassword123' });

    expect(res.status).toBe(400);
    // The mismatch must not burn the link the real user is about to click.
    expect(db.resets[0].usedAt).toBeNull();
  });

  it('invalidates the previous link when a new one is requested', async () => {
    const app = makeApp();
    await registerUser(app, 'user@example.test');
    sentMail.length = 0;
    await forgot(app, 'user@example.test');
    const first = tokenFromResetMail();
    sentMail.length = 0;
    await forgot(app, 'user@example.test');
    const second = tokenFromResetMail();

    expect(first).not.toBe(second);
    await request(app).post('/auth/reset').send({ token: first, password: 'newpassword123' }).expect(400);
    await request(app).post('/auth/reset').send({ token: second, password: 'newpassword123' }).expect(200);
  });

  it('sends nothing for a guest account, which has no password', async () => {
    const app = makeApp();
    db.users.set('guest-1', {
      id: 'guest-1',
      email: 'guest@example.test',
      name: null,
      passwordHash: null,
      emailVerifiedAt: null,
      locale: 'de',
      avatarId: null,
      onboardingCompleted: false,
    });

    await forgot(app, 'guest@example.test');

    expect(sentMail).toHaveLength(0);
    expect(db.resets).toHaveLength(0);
  });

  it('still answers 200 when no mail provider is configured', async () => {
    const app = makeApp();
    await registerUser(app, 'user@example.test');
    mailerAvailable = false;

    const res = await forgot(app, 'user@example.test');

    // Token exists but nothing leaks to the caller; the admin path is the
    // fallback in this configuration.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('password change', () => {
  it('revokes the other sessions and keeps the caller signed in', async () => {
    const app = makeApp();
    const first = cookieFrom(await registerUser(app, 'user@example.test'));
    const second = cookieFrom(
      await request(app).post('/auth/login').send({ email: 'user@example.test', password: 'hunter2hunter2' }),
    );

    const res = await request(app)
      .post('/auth/change')
      .set('Cookie', `auth_token=${second}`)
      .send({ currentPassword: 'hunter2hunter2', newPassword: 'newpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBe(1);
    await request(app).get('/auth/me').set('Cookie', `auth_token=${second}`).expect(200);
    await request(app).get('/auth/me').set('Cookie', `auth_token=${first}`).expect(401);
  });

  it('invalidates a pending reset link', async () => {
    const app = makeApp();
    const cookie = cookieFrom(await registerUser(app, 'user@example.test'));
    sentMail.length = 0;
    await request(app).post('/auth/forgot').send({ email: 'user@example.test' });
    await flush();
    const token = sentMail.find((m) => m.kind === 'raw')?.body.match(/token=([a-f0-9]+)/)?.[1];
    expect(token).toBeTruthy();

    await request(app)
      .post('/auth/change')
      .set('Cookie', `auth_token=${cookie}`)
      .send({ currentPassword: 'hunter2hunter2', newPassword: 'newpassword123' })
      .expect(200);

    await request(app).post('/auth/reset').send({ token, password: 'attacker12345' }).expect(400);
  });
});

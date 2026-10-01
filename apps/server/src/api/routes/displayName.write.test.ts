/**
 * Every route that writes a user's name applies the same limit: surrounding
 * whitespace is dropped, the rest must be 1 to 200 characters, and a name that
 * is not is answered with 400 `invalid name` and never reaches the database.
 *
 * The name of a user is sent to every peer in a tenant (the world room state
 * and its presence_recent seed), so an unbounded one makes every join in the
 * tenant as large as the name.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'display-name-test-secret';
  process.env.NODE_ENV = 'test';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () => Promise.resolve({ version: 1, isMultiTenantEnabled: () => true }),
}));
vi.mock('../../emailLoader.js', () => ({ sendIfAvailable: vi.fn(() => Promise.resolve()) }));
vi.mock('../utils/sessionAuth.js', () => ({
  establishSession: vi.fn(() => Promise.resolve({ token: 'session-token' })),
  revokeSessionByToken: vi.fn(),
  revokeSessionsForUser: vi.fn(),
}));
vi.mock('./auth.verify.js', () => ({ startEmailVerification: vi.fn(() => Promise.resolve()) }));

import { handleAuthRegister } from './auth.signin.js';
import { registerMiscRoutes } from './misc.js';
import { registerGuestRoutes } from './guests.js';
import { setAuthResolution } from '../utils/authState.js';
import { MAX_DISPLAY_NAME_LENGTH } from '../utils/displayName.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const TENANT = { id: 'tenant-1', slug: 'acme', name: 'Acme' };
const CALLER_ID = 'user-1';
const OTHER_ID = 'user-2';
const TOO_LONG = 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1);
const HUGE = 'x'.repeat(900_000);

type Row = Record<string, unknown>;
interface UserWrite {
  data: Row;
}

function makePrisma(callerRole: 'member' | 'admin' = 'admin') {
  const created: UserWrite[] = [];
  const updated: UserWrite[] = [];
  const prisma = {
    user: {
      create: vi.fn((args: UserWrite) => {
        created.push(args);
        return Promise.resolve({ id: 'new-user', email: String(args.data.email), name: args.data.name ?? null });
      }),
      update: vi.fn((args: UserWrite & { where: { id: string } }) => {
        updated.push(args);
        return Promise.resolve({ id: args.where.id, email: 'kept@example.test', name: args.data.name ?? null });
      }),
      findFirst: vi.fn(() => Promise.resolve(null)),
      findUnique: vi.fn(() => Promise.resolve({ name: 'Admin', email: 'admin@example.test', locale: 'en' })),
    },
    invite: {
      findUnique: vi.fn(() =>
        Promise.resolve({ code: 'INVITE-1', usedAt: null, email: null, tenantId: TENANT.id, role: 'member' }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { userId: string } } }) => {
        const userId = where.tenantId_userId.userId;
        if (userId === CALLER_ID) return Promise.resolve({ id: 'm-caller', role: callerRole });
        if (userId === OTHER_ID) return Promise.resolve({ id: 'm-other', role: 'member' });
        return Promise.resolve(null);
      }),
      // The admin path looks the target up by user and tenant; a new guest has no other membership.
      findFirst: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(where.userId === OTHER_ID ? { id: 'm-other', role: 'member' } : null),
      ),
      create: vi.fn(() => Promise.resolve({ id: 'm-guest', role: 'guest' })),
      upsert: vi.fn(() => Promise.resolve({})),
    },
    guestToken: { create: vi.fn(() => Promise.resolve({})) },
    tenant: { findUnique: vi.fn(() => Promise.resolve(TENANT)) },
  } as unknown as PrismaClient;
  return { prisma, created, updated };
}

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => {
    setAuthResolution(req, {
      auth: { userId: CALLER_ID, tenantId: TENANT.id, sessionId: 'session-1', tokenHash: 'hash-1' },
    });
    req.tenant = TENANT as never;
    next();
  });
  registerMiscRoutes(app, prisma);
  registerGuestRoutes(app, prisma);
  app.post('/auth/register', (req, res) => {
    void handleAuthRegister(prisma, req, res);
  });
  return app;
}

const FUTURE = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /me', () => {
  it.each([
    ['one character over the limit', TOO_LONG],
    ['900,000 characters', HUGE],
    ['only whitespace', '   '],
    ['a number', 123],
    ['an object', { a: 1 }],
  ])('rejects a name of %s with 400 and writes nothing', async (_label, name) => {
    const { prisma, updated } = makePrisma();

    const res = await request(makeApp(prisma)).patch('/me').send({ name });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid name');
    expect(JSON.stringify(res.body).length).toBeLessThan(1_000);
    expect(updated).toEqual([]);
  });

  it('rejects an empty name even next to an e-mail address', async () => {
    const { prisma, updated } = makePrisma();

    const res = await request(makeApp(prisma)).patch('/me').send({ name: '', email: 'new@example.test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid name');
    expect(updated).toEqual([]);
  });

  it('stores a name with umlauts and spaces trimmed at the edges', async () => {
    const { prisma, updated } = makePrisma();

    const res = await request(makeApp(prisma)).patch('/me').send({ name: '  Jörg Müller-Lüdenscheidt  ' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Jörg Müller-Lüdenscheidt');
    expect(updated[0]?.data.name).toBe('Jörg Müller-Lüdenscheidt');
  });

  it('stores a name of exactly the limit', async () => {
    const { prisma, updated } = makePrisma();
    const name = 'n'.repeat(MAX_DISPLAY_NAME_LENGTH);

    const res = await request(makeApp(prisma)).patch('/me').send({ name });

    expect(res.status).toBe(200);
    expect(updated[0]?.data.name).toBe(name);
  });

  it('leaves the e-mail field as it was: an e-mail alone is stored without touching the name', async () => {
    const { prisma, updated } = makePrisma();

    const res = await request(makeApp(prisma)).patch('/me').send({ email: 'new@example.test' });

    expect(res.status).toBe(200);
    expect(updated[0]?.data).toEqual({ name: undefined, email: 'new@example.test' });
  });

  it('treats a null name next to an e-mail as no name, as before', async () => {
    const { prisma, updated } = makePrisma();

    const res = await request(makeApp(prisma)).patch('/me').send({ name: null, email: 'new@example.test' });

    expect(res.status).toBe(200);
    expect(updated[0]?.data).toEqual({ name: undefined, email: 'new@example.test' });
  });

  it('still answers an empty body with nothing to update', async () => {
    const { prisma } = makePrisma();

    const res = await request(makeApp(prisma)).patch('/me').send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'nothing to update' });
  });
});

describe('PATCH /users/:id', () => {
  it.each([
    ['one character over the limit', TOO_LONG],
    ['900,000 characters', HUGE],
    ['only whitespace', '  '],
  ])('rejects a name of %s for the caller itself', async (_label, name) => {
    const { prisma, updated } = makePrisma();

    const res = await request(makeApp(prisma)).patch(`/users/${CALLER_ID}`).send({ name });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid name');
    expect(updated).toEqual([]);
  });

  it('rejects a 900,000 character name an admin sets for another member', async () => {
    const { prisma, updated } = makePrisma('admin');

    const res = await request(makeApp(prisma)).patch(`/users/${OTHER_ID}`).send({ name: HUGE });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid name');
    expect(updated).toEqual([]);
  });

  it('stores the trimmed name an admin sets for another member', async () => {
    const { prisma, updated } = makePrisma('admin');

    const res = await request(makeApp(prisma)).patch(`/users/${OTHER_ID}`).send({ name: ' Jörg Müller ' });

    expect(res.status).toBe(200);
    expect(updated[0]?.data.name).toBe('Jörg Müller');
  });

  it('still refuses a member who edits another member, whatever the name', async () => {
    const { prisma, updated } = makePrisma('member');

    const res = await request(makeApp(prisma)).patch(`/users/${OTHER_ID}`).send({ name: HUGE });

    expect(res.status).toBe(403);
    expect(updated).toEqual([]);
  });

  it('keeps its message for a failure that is not about the name', async () => {
    const { prisma, updated } = makePrisma();

    const res = await request(makeApp(prisma)).patch(`/users/${CALLER_ID}`).send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'nothing to update' });
    expect(updated).toEqual([]);
  });
});

describe('POST /auth/register', () => {
  const credentials = { code: 'INVITE-1', email: 'new@example.test', password: 'a-long-enough-password' };

  it.each([
    ['one character over the limit', TOO_LONG],
    ['900,000 characters', HUGE],
    ['an empty string', ''],
    ['only whitespace', '   '],
  ])('rejects a name of %s with 400 and creates no user', async (_label, name) => {
    const { prisma, created } = makePrisma();

    const res = await request(makeApp(prisma))
      .post('/auth/register')
      .send({ ...credentials, name });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid name');
    expect(created).toEqual([]);
  });

  it('creates the user with the trimmed name', async () => {
    const { prisma, created } = makePrisma();

    const res = await request(makeApp(prisma))
      .post('/auth/register')
      .send({ ...credentials, name: '  Jörg Müller  ' });

    expect(res.status).toBe(200);
    expect(created[0]?.data.name).toBe('Jörg Müller');
  });

  it('still accepts a registration without a name', async () => {
    const { prisma, created } = makePrisma();

    const res = await request(makeApp(prisma)).post('/auth/register').send(credentials);

    expect(res.status).toBe(200);
    expect(created[0]?.data.name).toBeUndefined();
  });

  it('keeps its message for a failure that is not about the name', async () => {
    const { prisma, created } = makePrisma();

    const res = await request(makeApp(prisma)).post('/auth/register').send({ code: 'INVITE-1', name: 'Alice' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'code, email, password required' });
    expect(created).toEqual([]);
  });
});

describe('POST /guests', () => {
  const guest = { email: 'guest@example.test', expiresAt: FUTURE };

  it.each([
    ['one character over the limit', TOO_LONG],
    ['900,000 characters', HUGE],
    ['only whitespace', '  '],
  ])('rejects a guest name of %s with 400 and creates no user', async (_label, name) => {
    const { prisma, created } = makePrisma();

    const res = await request(makeApp(prisma))
      .post('/guests')
      .send({ ...guest, name });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid name');
    expect(created).toEqual([]);
  });

  it('creates the guest with the trimmed name', async () => {
    const { prisma, created } = makePrisma();

    const res = await request(makeApp(prisma))
      .post('/guests')
      .send({ ...guest, name: ' Jörg Müller ' });

    expect(res.status).toBe(200);
    expect(created[0]?.data.name).toBe('Jörg Müller');
  });

  it('keeps its message for a failure that is not about the name', async () => {
    const { prisma, created } = makePrisma();

    const res = await request(makeApp(prisma)).post('/guests').send({ email: 'guest@example.test', name: 'Alice' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email and expiresAt required' });
    expect(created).toEqual([]);
  });
});

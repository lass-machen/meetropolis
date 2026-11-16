/**
 * Auth-event coverage for POST /invites/accept (handleAcceptInvite).
 *
 * Accepting an invite with a full session must record exactly one
 * `invite_accept` success event bound to the invite tenant — and no
 * additional `login` event. Failure paths and the verification-only
 * branch record nothing.
 *
 * handleAcceptInvite is module-private, so this test drives it through
 * HTTP like src/api/middleware/inviteRateLimit.test.ts does, with a
 * Prisma stub instead of a database.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_ENABLED = 'false';
});

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/sessionAuth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/sessionAuth.js')>();
  return { ...actual, establishSession: vi.fn() };
});

vi.mock('../utils/inviteLifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/inviteLifecycle.js')>();
  return {
    ...actual,
    deriveInviteStatus: vi.fn(),
    inviteEmailMatches: vi.fn(),
    consumeInvite: vi.fn(),
  };
});

vi.mock('../../services/authEvents.js', () => ({
  recordAuthEvent: vi.fn(),
}));

import { setAuthResolution } from '../utils/authState.js';
import { registerInviteRoutes } from './invites.js';
import { establishSession } from '../utils/sessionAuth.js';
import { deriveInviteStatus, inviteEmailMatches, consumeInvite } from '../utils/inviteLifecycle.js';
import { recordAuthEvent } from '../../services/authEvents.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const INVITE = {
  id: 'invite-1',
  code: 'accept-code-1',
  tenantId: 'tenant-1',
  email: 'invitee@example.test',
  role: 'member',
};

const ACCOUNT = {
  id: 'user-1',
  email: 'invitee@example.test',
  name: 'Invitee',
  emailVerifiedAt: new Date('2026-11-01T00:00:00.000Z'),
};

function makePrisma(invite: unknown): PrismaClient {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: { findUnique: vi.fn().mockResolvedValue(ACCOUNT) },
    invite: { findUnique: vi.fn().mockResolvedValue(invite) },
    membership: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'membership-1' }),
    },
  };
  return {
    invite: { findUnique: vi.fn().mockResolvedValue(invite) },
    user: { findUnique: vi.fn().mockResolvedValue(ACCOUNT) },
    $transaction: vi.fn((callback: (client: unknown) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
}

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-user'];
    setAuthResolution(req, {
      auth:
        typeof userId === 'string'
          ? {
              userId,
              sessionId: `sess-${userId}`,
              tokenHash: `hash-${userId}`,
              verificationOnly: req.headers['x-verification-only'] === 'true',
            }
          : null,
    });
    req.tenant = { id: 'tenant-1', slug: 'tenant-1', name: 'Tenant 1' } as never;
    next();
  });
  registerInviteRoutes(app, prisma);
  return app;
}

beforeEach(() => {
  vi.mocked(establishSession).mockReset();
  vi.mocked(deriveInviteStatus).mockReset();
  vi.mocked(inviteEmailMatches).mockReset();
  vi.mocked(consumeInvite).mockReset();
  vi.mocked(recordAuthEvent).mockReset();
  vi.mocked(deriveInviteStatus).mockReturnValue('pending');
  vi.mocked(inviteEmailMatches).mockReturnValue(true);
  vi.mocked(consumeInvite).mockResolvedValue(true);
  vi.mocked(establishSession).mockResolvedValue({ token: 'session-token-1' } as never);
});

describe('POST /invites/accept auth events', () => {
  it('records invite_accept success with the invite tenant and no login event', async () => {
    const prisma = makePrisma(INVITE);
    const app = makeApp(prisma);

    const response = await request(app).post('/invites/accept').set('x-user', 'user-1').send({ code: 'accept-code-1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'user-1', alreadyMember: false });
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    const [eventPrisma, input] = vi.mocked(recordAuthEvent).mock.calls[0];
    expect(eventPrisma).toBe(prisma);
    expect(input).toMatchObject({
      type: 'invite_accept',
      success: true,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(input?.req).toBeDefined();
  });

  it('records nothing when the invite is unknown', async () => {
    const prisma = makePrisma(null);
    const app = makeApp(prisma);

    const response = await request(app).post('/invites/accept').set('x-user', 'user-1').send({ code: 'unknown-code' });

    expect(response.status).toBe(404);
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });

  it('records nothing for a verification-only session', async () => {
    const prisma = makePrisma(INVITE);
    const app = makeApp(prisma);

    const response = await request(app)
      .post('/invites/accept')
      .set('x-user', 'user-1')
      .set('x-verification-only', 'true')
      .send({ code: 'accept-code-1' });

    expect(response.status).toBe(409);
    expect(establishSession).not.toHaveBeenCalled();
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });
});

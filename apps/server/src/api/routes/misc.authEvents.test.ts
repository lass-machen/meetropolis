/**
 * AuthEvent protocol for the misc routes: role change and self deletion.
 *
 * `PATCH /users/:id/role` records exactly one `role_change` event for the
 * TARGET user after the update, and `DELETE /users/me` records one
 * `account_delete` event without any user or tenant reference after
 * `deleteAccount` has removed the rows. The service is replaced with a
 * mock; the assertions check the call arguments, not the storage.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/authEvents.js', () => ({
  recordAuthEvent: vi.fn(),
}));

vi.mock('../../services/accountDeletion.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../services/accountDeletion.js')>();
  return { ...orig, deleteAccount: vi.fn(), removeMemberFromTenant: vi.fn() };
});

import { registerMiscRoutes } from './misc.js';
import { setAuthResolution } from '../utils/authState.js';
import { recordAuthEvent } from '../../services/authEvents.js';
import { deleteAccount } from '../../services/accountDeletion.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const TENANT = 'tenant-a';
const CALLER = 'caller-owner';
const TARGET = 'target-member';

function makeApp(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const rawUser = req.headers['x-user'];
    const userId = typeof rawUser === 'string' ? rawUser : null;
    setAuthResolution(req, {
      auth: userId ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    const rawTenant = req.headers['x-tenant'];
    if (typeof rawTenant === 'string') req.tenant = { id: rawTenant, slug: rawTenant, name: rawTenant } as never;
    next();
  });
  registerMiscRoutes(app, prisma);
  return app;
}

/** Prisma double for the role-change and self-deletion paths. */
function makePrisma() {
  const prisma = {
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { userId } = where.tenantId_userId;
        if (userId === CALLER) return Promise.resolve({ role: 'owner', expiresAt: null });
        return Promise.resolve(null);
      }),
      findFirst: vi.fn(() => Promise.resolve({ id: 'membership-1', role: 'member' })),
      update: vi.fn(() => Promise.resolve({ id: 'membership-1', role: 'admin' })),
      count: vi.fn(() => Promise.resolve(0)),
    },
    user: {
      findUnique: vi.fn(() => Promise.resolve({ id: CALLER, memberships: [] })),
    },
  };
  return prisma as unknown as PrismaClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /users/:id/role — role_change event', () => {
  it('records one role_change event for the target user after the update', async () => {
    const app = makeApp(makePrisma());
    await request(app)
      .patch(`/users/${TARGET}/role`)
      .set('x-user', CALLER)
      .set('x-tenant', TENANT)
      .send({ role: 'admin' })
      .expect(200);

    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    const [prismaArg, input] = vi.mocked(recordAuthEvent).mock.calls[0] as unknown as [
      unknown,
      { type: string; success: boolean; userId: string | null; tenantId: string | null; req: unknown },
    ];
    expect(prismaArg).toBeDefined();
    expect(input.type).toBe('role_change');
    expect(input.success).toBe(true);
    expect(input.userId).toBe(TARGET);
    expect(input.tenantId).toBe(TENANT);
    expect(input.req).toBeDefined();
  });

  it('records no event when the role change is rejected', async () => {
    const app = makeApp(makePrisma());
    await request(app)
      .patch(`/users/${TARGET}/role`)
      .set('x-user', CALLER)
      .set('x-tenant', TENANT)
      .send({ role: 'superadmin' })
      .expect(400);

    expect(recordAuthEvent).not.toHaveBeenCalled();
  });
});

describe('DELETE /users/me — account_delete event', () => {
  it('records one detached account_delete event after deleteAccount', async () => {
    const app = makeApp(makePrisma());
    await request(app).delete('/users/me').set('x-user', CALLER).set('x-tenant', TENANT).expect(200);

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    const input = vi.mocked(recordAuthEvent).mock.calls[0]?.[1] as unknown as {
      type: string;
      success: boolean;
      userId: string | null;
      tenantId: string | null;
      req: unknown;
    };
    expect(input.type).toBe('account_delete');
    expect(input.success).toBe(true);
    expect(input.userId).toBeNull();
    expect(input.tenantId).toBeNull();
    expect(input.req).toBeDefined();
  });
});

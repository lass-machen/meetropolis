/**
 * Regression tests for the emergency room/map creation behind
 * `POST /auth/position`.
 *
 * The handler creates a map when the tenant has no room to attach the presence
 * to. It used to look that map up under the hardcoded name 'office', while the
 * rest of the stack (seed, copyTemplateMapsForSignup, the Colyseus lifecycle)
 * selects it via `Tenant.defaultMapName`. A tenant whose default map had been
 * renamed in the editor therefore ended up with a SECOND, empty 32x32 map — the
 * "exactly one map per new tenant" invariant broken by a stray presence upsert.
 *
 * Uses an in-memory Prisma double plus the real session-auth middleware, so no
 * database is required.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { handleAuthPosition } from './auth.profile.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

const TEST_SECRET = 'auth-position-test-secret';
const TENANT_ID = 'tenant-renamed';
const USER_ID = 'user-1';

interface MapRow {
  id: string;
  name: string;
  tenantId: string;
}

/** tokenHash -> userId, the session rows the Prisma double serves. */
const SESSIONS = new Map<string, string>();

function makePrisma(opts: { defaultMapName: string | null; maps: MapRow[] }) {
  const maps = [...opts.maps];
  const rooms: Array<{ id: string; name: string; mapId: string; tenantId: string }> = [];
  const mapCreate = vi.fn(({ data }: { data: { name: string; tenantId: string } }) => {
    const row = { id: `map-${maps.length + 1}`, name: data.name, tenantId: data.tenantId };
    maps.push(row);
    return Promise.resolve(row);
  });
  const prisma = {
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
    tenant: {
      findUnique: vi.fn(() => Promise.resolve({ defaultMapName: opts.defaultMapName })),
    },
    map: {
      findFirst: vi.fn(({ where }: { where: { name: string; tenantId: string } }) =>
        Promise.resolve(maps.find((m) => m.name === where.name && m.tenantId === where.tenantId) ?? null),
      ),
      create: mapCreate,
    },
    room: {
      findFirst: vi.fn(({ where }: { where: { name: string; tenantId: string } }) =>
        Promise.resolve(rooms.find((r) => r.name === where.name && r.tenantId === where.tenantId) ?? null),
      ),
      create: vi.fn(({ data }: { data: { name: string; mapId: string; tenantId: string } }) => {
        const row = { id: `room-${rooms.length + 1}`, ...data };
        rooms.push(row);
        return Promise.resolve(row);
      }),
    },
    presence: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, maps, rooms, mapCreate };
}

const TENANT: Partial<Tenant> = { id: TENANT_ID, slug: 'renamed', name: 'Renamed GmbH' };

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use(createSessionAuthMiddleware(prisma));
  app.use((req, _res, next) => {
    (req as unknown as { tenant: Partial<Tenant> }).tenant = TENANT;
    next();
  });
  app.post('/auth/position', (req, res) => {
    void handleAuthPosition(prisma, req, res);
  });
  return app;
}

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
  SESSIONS.clear();
  vi.clearAllMocks();
});

const POSITION = { x: 10, y: 20, direction: 'down' as const };

describe('POST /auth/position — implicit map creation', () => {
  it("attaches the new room to the tenant's renamed default map instead of creating 'office'", async () => {
    const { prisma, maps, rooms, mapCreate } = makePrisma({
      defaultMapName: 'hq',
      maps: [{ id: 'map-hq', name: 'hq', tenantId: TENANT_ID }],
    });

    await request(makeApp(prisma))
      .post('/auth/position')
      .set('authorization', sessionBearer(USER_ID))
      .send(POSITION)
      .expect(200);

    expect(mapCreate).not.toHaveBeenCalled();
    expect(maps.map((m) => m.name)).toEqual(['hq']);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.mapId).toBe('map-hq');
  });

  it("falls back to 'office' when the tenant carries no defaultMapName", async () => {
    const { prisma, maps, rooms } = makePrisma({ defaultMapName: null, maps: [] });

    await request(makeApp(prisma))
      .post('/auth/position')
      .set('authorization', sessionBearer(USER_ID))
      .send(POSITION)
      .expect(200);

    expect(maps.map((m) => m.name)).toEqual(['office']);
    expect(rooms[0]?.mapId).toBe(maps[0]?.id);
  });
});

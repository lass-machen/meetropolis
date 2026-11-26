import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stable JWT secret so the session-auth middleware verifies the bearer tokens
// minted by `sessionBearer` below. Set at module init — before any request runs
// and thus before `getJwtSecret` caches its value.
process.env.JWT_SECRET = 'test-jwt-secret-spawn-null-0123456789abcdef';

// tokenHash -> userId. Shared with the Prisma double's `session.findUnique` so a
// bearer only authenticates while a matching Session row exists (see
// api/utils/sessionAuth.ts). Hoisted so the vi.mock factory can close over it.
const { SESSIONS } = vi.hoisted(() => ({ SESSIONS: new Map<string, string>() }));

// Minimal in-memory prisma for the editor-state spawn endpoints.
type MapRec = {
  id: string;
  name: string;
  tenantId: string;
  meta: any;
};

const mem = {
  maps: [] as MapRec[],
  membership: { role: 'owner' } as { role: string } | null,
};

// api routes import PrismaClient from '../../generated/prisma/index.js'.
vi.mock('../../generated/prisma/index.js', () => {
  class PrismaClientMock {
    $queryRaw() {
      return [];
    }
    $transaction(callback: (client: PrismaClientMock) => Promise<unknown>) {
      return callback(this);
    }
    map = {
      findFirst({ where }: any) {
        return (
          mem.maps.find((m) => {
            if (where.tenantId && m.tenantId !== where.tenantId) return false;
            if (where.id !== undefined && m.id !== where.id) return false;
            if (where.name !== undefined && m.name !== where.name) return false;
            return true;
          }) || null
        );
      },
      findUnique({ where }: any) {
        return mem.maps.find((m) => m.id === where.id) || null;
      },
      update({ where, data }: any) {
        const m = mem.maps.find((mm) => mm.id === where.id);
        if (!m) throw new Error('map not found');
        Object.assign(m, data);
        return m as any;
      },
    };
    room = {
      findFirst() {
        return { id: 'room1', mapId: 'test', tenantId: 't1' } as any;
      },
      create({ data }: any) {
        return { id: 'room1', ...data };
      },
    };
    zone = {
      findMany() {
        return [] as any;
      },
      deleteMany() {
        return { count: 0 } as any;
      },
      create() {
        return {} as any;
      },
    };
    tenant = {
      findUnique() {
        return { id: 't1', slug: 'default' } as any;
      },
    };
    membership = {
      findUnique() {
        return mem.membership;
      },
    };
    apiToken = {
      findUnique() {
        return null;
      },
      update() {
        return;
      },
    };
    session = {
      findUnique({ where }: any) {
        const userId = SESSIONS.get(where.tokenHash);
        if (!userId) return null;
        return {
          id: `sess_${userId}`,
          userId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          lastActiveAt: new Date(),
        };
      },
      update() {
        return;
      },
    };
  }
  return {
    PrismaClient: PrismaClientMock,
    Prisma: {
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
      TransactionIsolationLevel: { Serializable: 'Serializable' },
    },
  };
});

import { registerApi } from '../../api.js';
import { hashSessionToken } from '../../api/utils/sessionAuth.js';

function sessionBearer(userId: string): string {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET as string);
  SESSIONS.set(hashSessionToken(token), userId);
  return `Bearer ${token}`;
}

async function createApp() {
  const app = express();
  app.use(cookieParser() as any);
  app.use(express.json() as any);
  app.use(express.urlencoded({ extended: true }) as any);
  app.use((req, _res, next) => {
    (req as any).tenant = { id: 't1', slug: 'default' };
    next();
  });
  await registerApi(app as any);
  return app;
}

function seedMap() {
  mem.maps = [{ id: 'test', name: 'test', tenantId: 't1', meta: {} }];
}

async function getSpawn(app: express.Express) {
  const res = await request(app)
    .get('/maps/test/editor-state')
    .set('Authorization', sessionBearer('owner1'))
    .set('x-tenant', 'default');
  expect(res.status).toBe(200);
  return res.body.spawn;
}

describe('editor-state spawn removal', () => {
  beforeEach(() => {
    seedMap();
    mem.membership = { role: 'owner' };
  });

  it('stores a new spawn', async () => {
    const app = await createApp();
    const put = await request(app)
      .put('/maps/test/editor-state')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ spawn: { x: 3, y: 4 } });
    expect(put.status).toBe(200);
    expect(await getSpawn(app)).toEqual({ x: 3, y: 4 });
  });

  it('keeps the saved spawn when the body omits spawn', async () => {
    const app = await createApp();
    const seed = await request(app)
      .put('/maps/test/editor-state')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ spawn: { x: 7, y: 9 } });
    expect(seed.status).toBe(200);
    const put = await request(app)
      .put('/maps/test/editor-state')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ backgroundColor: '#101010' });
    expect(put.status).toBe(200);
    expect(await getSpawn(app)).toEqual({ x: 7, y: 9 });
  });

  it('removes a saved spawn when the body sends spawn null', async () => {
    const app = await createApp();
    const seed = await request(app)
      .put('/maps/test/editor-state')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ spawn: { x: 5, y: 6 } });
    expect(seed.status).toBe(200);
    expect(await getSpawn(app)).toEqual({ x: 5, y: 6 });
    const put = await request(app)
      .put('/maps/test/editor-state')
      .set('Authorization', sessionBearer('owner1'))
      .set('x-tenant', 'default')
      .send({ spawn: null });
    expect(put.status).toBe(200);
    expect(await getSpawn(app)).toBeNull();
  });
});

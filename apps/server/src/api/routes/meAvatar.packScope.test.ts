import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { PNG } from 'pngjs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tenancy = vi.hoisted(() => ({ enabled: false, resolver: vi.fn() }));

vi.hoisted(() => {
  process.env.RATE_LIMIT_AVATAR_COMPOSE_MAX = '500';
});

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancy.enabled
        ? { version: 1, isMultiTenantEnabled: () => true, resolvePackVisibility: tenancy.resolver }
        : { version: 1, isMultiTenantEnabled: () => false },
    ),
}));

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerMeAvatarRoutes } from './meAvatar.js';
import { requireAuth } from '../utils/authHelpers.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import {
  ENTERPRISE_PACK_RESOLVER_STATES,
  type EnterprisePackResolverState,
} from '../../testUtils/enterprisePackResolverStates.js';

const TENANT_ID = 'tenant-a';
const EXISTING_UUID = '11111111-1111-4111-8111-111111111111';
const packsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meavatar-pack-scope-'));
process.env.ASSET_PACKS_DIR = packsDir;
process.env.AVATAR_EDITOR_ENABLED = 'true';

interface CustomAvatarRow {
  uuid: string;
  userId: string;
  tenantId: string | null;
  config: unknown;
  spriteUrl: string;
  previewUrl: string | null;
  configHash: string;
}

function makePrisma() {
  const rows = new Map<string, CustomAvatarRow>();
  rows.set('resolver-user', {
    uuid: EXISTING_UUID,
    userId: 'resolver-user',
    tenantId: TENANT_ID,
    config: {},
    spriteUrl: `/packs/avatars/custom/${EXISTING_UUID}.png`,
    previewUrl: null,
    configHash: 'existing',
  });
  const prisma = {
    customAvatar: {
      findUnique: vi.fn(({ where }: { where: { userId: string } }) => Promise.resolve(rows.get(where.userId) ?? null)),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: CustomAvatarRow;
          update: CustomAvatarRow;
        }) => {
          const row = rows.has(where.userId) ? { ...rows.get(where.userId)!, ...update } : create;
          rows.set(where.userId, row);
          return Promise.resolve(row);
        },
      ),
      update: vi.fn(() => Promise.resolve({})),
      findMany: vi.fn(({ where }: { where: { uuid: { in: string[] }; tenantId?: string } }) =>
        Promise.resolve(
          [...rows.values()].filter(
            (row) =>
              where.uuid.in.includes(row.uuid) && (where.tenantId === undefined || row.tenantId === where.tenantId),
          ),
        ),
      ),
    },
    user: { update: vi.fn(() => Promise.resolve({})) },
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug: string } }) =>
        Promise.resolve(where.slug === 'internal' ? { id: 'internal-tenant' } : null),
      ),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string } } }) =>
        Promise.resolve(where.tenantId_userId.tenantId === TENANT_ID ? { role: 'member' } : null),
      ),
    },
  } as PrismaClient;
  return { prisma, rows };
}

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = String(req.headers['x-user']);
    setAuthResolution(req, {
      auth: { userId, tenantId: TENANT_ID, sessionId: `session-${userId}`, tokenHash: `hash-${userId}` },
    });
    req.tenant = { id: TENANT_ID, slug: 'tenant-a', name: 'Tenant A' } as never;
    next();
  });
  registerMeAvatarRoutes(app, prisma, requireAuth);
  return app;
}

function configureResolver(state: EnterprisePackResolverState): void {
  tenancy.enabled = state.hook !== 'absent';
  if (state.hook === 'reject') {
    tenancy.resolver.mockRejectedValue(new Error('catalogue unavailable'));
  } else if (state.hook === 'resolve') {
    tenancy.resolver.mockResolvedValue(state.result?.(['premium']));
  }
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

beforeEach(() => {
  tenancy.enabled = false;
  tenancy.resolver.mockReset();
  process.env.AVATAR_EDITOR_ENABLED = 'true';
  const spriteDir = path.join(packsDir, 'avatars', 'custom');
  fs.mkdirSync(spriteDir, { recursive: true });
  fs.writeFileSync(path.join(spriteDir, `${EXISTING_UUID}.png`), PNG.sync.write(new PNG({ width: 64, height: 128 })));
});

afterAll(() => {
  fs.rmSync(packsDir, { recursive: true, force: true });
  delete process.env.RATE_LIMIT_AVATAR_COMPOSE_MAX;
  delete process.env.ASSET_PACKS_DIR;
  delete process.env.AVATAR_EDITOR_ENABLED;
});

describe('custom-avatar enterprise resolver states', () => {
  it.each(ENTERPRISE_PACK_RESOLVER_STATES)('applies $name to compose and resolve', async (state) => {
    configureResolver(state);
    const { prisma, rows } = makePrisma();
    const app = makeApp(prisma);
    const compose = await request(app).post('/me/avatar/compose').set('x-user', 'compose-user').send(validConfig);
    const resolve = await request(app)
      .post('/avatars/resolve')
      .set('x-user', 'resolver-user')
      .send({ ids: [`custom:${EXISTING_UUID}`] });

    if (state.expected === 'error') {
      expect([compose.status, resolve.status]).toEqual([500, 500]);
      expect(rows.get('compose-user')).toBeUndefined();
      return;
    }
    expect(compose.status).toBe(200);
    expect(rows.get('compose-user')?.tenantId).toBe(TENANT_ID);
    expect(resolve.status).toBe(200);
    expect(Object.keys(resolve.body.manifests)).toEqual([`custom:${EXISTING_UUID}`]);
  });
});

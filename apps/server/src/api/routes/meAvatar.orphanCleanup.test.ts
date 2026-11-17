/**
 * Route-level regression for custom-avatar orphan cleanup on compose.
 * Drives the real registerMeAvatarRoutes HTTP path (Express + Supertest +
 * requireAuth + PackScope). Does not import the orphan-cleanup service so the
 * same file can fail on a pre-cleanup baseline via FS assertions.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import express from 'express';
import request from 'supertest';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.hoisted(() => {
  process.env.RATE_LIMIT_AVATAR_COMPOSE_MAX = '500';
});

const packsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meavatar-orphan-route-'));
process.env.ASSET_PACKS_DIR = packsDir;
process.env.AVATAR_EDITOR_ENABLED = 'true';

import { registerMeAvatarRoutes } from './meAvatar.js';
import { requireAuth } from '../utils/authHelpers.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { customAvatarDir, writeCustomAvatarFiles } from '../../services/avatarComposer.js';

const TENANT_A = 'tenant-orphan-a';
const RETIREMENTS_DIR = '.custom-avatar-retirements';
/** 365d + 1d past retirement — wall-clock stable, no mtime tricks. */
const RETIRED_AT_ISO = '2020-01-01T00:00:00.000Z';

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

interface ResolveWhere {
  uuid: { in: string[] };
  tenantId?: string;
}

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
      findFirst: vi.fn(({ where }: { where: { uuid?: string } }) => {
        if (typeof where.uuid !== 'string') return Promise.resolve(null);
        const row = Array.from(byUser.values()).find((r) => r.uuid === where.uuid);
        return Promise.resolve(row ?? null);
      }),
      update: vi.fn(({ where, data }: { where: { userId: string }; data: Partial<Row> }) => {
        const existing = byUser.get(where.userId);
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
      findFirst: vi.fn(({ where }: { where: { avatarId?: string } }) => {
        if (typeof where.avatarId !== 'string') return Promise.resolve(null);
        for (const [id, avatarId] of userAvatarId.entries()) {
          if (avatarId === where.avatarId) return Promise.resolve({ id });
        }
        return Promise.resolve(null);
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
        Promise.resolve(where.slug === 'internal' ? { id: 'internal-tenant', slug: 'internal' } : null),
      ),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, byUser, userAvatarId };
}

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

function tinyPng(): Buffer {
  const png = new PNG({ width: 1, height: 1 });
  png.data[0] = 255;
  png.data[1] = 0;
  png.data[2] = 0;
  png.data[3] = 255;
  return PNG.sync.write(png);
}

function spritePathForUuid(uuid: string): string {
  return path.join(customAvatarDir(packsDir), `${uuid}.png`);
}

function previewPathForUuid(uuid: string): string {
  return path.join(customAvatarDir(packsDir), `${uuid}_p.png`);
}

function retirementMarkerPath(uuid: string): string {
  return path.join(packsDir, RETIREMENTS_DIR, `${uuid}.json`);
}

/** Plant a due, unreferenced retirement exactly as the product marker format. */
async function plantDueOrphan(uuid: string): Promise<void> {
  const png = tinyPng();
  await writeCustomAvatarFiles(packsDir, uuid, png, png);
  await fs.promises.mkdir(path.join(packsDir, RETIREMENTS_DIR), { recursive: true });
  await fs.promises.writeFile(retirementMarkerPath(uuid), JSON.stringify({ uuid, retiredAt: RETIRED_AT_ISO }), 'utf8');
}

afterAll(() => {
  fs.rmSync(packsDir, { recursive: true, force: true });
  delete process.env.RATE_LIMIT_AVATAR_COMPOSE_MAX;
});

describe('POST /me/avatar/compose orphan cleanup', () => {
  it('removes expired unreferenced sprite files and retirement marker after compose', async () => {
    const { prisma } = makePrisma([{ tenantId: TENANT_A, userId: 'u-orphan', role: 'member' }]);
    const app = makeApp(prisma);

    const liveRes = await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u-orphan')
      .set('x-session-tenant', TENANT_A)
      .send(validConfig)
      .expect(200);
    const liveUuid = String(liveRes.body.avatarId).slice('custom:'.length);

    const orphanUuid = crypto.randomUUID();
    expect(orphanUuid).not.toBe(liveUuid);
    await plantDueOrphan(orphanUuid);
    expect(fs.existsSync(spritePathForUuid(orphanUuid))).toBe(true);
    expect(fs.existsSync(previewPathForUuid(orphanUuid))).toBe(true);
    expect(fs.existsSync(retirementMarkerPath(orphanUuid))).toBe(true);

    await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u-orphan')
      .set('x-session-tenant', TENANT_A)
      .send(validConfig)
      .expect(200);

    expect(fs.existsSync(spritePathForUuid(orphanUuid))).toBe(false);
    expect(fs.existsSync(previewPathForUuid(orphanUuid))).toBe(false);
    expect(fs.existsSync(retirementMarkerPath(orphanUuid))).toBe(false);
    expect(fs.existsSync(spritePathForUuid(liveUuid))).toBe(true);
  });

  it('writes a retirement marker for the previous uuid and keeps its png files', async () => {
    const { prisma } = makePrisma([{ tenantId: TENANT_A, userId: 'u-rotate', role: 'member' }]);
    const app = makeApp(prisma);

    const first = await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u-rotate')
      .set('x-session-tenant', TENANT_A)
      .send(validConfig)
      .expect(200);
    const firstUuid = String(first.body.avatarId).slice('custom:'.length);

    const second = await request(app)
      .post('/me/avatar/compose')
      .set('x-user', 'u-rotate')
      .set('x-session-tenant', TENANT_A)
      .send({ ...validConfig, hair: 'bald' })
      .expect(200);
    const secondUuid = String(second.body.avatarId).slice('custom:'.length);
    expect(secondUuid).not.toBe(firstUuid);

    expect(fs.existsSync(retirementMarkerPath(firstUuid))).toBe(true);
    const marker = JSON.parse(fs.readFileSync(retirementMarkerPath(firstUuid), 'utf8')) as {
      uuid: string;
      retiredAt: string;
    };
    expect(marker.uuid).toBe(firstUuid);
    expect(typeof marker.retiredAt).toBe('string');
    expect(Number.isFinite(Date.parse(marker.retiredAt))).toBe(true);
    expect(fs.existsSync(spritePathForUuid(firstUuid))).toBe(true);
    expect(fs.existsSync(previewPathForUuid(firstUuid))).toBe(true);
    expect(fs.existsSync(spritePathForUuid(secondUuid))).toBe(true);
  });
});

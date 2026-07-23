/**
 * Ownership tests for the NPC avatar surface.
 *
 * `AvatarPack.tenantId` makes a pack private to exactly one tenant
 * (prisma/schema.prisma). The user-facing paths (PATCH /me/avatar,
 * onboarding-complete, the Colyseus avatar_change handler) enforce that through
 * `isAllowedAvatarId`; the NPC routes persisted and broadcast `avatarId`
 * unchecked, so an admin of ANY tenant could pin an NPC to an id out of a
 * foreign tenant's private pack. Three ways in — create, update and the
 * `set_avatar` command — so all three are covered here.
 *
 * Custom avatars carry a SECOND, harder rule on this surface: an NPC may not
 * wear one at all, not even its own tenant's. NPC players are exempt from the
 * per-client tenant StateView (rooms/lifecycle/tenantView.ts) and are broadcast
 * to every tenant sharing the room, so the uuid — and with it the public,
 * session-less sprite URL (services/avatarComposer.ts) — would cross the tenant
 * boundary. Each of the three ways in is covered for that too.
 *
 * In-memory Prisma double plus the real session-auth middleware; no database.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerNpcRoutes } from './npcs.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

const TEST_SECRET = 'npc-avatar-test-secret';
const TENANT_CUSTOMER = 'tenant-customer';
const TENANT_LM = 'tenant-lm';
const ADMIN_USER = 'admin-user';

const FOREIGN_AVATAR = 'lass-machen-avatar-pack:old_man';
const CATALOG_AVATAR = 'shared-pack:hero';
const BUILTIN_AVATAR = 'default-characters:business_man';

// A custom avatar composed by a member OF THE CALLER'S OWN tenant. The scope
// check would wave it through — the ban is categorical, see below.
const OWN_CUSTOM_UUID = '90579cc0-b608-4dc0-a4e4-cb8e4495fe70';
const OWN_CUSTOM_AVATAR = `custom:${OWN_CUSTOM_UUID}`;

interface PackRow {
  id: number;
  uuid: string;
  tenantId: string | null;
  avatars: Array<{ key: string }>;
}

const PACKS: readonly PackRow[] = [
  { id: 1, uuid: 'shared-pack', tenantId: null, avatars: [{ key: 'hero' }] },
  { id: 2, uuid: 'lass-machen-avatar-pack', tenantId: TENANT_LM, avatars: [{ key: 'old_man' }] },
];

/** The where shapes `isAllowedAvatarId` builds via `avatarPackScopeWhere`. */
interface PackWhere {
  uuid?: string;
  tenantId?: string | null;
  OR?: Array<{ tenantId: string | null }>;
}

function matchesWhere(row: PackRow, where: PackWhere): boolean {
  if (where.uuid !== undefined && row.uuid !== where.uuid) return false;
  if (where.OR) return where.OR.some((clause) => clause.tenantId === row.tenantId);
  if (where.tenantId !== undefined) return row.tenantId === where.tenantId;
  return true;
}

/** tokenHash -> userId, the session rows the Prisma double serves. */
const SESSIONS = new Map<string, string>();

const EXISTING_NPC = { id: 'npc-1', identity: 'bob', tenantId: TENANT_CUSTOMER, name: 'Bob' };

function makePrisma() {
  const npcCreate = vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'npc-new', ...data }));
  const npcUpdate = vi.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...EXISTING_NPC, ...data }),
  );
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
    // No `internal` tenant: the caller is an ordinary tenant admin, never the
    // platform super-admin, so the scope resolves to its own tenant.
    tenant: { findUnique: vi.fn(() => Promise.resolve(null)) },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) =>
        Promise.resolve(
          where.tenantId_userId.tenantId === TENANT_CUSTOMER && where.tenantId_userId.userId === ADMIN_USER
            ? { role: 'admin' }
            : null,
        ),
      ),
    },
    avatarPack: {
      findFirst: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(PACKS.find((row) => matchesWhere(row, where)) ?? null),
      ),
    },
    // findFirst, matching the scoped lookup in avatarAccess.ts. The fixture row
    // belongs to the CALLER'S OWN tenant on purpose: `isAllowedAvatarId` would
    // therefore accept it, so the NPC routes can only stay green by refusing
    // custom ids categorically, before the scope is ever consulted.
    customAvatar: {
      findFirst: vi.fn(({ where }: { where: { uuid?: string; tenantId?: string | null } }) =>
        Promise.resolve(
          where.uuid === OWN_CUSTOM_UUID && where.tenantId === TENANT_CUSTOMER ? { uuid: OWN_CUSTOM_UUID } : null,
        ),
      ),
    },
    npc: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      findFirst: vi.fn(() => Promise.resolve(EXISTING_NPC)),
      create: npcCreate,
      update: npcUpdate,
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    npcCreate,
    npcUpdate,
    customAvatarFindFirst: prisma.customAvatar.findFirst,
  };
}

const TENANT: Partial<Tenant> = { id: TENANT_CUSTOMER, slug: 'customer', name: 'Customer GmbH' };

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use(createSessionAuthMiddleware(prisma));
  app.use((req, _res, next) => {
    (req as unknown as { tenant: Partial<Tenant> }).tenant = TENANT;
    next();
  });
  registerNpcRoutes(app, prisma);
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

describe('POST /npcs', () => {
  it("rejects an avatar from a foreign tenant's private pack", async () => {
    const { prisma, npcCreate } = makePrisma();
    const res = await request(makeApp(prisma))
      .post('/npcs')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ identity: 'spy', name: 'Spy', avatarId: FOREIGN_AVATAR })
      .expect(400);
    expect(res.body).toMatchObject({ error: 'invalid_avatar_id' });
    expect(npcCreate).not.toHaveBeenCalled();
  });

  it("rejects a custom avatar even from the caller's OWN tenant", async () => {
    const { prisma, npcCreate, customAvatarFindFirst } = makePrisma();
    const res = await request(makeApp(prisma))
      .post('/npcs')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ identity: 'spy', name: 'Spy', avatarId: OWN_CUSTOM_AVATAR })
      .expect(400);
    expect(res.body).toMatchObject({ error: 'invalid_avatar_id' });
    expect(npcCreate).not.toHaveBeenCalled();
    // Refused on the prefix alone — the scope was never even asked.
    expect(customAvatarFindFirst).not.toHaveBeenCalled();
  });

  it('accepts a catalog-pack avatar and a built-in default avatar', async () => {
    for (const avatarId of [CATALOG_AVATAR, BUILTIN_AVATAR]) {
      const { prisma, npcCreate } = makePrisma();
      await request(makeApp(prisma))
        .post('/npcs')
        .set('authorization', sessionBearer(ADMIN_USER))
        .send({ identity: 'bot', name: 'Bot', avatarId })
        .expect(201);
      expect(npcCreate).toHaveBeenCalledTimes(1);
    }
  });
});

describe('PATCH /npcs/:id', () => {
  it("rejects an avatar from a foreign tenant's private pack", async () => {
    const { prisma, npcUpdate } = makePrisma();
    const res = await request(makeApp(prisma))
      .patch('/npcs/npc-1')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ avatarId: FOREIGN_AVATAR })
      .expect(400);
    expect(res.body).toMatchObject({ error: 'invalid_avatar_id' });
    expect(npcUpdate).not.toHaveBeenCalled();
  });

  it("rejects a custom avatar even from the caller's OWN tenant", async () => {
    const { prisma, npcUpdate, customAvatarFindFirst } = makePrisma();
    const res = await request(makeApp(prisma))
      .patch('/npcs/npc-1')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ avatarId: OWN_CUSTOM_AVATAR })
      .expect(400);
    expect(res.body).toMatchObject({ error: 'invalid_avatar_id' });
    expect(npcUpdate).not.toHaveBeenCalled();
    expect(customAvatarFindFirst).not.toHaveBeenCalled();
  });

  it('accepts a catalog-pack avatar', async () => {
    const { prisma, npcUpdate } = makePrisma();
    await request(makeApp(prisma))
      .patch('/npcs/npc-1')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ avatarId: CATALOG_AVATAR })
      .expect(200);
    expect(npcUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('POST /npcs/:id/command set_avatar', () => {
  it("rejects an avatar from a foreign tenant's private pack", async () => {
    const { prisma } = makePrisma();
    const res = await request(makeApp(prisma))
      .post('/npcs/npc-1/command')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ action: 'set_avatar', payload: { avatarId: FOREIGN_AVATAR } })
      .expect(400);
    expect(res.body).toMatchObject({ error: 'invalid_avatar_id' });
  });

  it("rejects a custom avatar even from the caller's OWN tenant", async () => {
    const { prisma, customAvatarFindFirst } = makePrisma();
    const res = await request(makeApp(prisma))
      .post('/npcs/npc-1/command')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ action: 'set_avatar', payload: { avatarId: OWN_CUSTOM_AVATAR } })
      .expect(400);
    expect(res.body).toMatchObject({ error: 'invalid_avatar_id' });
    expect(customAvatarFindFirst).not.toHaveBeenCalled();
  });

  it('accepts a catalog-pack avatar', async () => {
    const { prisma } = makePrisma();
    await request(makeApp(prisma))
      .post('/npcs/npc-1/command')
      .set('authorization', sessionBearer(ADMIN_USER))
      .send({ action: 'set_avatar', payload: { avatarId: CATALOG_AVATAR } })
      .expect(200);
  });
});

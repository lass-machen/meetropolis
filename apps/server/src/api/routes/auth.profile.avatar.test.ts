import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenancy = vi.hoisted(() => ({ enabled: false, resolver: vi.fn() }));

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

import { handleOnboardingComplete } from './auth.profile.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import {
  ENTERPRISE_PACK_RESOLVER_STATES,
  type EnterprisePackResolverState,
} from '../../testUtils/enterprisePackResolverStates.js';

const TENANT_ID = 'tenant-a';
const USER_ID = 'user-a';
const PACKS = [
  { uuid: 'default-characters', tenantId: null, avatars: [{ key: 'business_man' }] },
  { uuid: 'premium', tenantId: null, avatars: [{ key: 'hero' }] },
];

interface PackWhere {
  uuid?: string | { notIn: string[] };
  tenantId?: string | null;
  AND?: PackWhere[];
  OR?: PackWhere[];
}

function matchesPack(pack: (typeof PACKS)[number], where: PackWhere): boolean {
  if (typeof where.uuid === 'string' && pack.uuid !== where.uuid) return false;
  if (typeof where.uuid === 'object' && where.uuid.notIn.includes(pack.uuid)) return false;
  if (where.tenantId !== undefined && pack.tenantId !== where.tenantId) return false;
  if (where.AND && !where.AND.every((clause) => matchesPack(pack, clause))) return false;
  if (where.OR && !where.OR.some((clause) => matchesPack(pack, clause))) return false;
  return true;
}

function makePrisma() {
  const saved: string[] = [];
  const prisma = {
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug: string } }) =>
        Promise.resolve(where.slug === 'internal' ? { id: 'internal-tenant' } : null),
      ),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        return Promise.resolve(tenantId === TENANT_ID && userId === USER_ID ? { role: 'member' } : null);
      }),
    },
    avatarPack: {
      findFirst: vi.fn(({ where }: { where: PackWhere }) => {
        const pack = PACKS.find((candidate) => matchesPack(candidate, where));
        return Promise.resolve(pack ? { avatars: pack.avatars } : null);
      }),
    },
    customAvatar: { findFirst: vi.fn(() => Promise.resolve(null)) },
    user: {
      update: vi.fn(({ data }: { data: { avatarId?: string } }) => {
        if (data.avatarId) saved.push(data.avatarId);
        return Promise.resolve({ id: USER_ID, onboardingCompleted: true, ...data });
      }),
    },
  } as PrismaClient;
  return { prisma, saved };
}

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    setAuthResolution(req, {
      auth: { userId: USER_ID, tenantId: TENANT_ID, sessionId: 'session-a', tokenHash: 'hash-a' },
    });
    req.tenant = { id: TENANT_ID, slug: 'tenant-a', name: 'Tenant A' } as never;
    next();
  });
  app.post('/auth/onboarding/complete', (req, res) => {
    void handleOnboardingComplete(prisma, req, res);
  });
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

beforeEach(() => {
  tenancy.enabled = false;
  tenancy.resolver.mockReset();
});

describe('handleOnboardingComplete pack scope', () => {
  it.each(ENTERPRISE_PACK_RESOLVER_STATES)('applies $name to onboarding avatar selection', async (state) => {
    configureResolver(state);
    const { prisma, saved } = makePrisma();
    const app = makeApp(prisma);
    const catalogue = await request(app).post('/auth/onboarding/complete').send({ avatarId: 'premium:hero' });
    const base = await request(app)
      .post('/auth/onboarding/complete')
      .send({ avatarId: 'default-characters:business_man' });

    if (state.expected === 'error') {
      expect([catalogue.status, base.status]).toEqual([500, 500]);
      expect(saved).toEqual([]);
      return;
    }
    expect(catalogue.status).toBe(state.expected === 'accessible' ? 200 : 400);
    expect(base.status).toBe(200);
    expect(saved).toContain('default-characters:business_man');
  });
});

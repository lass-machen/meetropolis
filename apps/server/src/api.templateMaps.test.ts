/**
 * Tests for `copyTemplateMapsForSignup` — the starter-world handout every
 * freshly signed-up tenant runs through.
 *
 * The contract under test:
 * - EXACTLY ONE map is copied, and it is the template tenant's own
 *   `defaultMapName`. The template tenant is an editable workspace, so extra
 *   maps (drafts, archived variants) must never reach a customer.
 * - There is no "first map" fallback. When `defaultMapName` is unusable the
 *   function copies nothing and says so in the log, rather than guessing.
 * - It never throws: the enterprise signup calls it best-effort through the
 *   admin-loader contract, and a failed copy must not abort the sign-up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from './generated/prisma/index.js';

const TEMPLATE_SLUG = 'template';
const NEW_TENANT_ID = 'tenant-new';

// api.ts builds a PrismaClient at module scope. Mocking the generated client
// keeps the import free of any database contact; every test injects its own
// prisma double as a function argument instead.
vi.mock('./generated/prisma/index.js', () => {
  class PrismaClientMock {}
  return { PrismaClient: PrismaClientMock };
});

// `copyMapToTenant` is shared infrastructure (POST /admin/maps/:id/copy uses the
// same function) and has its own tests. Here only the call — how often, with
// which map — is under test, so the deep copy is stubbed out.
const { copyMapToTenant, registerAdminMapRoutes } = vi.hoisted(() => ({
  copyMapToTenant: vi.fn(),
  registerAdminMapRoutes: vi.fn(),
}));
vi.mock('./api/routes/adminMaps.js', () => ({ copyMapToTenant, registerAdminMapRoutes }));

const { logger } = vi.hoisted(() => ({
  logger: { level: 'silent', debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./logger.js', () => ({ logger }));

// Imported after the mocks so the module graph picks them up.
import { copyTemplateMapsForSignup } from './api.js';
import { DEFAULT_TEMPLATE_TENANT_SLUG } from './services/templateTenant.js';

interface TemplateTenant {
  defaultMapName: string | null;
  maps: Array<{ id: string; name: string }>;
}

function makePrisma(template: TemplateTenant | null) {
  const findUnique = vi.fn(({ where }: { where: { slug: string } }) =>
    Promise.resolve(
      template && where.slug === TEMPLATE_SLUG ? { id: 'tenant-template', slug: where.slug, ...template } : null,
    ),
  );
  const update = vi.fn(() => Promise.resolve({}));
  const prisma = { tenant: { findUnique, update } } as unknown as PrismaClient;
  return { prisma, findUnique, update };
}

/** The copied map keeps its requested name unless a test says otherwise. */
function resolveCopyAs(name: string) {
  copyMapToTenant.mockResolvedValue({ id: 'map-copy', name });
}

const previousSlug = process.env.TEMPLATE_TENANT_SLUG;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TEMPLATE_TENANT_SLUG = TEMPLATE_SLUG;
  resolveCopyAs('office');
});

afterEach(() => {
  if (previousSlug === undefined) delete process.env.TEMPLATE_TENANT_SLUG;
  else process.env.TEMPLATE_TENANT_SLUG = previousSlug;
});

describe('copyTemplateMapsForSignup', () => {
  it('copies exactly one map — the template default — even when the template holds several', async () => {
    const { prisma, update } = makePrisma({
      defaultMapName: 'office',
      maps: [
        { id: 'map-draft', name: 'office-draft' },
        { id: 'map-office', name: 'office' },
        { id: 'map-old', name: 'office-2024' },
      ],
    });

    await copyTemplateMapsForSignup(prisma, NEW_TENANT_ID);

    expect(copyMapToTenant).toHaveBeenCalledTimes(1);
    expect(copyMapToTenant).toHaveBeenCalledWith(prisma, 'map-office', NEW_TENANT_ID, 'office');
    expect(update).toHaveBeenCalledWith({ where: { id: NEW_TENANT_ID }, data: { defaultMapName: 'office' } });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'signup.template_copy_ok', mapName: 'office' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('adopts the name the copy actually got, not the requested one', async () => {
    // copyMapToTenant resolves collisions by suffixing. Storing the requested
    // name would leave the tenant pointing at a map that does not exist.
    resolveCopyAs('office-2');
    const { prisma, update } = makePrisma({ defaultMapName: 'office', maps: [{ id: 'map-office', name: 'office' }] });

    await copyTemplateMapsForSignup(prisma, NEW_TENANT_ID);

    expect(update).toHaveBeenCalledWith({ where: { id: NEW_TENANT_ID }, data: { defaultMapName: 'office-2' } });
  });

  it('copies nothing when the template tenant has no defaultMapName', async () => {
    const { prisma, update } = makePrisma({ defaultMapName: null, maps: [{ id: 'map-a', name: 'office' }] });

    await copyTemplateMapsForSignup(prisma, NEW_TENANT_ID);

    expect(copyMapToTenant).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'signup.template_default_map_missing', tenantId: NEW_TENANT_ID }),
    );
  });

  it('copies nothing when the template tenant has no maps at all', async () => {
    const { prisma, update } = makePrisma({ defaultMapName: 'office', maps: [] });

    await copyTemplateMapsForSignup(prisma, NEW_TENANT_ID);

    expect(copyMapToTenant).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'signup.template_map_not_found', templateMapCount: 0 }),
    );
  });

  it('does NOT fall back to the first map when defaultMapName names an absent map', async () => {
    const { prisma, update } = makePrisma({
      defaultMapName: 'office',
      maps: [
        { id: 'map-draft', name: 'office-draft' },
        { id: 'map-old', name: 'office-2024' },
      ],
    });

    await copyTemplateMapsForSignup(prisma, NEW_TENANT_ID);

    expect(copyMapToTenant).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'signup.template_map_not_found',
        defaultMapName: 'office',
        templateMapCount: 2,
      }),
    );
  });

  it('copies nothing when TEMPLATE_TENANT_SLUG points at an unknown tenant', async () => {
    const { prisma, findUnique, update } = makePrisma(null);

    await copyTemplateMapsForSignup(prisma, NEW_TENANT_ID);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(copyMapToTenant).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'signup.template_tenant_not_found', templateSlug: TEMPLATE_SLUG }),
    );
  });

  it('falls back to the default blueprint slug when TEMPLATE_TENANT_SLUG is unset', async () => {
    // Both sides of the contract read `resolveTemplateTenantSlug`, so an
    // installation that never sets the variable still copies from the tenant
    // the seed bootstrapped. Previously this returned silently: the seed built
    // a `template` tenant that nothing used, and every customer got no map and
    // no log line saying why.
    delete process.env.TEMPLATE_TENANT_SLUG;
    const { prisma, findUnique, update } = makePrisma({
      defaultMapName: 'office',
      maps: [{ id: 'm', name: 'office' }],
    });

    await copyTemplateMapsForSignup(prisma, NEW_TENANT_ID);

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: DEFAULT_TEMPLATE_TENANT_SLUG } }));
    expect(copyMapToTenant).toHaveBeenCalledWith(prisma, 'm', NEW_TENANT_ID, 'office');
    expect(update).toHaveBeenCalledWith({ where: { id: NEW_TENANT_ID }, data: { defaultMapName: 'office' } });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('swallows a failing map copy and leaves defaultMapName untouched', async () => {
    copyMapToTenant.mockRejectedValue(new Error('source_map_not_found'));
    const { prisma, update } = makePrisma({ defaultMapName: 'office', maps: [{ id: 'map-office', name: 'office' }] });

    await expect(copyTemplateMapsForSignup(prisma, NEW_TENANT_ID)).resolves.toBeUndefined();

    expect(update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'signup.template_copy_failed', tenantId: NEW_TENANT_ID }),
    );
  });

  it('swallows a failing tenant lookup', async () => {
    const findUnique = vi.fn(() => Promise.reject(new Error('db down')));
    const prisma = { tenant: { findUnique, update: vi.fn() } } as unknown as PrismaClient;

    await expect(copyTemplateMapsForSignup(prisma, NEW_TENANT_ID)).resolves.toBeUndefined();

    expect(copyMapToTenant).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'signup.template_copy_failed' }));
  });
});

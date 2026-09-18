import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/prisma/index.js';

const tenancy = vi.hoisted(() => ({
  enabled: true,
  resolver: vi.fn(),
}));
const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock('../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancy.enabled
        ? {
            version: 1,
            isMultiTenantEnabled: () => true,
            resolveAdditionalPackUuids: tenancy.resolver,
          }
        : { version: 1, isMultiTenantEnabled: () => false },
    ),
}));

vi.mock('../logger.js', () => ({
  logger: { warn: logger.warn, error: logger.error, info: vi.fn(), debug: vi.fn() },
}));

import { avatarPackScopeWhere, resolvePublicPackScope, resolveTenantPackScope } from './packScope.js';

const prisma = Object.create(PrismaClient.prototype) as PrismaClient;

beforeEach(() => {
  tenancy.enabled = true;
  tenancy.resolver.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe('enterprise pack scope result contract', () => {
  it('preserves OSS visibility when the optional hook is absent', async () => {
    tenancy.enabled = false;
    const scope = await resolveTenantPackScope(prisma, 'tenant-a', 'avatar');
    expect(avatarPackScopeWhere(scope)).toEqual({ OR: [{ tenantId: 'tenant-a' }, { tenantId: null }] });
  });

  it('keeps every uncatalogued global when both authoritative sets are empty', async () => {
    tenancy.resolver.mockResolvedValue({ catalogPackUuids: [], accessiblePackUuids: [] });
    const publicScope = await resolvePublicPackScope(prisma, 'avatar');
    const tenantScope = await resolveTenantPackScope(prisma, 'tenant-a', 'avatar');

    expect(avatarPackScopeWhere(publicScope)).toEqual({
      AND: [{ tenantId: null }, { uuid: { notIn: [] } }],
    });
    expect(avatarPackScopeWhere(tenantScope)).toEqual({
      OR: [{ tenantId: 'tenant-a' }, { AND: [{ tenantId: null }, { uuid: { notIn: [] } }] }],
    });
  });

  it('blocks catalogue UUIDs which are not in the accessible subset', async () => {
    tenancy.resolver.mockResolvedValue({
      catalogPackUuids: ['public', 'premium'],
      accessiblePackUuids: ['public'],
    });
    const scope = await resolvePublicPackScope(prisma, 'asset');
    expect(avatarPackScopeWhere(scope)).toEqual({
      AND: [{ tenantId: null }, { uuid: { notIn: ['premium'] } }],
    });
    expect(tenancy.resolver).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ packKind: 'asset', at: expect.any(Date) }),
    );
    expect(tenancy.resolver.mock.calls[0]?.[1]).not.toHaveProperty('tenantId');
  });

  it.each([
    ['missing', undefined],
    ['non-array', 'public'],
    ['mixed array', ['public', 7]],
  ])('fails closed for a %s accessible set while retaining base equipment', async (_name, accessiblePackUuids) => {
    tenancy.resolver.mockResolvedValue({ catalogPackUuids: ['public', 'premium'], accessiblePackUuids });
    const scope = await resolvePublicPackScope(prisma, 'avatar');
    expect(avatarPackScopeWhere(scope)).toEqual({
      AND: [{ tenantId: null }, { uuid: { notIn: ['public', 'premium'] } }],
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('ignores and logs accessible UUIDs outside the catalogue', async () => {
    tenancy.resolver.mockResolvedValue({
      catalogPackUuids: ['premium'],
      accessiblePackUuids: ['premium', 'uncatalogued-base'],
    });
    const scope = await resolvePublicPackScope(prisma, 'avatar');
    expect(avatarPackScopeWhere(scope)).toEqual({
      AND: [{ tenantId: null }, { uuid: { notIn: [] } }],
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('outside the catalogue'), expect.anything());
  });

  it.each([
    ['empty array', []],
    ['uuid array', ['premium']],
    ['undefined', undefined],
    ['non-array object field', { catalogPackUuids: 'premium', accessiblePackUuids: [] }],
    ['mixed catalogue array', { catalogPackUuids: ['premium', 7], accessiblePackUuids: [] }],
  ])('rejects a malformed catalogue result: %s', async (_name, result) => {
    tenancy.resolver.mockResolvedValue(result);
    await expect(resolvePublicPackScope(prisma, 'avatar')).rejects.toThrow('invalid catalogPackUuids');
  });

  it('propagates a rejected resolver promise instead of opening the global scope', async () => {
    tenancy.resolver.mockRejectedValue(new Error('catalogue unavailable'));
    await expect(resolveTenantPackScope(prisma, 'tenant-a', 'asset')).rejects.toThrow('catalogue unavailable');
  });
});

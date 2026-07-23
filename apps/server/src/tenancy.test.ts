import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// The module builds a PrismaClient at import time via createPrismaClient(); stub
// it so the test never constructs a real DB-backed client. Each test injects its
// own in-memory double into resolveTenantBySlug directly.
vi.mock('./db.js', () => ({ createPrismaClient: () => ({}) }));

import { resolveTenantBySlug } from './tenancy.js';
import type { PrismaClient } from './generated/prisma/index.js';

// ---------------------------------------------------------------------------
// resolveTenantBySlug — root-domain tenant resolution priority chain
//
//   1. Explicit signal — X-Tenant header or ?tenant= query
//   2. Auth token      — the `tid` claim of the session JWT
//   3. Host / default  — host label parsing, then the single-tenant default
//
// The regression this guards: api.<domain> must NOT be misread as a tenant
// named "api" for authenticated requests — the token has to win over the host.
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-tenancy-secret';

interface FakeTenant {
  id: string;
  slug: string;
  name: string;
}

/**
 * In-memory Prisma double covering exactly the two tenant delegates the
 * resolver touches: findUnique (by id for the token, by slug otherwise) and
 * create (the development auto-provision path). Records created slugs so tests
 * can assert that host labels like "api" are never minted.
 */
function makePrisma(seed: FakeTenant[]) {
  const bySlug = new Map(seed.map((t) => [t.slug, t]));
  const byId = new Map(seed.map((t) => [t.id, t]));
  const createdSlugs: string[] = [];

  const findUnique = vi.fn(({ where }: { where: { id?: string; slug?: string } }) => {
    if (where.id !== undefined) return Promise.resolve(byId.get(where.id) ?? null);
    if (where.slug !== undefined) return Promise.resolve(bySlug.get(where.slug) ?? null);
    return Promise.resolve(null);
  });
  const create = vi.fn(({ data }: { data: { slug: string; name: string } }) => {
    const created: FakeTenant = { id: `id-${data.slug}`, slug: data.slug, name: data.name };
    bySlug.set(created.slug, created);
    byId.set(created.id, created);
    createdSlugs.push(created.slug);
    return Promise.resolve(created);
  });

  const prisma = { tenant: { findUnique, create } } as unknown as PrismaClient;
  return { prisma, findUnique, create, createdSlugs };
}

function tokenFor(tid: string): string {
  return jwt.sign({ sub: 'u1', tid }, TEST_SECRET);
}

interface ReqShape {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  query: Record<string, string>;
  tenantSlug?: string;
}

function makeReq(opts: { header?: string; query?: string; cookieTid?: string; host?: string }): ReqShape {
  const headers: Record<string, string> = {};
  if (opts.header) headers['x-tenant'] = opts.header;
  if (opts.host) headers['host'] = opts.host;
  const cookies: Record<string, string> = {};
  if (opts.cookieTid) cookies['auth_token'] = tokenFor(opts.cookieTid);
  const query: Record<string, string> = {};
  if (opts.query) query['tenant'] = opts.query;
  return { headers, cookies, query };
}

// resolveTenantBySlug takes the internal TenantRequest type; the plain ReqShape
// carries every field it reads, so cast at the call boundary.
function resolve(prisma: PrismaClient, req: ReqShape) {
  return resolveTenantBySlug(prisma, req as never);
}

describe('resolveTenantBySlug — tenant resolution priority chain', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('explicit X-Tenant header beats the auth token', async () => {
    const { prisma } = makePrisma([
      { id: 'id-acme', slug: 'acme', name: 'Acme' },
      { id: 'id-lob', slug: 'lobster-1', name: 'Lobster' },
    ]);
    const req = makeReq({ header: 'acme', cookieTid: 'id-lob' });

    const tenant = await resolve(prisma, req);

    expect(tenant?.slug).toBe('acme');
    expect(req.tenantSlug).toBe('acme');
  });

  it('explicit ?tenant= query beats the auth token', async () => {
    const { prisma } = makePrisma([
      { id: 'id-acme', slug: 'acme', name: 'Acme' },
      { id: 'id-lob', slug: 'lobster-1', name: 'Lobster' },
    ]);
    const req = makeReq({ query: 'acme', cookieTid: 'id-lob' });

    const tenant = await resolve(prisma, req);

    expect(tenant?.slug).toBe('acme');
  });

  it('auth token beats the host: api.<domain> + token resolves the token tenant', async () => {
    const { prisma, findUnique } = makePrisma([{ id: 'id-lob', slug: 'lobster-1', name: 'Lobster' }]);
    const req = makeReq({ host: 'api.meetropolis.me', cookieTid: 'id-lob' });

    const tenant = await resolve(prisma, req);

    expect(tenant?.slug).toBe('lobster-1');
    expect(req.tenantSlug).toBe('lobster-1');
    // The host is never parsed for a tenant once the token resolves: no lookup
    // for the "api" label ever happens.
    const lookedUpSlugs = findUnique.mock.calls.map((c) => c[0].where.slug);
    expect(lookedUpSlugs).not.toContain('api');
  });

  it('host-only without a token: unresolved api-host falls back to the default tenant', async () => {
    const { prisma, create } = makePrisma([{ id: 'id-def', slug: 'default', name: 'Default' }]);
    const req = makeReq({ host: 'api.meetropolis.me' });

    const tenant = await resolve(prisma, req);

    expect(tenant?.slug).toBe('default');
    expect(req.tenantSlug).toBe('default');
    // Falling back to an existing default never creates an artifact tenant.
    expect(create).not.toHaveBeenCalled();
  });

  it('host-only without a token: a real host-tenant still resolves (backward compat)', async () => {
    const { prisma } = makePrisma([{ id: 'id-acme', slug: 'acme', name: 'Acme' }]);
    const req = makeReq({ host: 'acme.example.com' });

    const tenant = await resolve(prisma, req);

    expect(tenant?.slug).toBe('acme');
  });

  it('dev: an unresolved host label is never auto-created, only the default is', async () => {
    process.env.NODE_ENV = 'test';
    const { prisma, createdSlugs } = makePrisma([]);
    const req = makeReq({ host: 'api.meetropolis.localhost' });

    const tenant = await resolve(prisma, req);

    expect(tenant?.slug).toBe('default');
    expect(createdSlugs).toEqual(['default']);
    expect(createdSlugs).not.toContain('api');
  });

  it('dev: an explicit slug auto-creates its tenant', async () => {
    process.env.NODE_ENV = 'test';
    const { prisma, createdSlugs } = makePrisma([]);
    const req = makeReq({ header: 'brandnew' });

    const tenant = await resolve(prisma, req);

    expect(tenant?.slug).toBe('brandnew');
    expect(createdSlugs).toEqual(['brandnew']);
  });

  it('prod: an explicit but unknown slug resolves to null (tenant_not_found)', async () => {
    process.env.NODE_ENV = 'production';
    const { prisma, create } = makePrisma([]);
    const req = makeReq({ header: 'ghost' });

    const tenant = await resolve(prisma, req);

    expect(tenant).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

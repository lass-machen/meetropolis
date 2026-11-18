import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks must be defined before the module import.
vi.mock('../../logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./tenantMembership.js', () => ({
  isInternalOwner: vi.fn(),
}));

// Import after the mocks are set up.
import { requireApiToken, requireInternalOwner, requireSuperAdmin } from './authHelpers.js';
import { setAuthResolution } from './authState.js';
import { isInternalOwner } from './tenantMembership.js';

const mockedIsInternalOwner = vi.mocked(isInternalOwner);

// Opaque personal API token: it carries no dots, so the helper never
// mistakes it for a JWT (three dot-separated segments).
const OPAQUE_TOKEN = 'opaque-personal-token-without-dots';

interface ReqOptions {
  method?: string;
  path?: string;
  token?: string | null;
  session?: boolean;
}

// Plain request objects: the helpers only read headers.authorization,
// method and path, plus the session resolution published by the
// session-auth middleware (mirrors the pattern in authHelpers.test.ts).
function makeReq({ method = 'GET', path = '/', token = OPAQUE_TOKEN, session = false }: ReqOptions = {}) {
  const req = { cookies: {}, headers: {}, method, path } as any;
  if (token !== null) {
    req.headers.authorization = `Bearer ${token}`;
  }
  setAuthResolution(req, {
    auth: session ? { userId: 'user-1', sessionId: 'sess-1', tokenHash: 'hash-1' } : null,
  });
  return req;
}

// Minimal Prisma stand-in: findUnique resolves the stored token row (or
// null for an unknown token), update records the lastUsedAt write.
function makePrisma(scope: 'read' | 'write' | null) {
  return {
    apiToken: {
      findUnique: vi.fn().mockResolvedValue(scope === null ? null : { userId: 'user-1', scope }),
      update: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('personal API token scope enforcement', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, API_TOKEN_PEPPER: 'test-pepper' };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('read-scoped token on a regular resource path', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])('allows %s on /maps/m1/objects', async (method) => {
      const prisma = makePrisma('read');

      const result = await requireApiToken(makeReq({ method, path: '/maps/m1/objects' }), prisma);

      expect(result).toEqual(expect.objectContaining({ userId: 'user-1' }));
      expect(prisma.apiToken.update).toHaveBeenCalled();
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'refuses %s on /maps/m1/objects without touching lastUsedAt',
      async (method) => {
        const prisma = makePrisma('read');

        const result = await requireApiToken(makeReq({ method, path: '/maps/m1/objects' }), prisma);

        expect(result).toBeNull();
        expect(prisma.apiToken.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('write-scoped token on regular resource paths', () => {
    it.each([
      ['POST', '/maps/m1/objects'],
      ['PATCH', '/maps/m1/objects'],
      ['DELETE', '/maps/m1/objects'],
      ['POST', '/npcs'],
    ] as Array<[string, string]>)('allows %s on %s', async (method, path) => {
      const prisma = makePrisma('write');

      const result = await requireApiToken(makeReq({ method, path }), prisma);

      expect(result).toEqual(expect.objectContaining({ userId: 'user-1' }));
    });
  });

  describe('write-scoped token on blocked paths', () => {
    it.each([
      ['GET', '/admin/health'],
      ['POST', '/admin/maps/import'],
      ['GET', '/debug/rooms'],
      ['GET', '/api-tokens'],
      ['POST', '/api-tokens'],
      ['DELETE', '/api-tokens/tok1'],
      ['POST', '/auth/change'],
      ['DELETE', '/auth/sessions'],
      ['PATCH', '/me'],
      ['DELETE', '/users/me'],
      ['GET', '/users/me/export'],
    ] as Array<[string, string]>)('refuses %s on %s without touching lastUsedAt', async (method, path) => {
      const prisma = makePrisma('write');

      const result = await requireApiToken(makeReq({ method, path }), prisma);

      expect(result).toBeNull();
      expect(prisma.apiToken.update).not.toHaveBeenCalled();
    });
  });

  describe('write-scoped token on lookalike paths that stay open', () => {
    it.each(['/mediaplan', '/administrators-guide', '/maps/admin'])('allows GET on %s', async (path) => {
      const prisma = makePrisma('write');

      const result = await requireApiToken(makeReq({ method: 'GET', path }), prisma);

      expect(result).toEqual(expect.objectContaining({ userId: 'user-1' }));
    });
  });

  describe('unknown token', () => {
    it('returns null for a token with no stored row', async () => {
      const prisma = makePrisma(null);

      const result = await requireApiToken(makeReq({ method: 'GET', path: '/maps/m1/objects' }), prisma);

      expect(result).toBeNull();
      expect(prisma.apiToken.update).not.toHaveBeenCalled();
    });
  });

  describe('super admin with a personal API token', () => {
    it('refuses a write-scoped token of a platform owner without a session', async () => {
      mockedIsInternalOwner.mockResolvedValue(true);
      const prisma = makePrisma('write');

      const result = await requireSuperAdmin(makeReq({ method: 'GET', path: '/admin/health' }), prisma);

      expect(result).toBeNull();
    });
  });

  describe('platform ownership after a token login', () => {
    it('refuses ownership for a token-authenticated request without a session', async () => {
      mockedIsInternalOwner.mockResolvedValue(true);
      const prisma = makePrisma('write');
      const req = makeReq({ method: 'GET', path: '/asset-packs' });

      const tokenAuth = await requireApiToken(req, prisma);
      expect(tokenAuth).toEqual(expect.objectContaining({ userId: 'user-1' }));

      expect(await requireInternalOwner(req, 'user-1', prisma)).toBe(false);
    });

    it('keeps ownership for a request without any token login', async () => {
      mockedIsInternalOwner.mockResolvedValue(true);
      const prisma = makePrisma(null);

      expect(await requireInternalOwner(makeReq({ token: null }), 'user-1', prisma)).toBe(true);
    });
  });
});

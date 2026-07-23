import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Mocks must be defined before the module import.
vi.mock('../../logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Import after the mocks are set up.
import {
  setAuthCookie,
  requireAuth,
  normalizeEmailForStorage,
  normalizeEmailForMatching,
  computeOnlineUsageByTenantSlug,
} from './authHelpers.js';
import { setAuthResolution, type ResolvedAuth } from './authState.js';

describe('authHelpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Clear cached secrets
    (globalThis as any).__DEV_JWT_SECRET__ = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('getJwtSecret', () => {
    it('should return JWT_SECRET from environment', async () => {
      process.env.JWT_SECRET = 'my-secret-key';

      // Re-import to get fresh module
      const mod = await import('./authHelpers.js');
      const secret = mod.getJwtSecret();

      expect(secret).toBe('my-secret-key');
    });

    it('should throw in production when JWT_SECRET is missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      const mod = await import('./authHelpers.js');

      expect(() => mod.getJwtSecret()).toThrow('[SECURITY] JWT_SECRET missing in production');
    });

    it('should generate ephemeral secret in development', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;

      const mod = await import('./authHelpers.js');
      const secret = mod.getJwtSecret();

      expect(secret).toBeTruthy();
      expect(secret.length).toBeGreaterThan(32);
    });
  });

  describe('getApiTokenPepper', () => {
    it('should return API_TOKEN_PEPPER from environment', async () => {
      process.env.API_TOKEN_PEPPER = 'my-pepper';

      const mod = await import('./authHelpers.js');
      const pepper = mod.getApiTokenPepper();

      expect(pepper).toBe('my-pepper');
    });

    it('should throw in production when API_TOKEN_PEPPER is missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.API_TOKEN_PEPPER;

      const mod = await import('./authHelpers.js');

      expect(() => mod.getApiTokenPepper()).toThrow('[SECURITY] API_TOKEN_PEPPER missing in production');
    });
  });

  describe('setAuthCookie', () => {
    it('should set httpOnly cookie with correct options in production', () => {
      process.env.NODE_ENV = 'production';

      const mockResponse = {
        cookie: vi.fn(),
      };

      setAuthCookie(mockResponse as any, 'test-token');

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'auth_token',
        'test-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          secure: true,
          path: '/',
        }),
      );
    });

    it('should use lax sameSite in development', () => {
      process.env.NODE_ENV = 'development';

      const mockResponse = {
        cookie: vi.fn(),
      };

      setAuthCookie(mockResponse as any, 'test-token');

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'auth_token',
        'test-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
    });

    it('should respect COOKIE_SECURE=true override in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.COOKIE_SECURE = 'true';

      const mockResponse = {
        cookie: vi.fn(),
      };

      setAuthCookie(mockResponse as any, 'test-token');

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'auth_token',
        'test-token',
        expect.objectContaining({
          secure: true,
        }),
      );
    });

    it('should respect COOKIE_SECURE=false override in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.COOKIE_SECURE = 'false';

      const mockResponse = {
        cookie: vi.fn(),
      };

      setAuthCookie(mockResponse as any, 'test-token');

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'auth_token',
        'test-token',
        expect.objectContaining({
          secure: false,
        }),
      );
    });
  });

  // requireAuth no longer inspects the token itself: the session-auth
  // middleware (sessionAuth.ts) resolves it against the Session row and
  // publishes the outcome, which requireAuth reads. Token-level behaviour is
  // covered in sessionAuth.test.ts; here we pin the contract of that read —
  // above all that a request with no resolution never authenticates.
  describe('requireAuth', () => {
    const testSecret = 'test-jwt-secret';

    function resolved(auth: ResolvedAuth | null): unknown {
      const req = { cookies: {}, headers: {}, path: '/x' };
      setAuthResolution(req as any, { auth });
      return req;
    }

    beforeEach(() => {
      process.env.JWT_SECRET = testSecret;
    });

    it('should return the identity the middleware resolved', () => {
      const req = resolved({
        userId: 'user-123',
        tenantId: 'tenant-456',
        sessionId: 'sess-1',
        tokenHash: 'hash-1',
      });

      expect(requireAuth(req as any)).toEqual({ userId: 'user-123', tenantId: 'tenant-456' });
    });

    it('should return null when the middleware resolved no session', () => {
      expect(requireAuth(resolved(null) as any)).toBeNull();
    });

    it('should omit the tenant when the token carried none', () => {
      const req = resolved({ userId: 'user-789', sessionId: 'sess-2', tokenHash: 'hash-2' });

      expect(requireAuth(req as any)).toEqual({ userId: 'user-789', tenantId: undefined });
    });

    // The regression that matters: a signed, unexpired JWT is NOT authentication
    // on its own. Without the middleware there is no validated session behind
    // it, so the request must be refused rather than trusted on its signature.
    it('should fail closed when the session middleware never ran', () => {
      const token = jwt.sign({ sub: 'user-123', tid: 'tenant-456' }, testSecret);
      const req = { cookies: { auth_token: token }, headers: {}, path: '/auth/me' };

      expect(requireAuth(req as any)).toBeNull();
    });
  });

  describe('normalizeEmailForStorage', () => {
    it('should lowercase and trim email', () => {
      expect(normalizeEmailForStorage('  Test@Example.COM  ')).toBe('test@example.com');
    });

    it('should preserve plus addressing', () => {
      expect(normalizeEmailForStorage('user+tag@example.com')).toBe('user+tag@example.com');
    });
  });

  describe('normalizeEmailForMatching', () => {
    it('should lowercase and trim email', () => {
      expect(normalizeEmailForMatching('  Test@Example.COM  ')).toBe('test@example.com');
    });

    it('should remove plus addressing for matching', () => {
      expect(normalizeEmailForMatching('user+tag@example.com')).toBe('user@example.com');
    });

    it('should handle email without plus sign', () => {
      expect(normalizeEmailForMatching('user@example.com')).toBe('user@example.com');
    });

    it('should handle invalid email without @', () => {
      expect(normalizeEmailForMatching('notanemail')).toBe('notanemail');
    });
  });

  describe('computeOnlineUsageByTenantSlug (canonical distinct concurrency)', () => {
    interface RoomPlayer {
      identity?: string;
      isNpc?: boolean;
    }
    function usageRoom(tenant: string | undefined, players: RoomPlayer[]): unknown {
      const map = new Map<string, RoomPlayer>();
      players.forEach((p, i) => map.set(`s${i}`, p));
      return { metadata: tenant ? { tenant } : {}, state: { players: map } };
    }

    afterEach(() => {
      delete (global as { activeWorldRooms?: unknown }).activeWorldRooms;
    });

    it('returns an empty object when no rooms are registered', () => {
      delete (global as { activeWorldRooms?: unknown }).activeWorldRooms;
      expect(computeOnlineUsageByTenantSlug()).toEqual({});
    });

    it('counts distinct identities per tenant across multiple rooms (same identity once)', () => {
      (global as { activeWorldRooms?: unknown }).activeWorldRooms = new Set([
        usageRoom('acme', [{ identity: 'shared' }, { identity: 'a' }]),
        usageRoom('acme', [{ identity: 'shared' }, { identity: 'b' }]),
        usageRoom('beta', [{ identity: 'x' }]),
      ]);
      expect(computeOnlineUsageByTenantSlug()).toEqual({ acme: 3, beta: 1 });
    });

    it('excludes NPCs (isNpc flag and npc- prefix)', () => {
      (global as { activeWorldRooms?: unknown }).activeWorldRooms = new Set([
        usageRoom('acme', [{ identity: 'u1' }, { identity: 'bot', isNpc: true }, { identity: 'npc-x' }]),
      ]);
      expect(computeOnlineUsageByTenantSlug()).toEqual({ acme: 1 });
    });

    it('buckets rooms without tenant metadata under "default"', () => {
      (global as { activeWorldRooms?: unknown }).activeWorldRooms = new Set([
        usageRoom(undefined, [{ identity: 'u1' }]),
      ]);
      expect(computeOnlineUsageByTenantSlug()).toEqual({ default: 1 });
    });
  });
});

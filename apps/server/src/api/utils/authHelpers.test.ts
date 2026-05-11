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
import { setAuthCookie, requireAuth, normalizeEmailForStorage, normalizeEmailForMatching } from './authHelpers.js';

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

  describe('requireAuth', () => {
    const testSecret = 'test-jwt-secret';

    beforeEach(() => {
      process.env.JWT_SECRET = testSecret;
    });

    it('should return null when no token is present', () => {
      const req = { cookies: {}, headers: {} };
      const result = requireAuth(req as any);
      expect(result).toBeNull();
    });

    it('should extract userId from valid JWT in cookie', () => {
      const token = jwt.sign({ sub: 'user-123', tid: 'tenant-456' }, testSecret);
      const req = {
        cookies: { auth_token: token },
        headers: {},
      };

      const result = requireAuth(req as any);

      expect(result).toEqual({
        userId: 'user-123',
        tenantId: 'tenant-456',
      });
    });

    it('should extract userId from Authorization header', () => {
      const token = jwt.sign({ sub: 'user-789' }, testSecret);
      const req = {
        cookies: {},
        headers: { authorization: `Bearer ${token}` },
      };

      const result = requireAuth(req as any);

      expect(result).toEqual({
        userId: 'user-789',
        tenantId: undefined,
      });
    });

    it('should return null for invalid JWT', () => {
      const req = {
        cookies: { auth_token: 'invalid-token' },
        headers: {},
      };

      const result = requireAuth(req as any);

      expect(result).toBeNull();
    });

    it('should return null for expired JWT', () => {
      const token = jwt.sign({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 3600 }, testSecret);
      const req = {
        cookies: { auth_token: token },
        headers: {},
      };

      const result = requireAuth(req as any);

      expect(result).toBeNull();
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
});

/**
 * Shared shape definitions for auth and request-augmented data.
 * Centralized so per-route code does not need to re-define them or fall back to any.
 */

import type { Request } from 'express';

/**
 * Subset of cookies the server reads. cookie-parser augments Request.cookies
 * as Record<string, any>, but for our reads we narrow to the names we use.
 */
export interface ParsedCookies {
  auth_token?: string;
  [key: string]: unknown;
}

/**
 * JWT payload our auth module signs. `sub` is the user id, `tid` the tenant id.
 */
export interface AuthTokenPayload {
  sub?: string;
  tid?: string;
  [key: string]: unknown;
}

/**
 * Helper to read a typed cookies bag without leaking any into call sites.
 */
export function readCookies(req: Request): ParsedCookies {
  const raw = (req as Request & { cookies?: unknown }).cookies;
  return raw && typeof raw === 'object' ? (raw as ParsedCookies) : {};
}

/**
 * Helper to read the auth token cookie (or null).
 */
export function readAuthCookie(req: Request, name = 'auth_token'): string | null {
  const cookies = readCookies(req);
  const value = cookies[name];
  return typeof value === 'string' ? value : null;
}

/**
 * Extract the Bearer token from the Authorization header, if present.
 */
export function readBearerToken(req: Request): string | null {
  const authz = req.headers['authorization'];
  if (typeof authz !== 'string') return null;
  const trimmed = authz.replace(/^Bearer\s+/i, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

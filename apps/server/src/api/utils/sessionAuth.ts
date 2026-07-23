import type express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { readAuthCookie, readBearerToken } from '../../types/authShapes.js';
import { getJwtSecret, setAuthCookie, verifyAuthJwt } from './authHelpers.js';
import { setAuthResolution, type ResolvedAuth } from './authState.js';
import {
  getCachedSession,
  setCachedSession,
  invalidateSessionToken,
  invalidateSessionsForUser,
} from './sessionCache.js';

/**
 * Session-backed authentication: the `Session` row is the authority.
 *
 * Before this module a request was authenticated by JWT signature alone. The
 * signature says "this token was minted by us", never "this token is still
 * valid", so revoking a session (or logging out, or changing the password) left
 * the cookie fully usable for the remaining 30 days of the token's lifetime —
 * the UI reported success while the door stayed open. Sessions are now resolved
 * against the database on every request (through a short-lived cache, see
 * sessionCache.ts), so a deleted row ends the session at once.
 *
 * The two halves must stay in lockstep, which is why they live together here:
 *
 *   - {@link establishSession} is the ONLY place a session may be started. It
 *     writes the row and sets the cookie together, so no login path can hand
 *     out a token that has no revocable session behind it.
 *   - {@link createSessionAuthMiddleware} resolves the presented token against
 *     that row and publishes the result for `requireAuth` (authHelpers.ts).
 *
 * Session tokens are hashed with a bare SHA-256 (no pepper), matching the
 * existing `Session.tokenHash` rows and the hash `auth.sessions.ts` computes to
 * mark the caller's own session. The stored value is the digest of a signed,
 * high-entropy JWT, so a database dump yields nothing usable; the pepper
 * `ApiToken.hash` uses protects a comparatively low-entropy secret and would
 * additionally invalidate every session on a pepper rotation.
 */

/** Lifetime of a session row; kept in step with the JWT's `expiresIn` below. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_EXPIRES_IN = '30d';

/**
 * Minimum age of `Session.lastActiveAt` before a request refreshes it. The
 * column drives the "last active" column of the active-sessions UI, so it has
 * to move, but it must not turn every authenticated request into a write. A
 * refresh can only happen on a cache miss (at most once per session per
 * {@link SESSION_CACHE_TTL_MS}) and only past this age.
 */
const LAST_ACTIVE_REFRESH_MS = 5 * 60 * 1000;

/** Digest under which a raw session token is stored in `Session.tokenHash`. */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * The Prisma surface {@link validateSessionToken} actually needs.
 *
 * Narrower than `PrismaClient` on purpose: the Colyseus world-join gate
 * (rooms/lifecycle/onAuth.ts) carries a deliberately limited client, and a
 * `PrismaClient` requirement would have pushed it back to signature-only auth.
 * Every real `PrismaClient` satisfies it.
 */
export type SessionPrisma = Pick<PrismaClient, 'session'>;

export interface EstablishSessionParams {
  prisma: PrismaClient;
  /** Source of the audit fields (user agent, client IP). */
  req: express.Request;
  /** Receives the httpOnly auth cookie. */
  res: express.Response;
  userId: string;
  /** Tenant the session is scoped to; becomes the JWT's `tid` claim. */
  tenantId: string;
}

export interface EstablishedSession {
  /** The signed JWT. Return it in the body only for native clients. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Start a session: mint the JWT, persist the `Session` row, set the cookie.
 *
 * This is the single entry point every login path must use — password login,
 * invite redemption, guest magic link and the enterprise sign-up alike. The row
 * is written BEFORE the cookie and a failure propagates (the caller answers
 * 5xx), so a browser can never end up holding a token that the session list
 * does not show and the user cannot revoke. That inversion is the fix: session
 * recording used to be a best-effort afterthought whose failure was swallowed.
 *
 * The payload carries a random `jti`. Without it two logins of the same user
 * into the same tenant within one second produce byte-identical JWTs (`iat` has
 * second resolution) and therefore the same `tokenHash`, which collides with
 * the column's unique constraint — previously a silently dropped session row.
 *
 * @throws when the session row cannot be written. No cookie is set in that case.
 */
export async function establishSession(params: EstablishSessionParams): Promise<EstablishedSession> {
  const { prisma, req, res, userId, tenantId } = params;
  const token = jwt.sign({ sub: userId, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
  });
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash,
      userAgent: readUserAgent(req),
      ipAddress: readClientIp(req),
      expiresAt,
    },
    select: { id: true },
  });

  setAuthCookie(res, token);

  const auth: ResolvedAuth = { userId, tenantId, sessionId: session.id, tokenHash };
  setCachedSession(auth, expiresAt);
  // The request that establishes a session is itself authenticated from here
  // on, so `requireAuth` works for any work the handler still does.
  setAuthResolution(req, { auth });

  logger.info({ event: 'auth.session.established', userId, tenantId, sessionId: session.id });
  return { token, sessionId: session.id, expiresAt };
}

/**
 * Resolve a raw token (cookie or Bearer value) to a live session, or null.
 *
 * Null means: not a JWT of ours, expired signature, or — the case that matters —
 * a perfectly valid signature whose session row is gone. Exported so every
 * surface that authenticates outside the Express middleware chain (the Colyseus
 * world-join gate in rooms/lifecycle/onAuth.ts) can apply the same authority
 * instead of trusting the signature alone.
 */
export async function validateSessionToken(prisma: SessionPrisma, rawToken: string): Promise<ResolvedAuth | null> {
  const payload = verifyAuthJwt(rawToken);
  if (!payload) return null;

  const tokenHash = hashSessionToken(rawToken);
  const cached = getCachedSession(tokenHash);
  if (cached) return cached;

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, lastActiveAt: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  // Defensive: the token's subject and the row's owner must agree. They cannot
  // diverge in normal operation; if they ever do, refuse rather than guess.
  if (session.userId !== payload.userId) {
    logger.error({ event: 'auth.session.subject_mismatch', sessionId: session.id });
    return null;
  }

  const auth: ResolvedAuth = {
    userId: session.userId,
    tenantId: payload.tenantId,
    sessionId: session.id,
    tokenHash,
  };
  setCachedSession(auth, session.expiresAt);
  touchLastActive(prisma, session.id, session.lastActiveAt);
  return auth;
}

/**
 * Express middleware that resolves the request's session once and publishes the
 * result for `requireAuth`. Mount it ahead of the route table (see api.ts): a
 * route registered before it sees no resolution and `requireAuth` fails closed.
 *
 * A resolution is always recorded — including for anonymous requests and for
 * database failures, which resolve to "not authenticated" rather than passing
 * an unvalidated token through.
 */
export function createSessionAuthMiddleware(prisma: PrismaClient): express.RequestHandler {
  return (req, _res, next) => {
    const raw = readAuthCookie(req) ?? readBearerToken(req);
    if (!raw) {
      setAuthResolution(req, { auth: null });
      next();
      return;
    }
    void (async () => {
      try {
        setAuthResolution(req, { auth: await validateSessionToken(prisma, raw) });
      } catch (e: unknown) {
        // Fail closed: an unresolvable token is not an authenticated request.
        logger.error({ event: 'auth.session.resolve_failed', error: e instanceof Error ? e.message : String(e) });
        setAuthResolution(req, { auth: null });
      }
      next();
    })();
  };
}

/**
 * Delete one session of `userId` by id. Returns false when the id is unknown or
 * belongs to someone else, so callers cannot use it to probe foreign sessions.
 */
export async function revokeSessionById(prisma: PrismaClient, userId: string, sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true, tokenHash: true },
  });
  if (!session || session.userId !== userId) return false;
  await prisma.session.delete({ where: { id: sessionId } });
  invalidateSessionToken(session.tokenHash);
  return true;
}

/**
 * Delete every session of `userId`, optionally sparing the caller's own.
 *
 * Used by logout-everywhere, by the password change (which keeps the current
 * session) and by the password reset (which keeps none: a reset is the flow a
 * hijacked account recovers through, so every other foothold has to go).
 */
export async function revokeSessionsForUser(
  prisma: PrismaClient,
  userId: string,
  options: { exceptTokenHash?: string | null } = {},
): Promise<number> {
  const { exceptTokenHash } = options;
  const result = await prisma.session.deleteMany({
    where: {
      userId,
      ...(exceptTokenHash ? { tokenHash: { not: exceptTokenHash } } : {}),
    },
  });
  // Coarse but correct: the spared session is merely re-read from the row on
  // its next request. The cache never outranks the database.
  invalidateSessionsForUser(userId);
  return result.count;
}

/**
 * Drop `userId`'s already-expired session rows (housekeeping for the
 * active-sessions list, which must not show corpses).
 *
 * The only session write that legitimately performs no cache invalidation: an
 * entry is served only while `sessionExpiresAtMs > now` (see
 * {@link getCachedSession}), so a row deleted *because* it expired cannot have a
 * live cache entry behind it. It still belongs here rather than at the call
 * site — that reasoning is a property of the cache, and the boundary rule in
 * eslint.config.mjs keeps every session write in this module so the next one
 * cannot skip the question.
 */
export async function purgeExpiredSessions(prisma: PrismaClient, userId: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });
  return result.count;
}

/** Delete the single session identified by a raw token (logout). */
export async function revokeSessionByToken(prisma: PrismaClient, rawToken: string): Promise<void> {
  const tokenHash = hashSessionToken(rawToken);
  await prisma.session.deleteMany({ where: { tokenHash } });
  invalidateSessionToken(tokenHash);
}

function readUserAgent(req: express.Request): string | null {
  return req.headers['user-agent'] || null;
}

function readClientIp(req: express.Request): string | null {
  return req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0] || null;
}

/**
 * Best-effort refresh of `Session.lastActiveAt`, detached from the request.
 * A lost race with a concurrent revoke (P2025) is expected and only logged.
 */
function touchLastActive(prisma: SessionPrisma, sessionId: string, lastActiveAt: Date): void {
  if (Date.now() - lastActiveAt.getTime() < LAST_ACTIVE_REFRESH_MS) return;
  void prisma.session.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } }).catch((e: unknown) =>
    logger.warn({
      event: 'auth.session.touch_failed',
      sessionId,
      error: e instanceof Error ? e.message : String(e),
    }),
  );
}

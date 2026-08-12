import crypto from 'node:crypto';
import type express from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { requireAuth } from '../api/utils/authHelpers.js';
import { mobileStreamRateLimiter, mobileActionRateLimiter } from '../api/middleware/rateLimit.js';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';
import { mobileActionSchema } from './protocol.js';
import { MobileSession } from './mobileSession.js';
import { getOwnedSession, registerSession, removeSession } from './sessionRegistry.js';

/**
 * Gateway for native mobile clients: `GET /mobile/stream` (Server-Sent
 * Events, downstream) and `POST /mobile/action` (upstream).
 *
 * See protocol.ts for why this is SSE and not a WebSocket. The practical
 * benefit of staying on plain HTTP is that both routes sit behind the same
 * session-auth middleware, CORS policy and rate limiting as every other
 * endpoint, instead of reimplementing those guarantees on a second transport.
 *
 * Authorisation has two layers. The routes themselves require an
 * authenticated session (`requireAuth`, which is backed by a live `Session`
 * row, not merely a valid signature). On top of that, an action must name a
 * session id owned by the same user — otherwise anyone holding a valid
 * account could steer a stranger's avatar by guessing an id.
 */

const streamQuerySchema = z.object({
  /** Tenant slug, mirroring what the web client passes to its room join. */
  tenant: z.string().trim().min(1).max(200).optional(),
  /**
   * The app's zone-privacy contract version. Forwarded to the world room
   * unchanged; `onAuth` rejects the join when it is below the minimum. The
   * lower bound here is only an early, friendlier rejection — the
   * authoritative gate stays server-side in the room.
   */
  zonePrivacyVersion: z.coerce.number().int().min(MIN_ZONE_PRIVACY_CLIENT_VERSION),
});

const actionBodySchema = z.object({
  sessionId: z.string().uuid(),
  action: mobileActionSchema,
});

export function registerMobileRoutes(app: express.Express): void {
  app.get('/mobile/stream', mobileStreamRateLimiter, (req, res) => {
    void handleStream(req, res);
  });
  app.post('/mobile/action', mobileActionRateLimiter, (req, res) => {
    handleAction(req, res);
  });
}

async function handleStream(req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const parsed = streamQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }

  const authToken = readRawToken(req);
  if (!authToken) {
    // requireAuth passed, so a session exists — but the world room needs the
    // raw token to authenticate the join, and we will not mint a new one here.
    res.status(400).json({ error: 'missing_bearer_token' });
    return;
  }

  const sessionId = crypto.randomUUID();
  const session = new MobileSession({
    sessionId,
    userId: auth.userId,
    identity: auth.userId,
    serverUrl: internalServerUrl(),
    authToken,
    tenantSlug: parsed.data.tenant,
    zonePrivacyVersion: parsed.data.zonePrivacyVersion,
    res,
  });
  registerSession(session);

  const cleanup = () => {
    void removeSession(sessionId);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);

  try {
    await session.start();
    logger.info({ sessionId, userId: auth.userId }, '[mobile] session started');
  } catch (err) {
    logger.warn({ err, sessionId, userId: auth.userId }, '[mobile] world join failed');
    await removeSession(sessionId);
  }
}

function handleAction(req: express.Request, res: express.Response): void {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const parsed = actionBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_action' });
    return;
  }

  const session = getOwnedSession(parsed.data.sessionId, auth.userId);
  if (!session) {
    // Unknown and not-yours are deliberately the same answer.
    res.status(404).json({ error: 'session_not_found' });
    return;
  }

  session.handleAction(parsed.data.action);
  res.status(204).end();
}

/**
 * The raw JWT, as the world room's auth gate expects it. Bearer first — a
 * native client has no cookie jar — then the cookie, matching the precedence
 * in rooms/lifecycle/onAuth.ts.
 */
function readRawToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const value = header.slice('Bearer '.length).trim();
    if (value) return value;
  }
  // `Request.cookies` is typed `any` by the cookie-parser types, so narrow it
  // with a runtime shape check rather than an unchecked cast
  // (LIBRARY_BOUNDARIES.md pattern 3).
  const cookies: unknown = (req as { cookies?: unknown }).cookies;
  if (typeof cookies !== 'object' || cookies === null) return null;
  const token = (cookies as Record<string, unknown>).auth_token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Where the gateway reaches our own Colyseus transport. Loopback on the port
 * this process listens on: the bridge is a client of the very server it runs
 * in, which keeps the world room the single authority over presence instead
 * of introducing a second write path into it.
 */
function internalServerUrl(): string {
  const port = Number(process.env.PORT ?? 2567);
  return `http://127.0.0.1:${port}`;
}

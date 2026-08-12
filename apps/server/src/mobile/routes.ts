import crypto from 'node:crypto';
import type express from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { getTenantFromReq, requireAuth } from '../api/utils/authHelpers.js';
import { mobileStreamRateLimiter, mobileActionRateLimiter } from '../api/middleware/rateLimit.js';
import { readAuthCookie, readBearerToken } from '../types/authShapes.js';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';
import { mobileActionSchema, MOBILE_PROTOCOL_VERSION } from './protocol.js';
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
 *
 * Opt-in per deployment, same shape as `registerContactRoutes` in
 * `api/routes/contact.ts`: without `MOBILE_GATEWAY_ENABLED` set, neither
 * route is registered at all, so both paths 404 like any unknown route
 * instead of existing half-configured for whoever finds them.
 */

const streamQuerySchema = z.object({
  /**
   * The app's zone-privacy contract version. Forwarded to the world room
   * unchanged; `onAuth` rejects the join when it is below the minimum. The
   * lower bound here is only an early, friendlier rejection — the
   * authoritative gate stays server-side in the room.
   */
  zonePrivacyVersion: z.coerce.number().int().min(MIN_ZONE_PRIVACY_CLIENT_VERSION),
  /**
   * The gateway protocol the app implements. Mandatory: without it the
   * version in the `session` frame is a one-way announcement, and a bump —
   * defined above as "would break an already-shipped client" — would silently
   * hand a client a contract it does not speak.
   */
  protocolVersion: z.coerce.number().int().min(1),
});

/**
 * There is exactly one supported version today, so any difference is a
 * mismatch. Widen this into a range only together with a documented
 * compatibility promise.
 */
function isSupportedProtocol(version: number): boolean {
  return version === MOBILE_PROTOCOL_VERSION;
}

const actionBodySchema = z.object({
  sessionId: z.string().uuid(),
  action: mobileActionSchema,
});

/**
 * Mobile gateway feature gate (default OFF, opt-in). No native client has
 * ever run against a real server yet (see meetropolis-mobile), so the
 * routes stay unregistered until a deployment explicitly opts in. Accepted
 * truthy values match `avatarEditorEnabled` in `services/avatarComposer.ts`:
 * true, 1, on, yes.
 */
function mobileGatewayEnabled(): boolean {
  const raw = (process.env.MOBILE_GATEWAY_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

export function registerMobileRoutes(app: express.Express): void {
  if (!mobileGatewayEnabled()) return;

  app.get('/mobile/stream', mobileStreamRateLimiter, (req, res) => {
    void handleStream(req, res);
  });
  app.post('/mobile/action', mobileActionRateLimiter, (req, res) => {
    handleAction(req, res);
  });

  logger.info({ event: 'mobile.routes_registered' });
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

  if (!isSupportedProtocol(parsed.data.protocolVersion)) {
    // 426 rather than 400: this is not a malformed request, it is a client
    // that cannot be served correctly. The header lets the app name both
    // versions in its update prompt.
    res.status(426).set('X-Mobile-Protocol-Version', String(MOBILE_PROTOCOL_VERSION)).json({
      error: 'unsupported_protocol_version',
      supported: MOBILE_PROTOCOL_VERSION,
    });
    return;
  }

  const authToken = readRawToken(req);
  if (!authToken) {
    // requireAuth passed, so a session exists — but the world room needs the
    // raw token to authenticate the join, and we will not mint a new one here.
    res.status(400).json({ error: 'missing_bearer_token' });
    return;
  }

  // The tenant is resolved server-side, never taken from the client. Taking a
  // `?tenant=` slug used to put the app in a different Colyseus partition than
  // every web client (`filterBy(['tenant'])` matches room metadata, and an
  // absent slug never equals the room's resolved `default`), and it could
  // differ from the tenant /livekit/token and /zones resolve for the very same
  // app. `tenantMiddleware` runs for this path, so `req.tenant` is always set.
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  const sessionId = crypto.randomUUID();
  const session = new MobileSession({
    sessionId,
    userId: auth.userId,
    identity: auth.userId,
    serverUrl: internalServerUrl(),
    authToken,
    tenantSlug: tenant.slug,
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
    logger.info({ sessionId, userId: auth.userId, tenant: tenant.slug }, '[mobile] session started');
  } catch (err) {
    logger.warn({ err, sessionId, userId: auth.userId }, '[mobile] world join failed');
    // Headers and the `session` frame are already out, so the failure cannot
    // be reported as a status code. Saying it in the protocol keeps the app
    // from reading a silent EOF as a healthy, briefly-empty stream and
    // reconnecting once a second until the rate limiter answers 429.
    session.emitFailure('world_join_failed');
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
 * The raw JWT the world room's auth gate will see.
 *
 * Uses the same helpers and, crucially, the same precedence as
 * `api/utils/sessionAuth.ts`: cookie first, then bearer. `requireAuth` above
 * resolves the session through that path, so picking differently here would
 * register the session under one user while the world join authenticates as
 * another whenever a caller sends both credentials.
 */
function readRawToken(req: express.Request): string | null {
  return readAuthCookie(req) ?? readBearerToken(req);
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

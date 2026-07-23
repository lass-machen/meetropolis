import 'dotenv/config';

// Express 5 catches async route handler rejections natively; no extra polyfill needed.

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
// IMPORTANT: Colyseus and WorldRoom must come from the same module instance.
// Mixing `createRequire('colyseus')` (CJS) with `import 'colyseus'` (ESM) in
// WorldRoom.ts causes the matchmaker to compare WorldRoom.prototype.onAuth
// against the CJS Room.prototype.onAuth; they are different Function objects
// even though the source is identical. Result: Colyseus prints
//   "world"'s onAuth() defined at the instance level will be ignored.
// Worse, it then enforces auth via the (CJS) static onAuth, bypassing any
// instance-level checks. Using ESM imports everywhere keeps both sides on the
// same Room class identity, so the heuristic passes and instance hooks work.
import { Server as ColyseusServer, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { WorldRoom } from './rooms/WorldRoom.js';
import { registerApi } from './api.js';
import { logger } from './logger.js';
import { registry, metricsMiddleware } from './metrics.js';
import { tenantMiddleware } from './tenancy.js';
import { requestLogger } from './api/requestLogger.js';
import { errorHandler } from './api/errorHandler.js';
import { dynamicApiCacheControl } from './api/middleware/dynamicCacheControl.js';
import { getBillingModule } from './billingLoader.js';
import { getTelemetryModule } from './telemetryLoader.js';

// Colyseus 0.17 registers a prependListener('request', ...) on the HTTP server
// that answers CORS preflights directly with DEFAULT_CORS_HEADERS, before
// any Express middleware runs. As a result our custom headers
// (x-correlation-id, x-tenant, x-av-identity, x-av-room) do not appear on
// OPTIONS responses. Override getCorsHeaders so the custom headers are
// returned in the preflight response and the Origin is echoed correctly.
const ALLOWED_REQUEST_HEADERS =
  'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-tenant, x-correlation-id, x-av-identity, x-av-room';
matchMaker.controller.getCorsHeaders = (headers) => {
  const origin = headers.get('origin') || '*';
  const requested = headers.get('access-control-request-headers');
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': requested && requested.length > 0 ? requested : ALLOWED_REQUEST_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'x-correlation-id',
    Vary: 'Origin',
  };
};

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// First-party origins for the official Meetropolis desktop app (Tauri). Windows
// WebView2 reports `http://tauri.localhost`; macOS/Linux report `tauri://localhost`.
// These are fixed origins a browser page cannot forge (only a Tauri shell emits
// them), so allow them by default - independent of CORS_ORIGIN - so the desktop
// client never breaks when the deployed env allowlist drifts.
const DESKTOP_CLIENT_ORIGINS = ['tauri://localhost', 'http://tauri.localhost'];

/**
 * Resolve the Express `trust proxy` setting from `TRUST_PROXY`.
 *
 * `req.ip` (used for request logging and IP-based rate limiting, see
 * api/middleware/rateLimit.ts) is only trustworthy when this matches the
 * deployment topology. Behind a reverse proxy prefer a numeric hop count
 * (e.g. `1` for a single Traefik in front): Express then derives `req.ip` from
 * the proxy-verified end of `X-Forwarded-For`, which a client cannot spoof.
 * `true` trusts the entire forwarded chain and is permissive (a client can
 * forge its IP and bypass IP-based rate limiting); `false` disables proxy
 * trust for direct connections.
 *
 * Accepted values: a non-negative integer (hop count), `true` or `false`. When
 * unset the default is unchanged — trust the chain in production, none
 * otherwise; an unrecognized value falls back to that same default with a warning.
 */
function resolveTrustProxySetting(): boolean | number {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  const fallback = process.env.NODE_ENV === 'production';
  if (raw === '') return fallback;
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  logger.warn({ event: 'trust_proxy.invalid_value', value: raw, fallback });
  return fallback;
}

app.set('trust proxy', resolveTrustProxySetting());

app.use(helmet({ contentSecurityPolicy: false }));
// Force revalidation on dynamic public/billing/admin API responses (see
// dynamicCacheControl.ts). Registered before the route table (registerApi
// below) so the header lands on every matching response by default; a
// specific route handler can still override it later in the chain.
app.use(dynamicApiCacheControl);
app.use(compression());
// Prometheus HTTP metrics.
app.use(metricsMiddleware());

// CORS middleware with explicit OPTIONS handling
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Static asset routes handle their own CORS headers; skip the global check.
  if (
    req.path.startsWith('/packs') ||
    req.path.startsWith('/assets') ||
    req.path.startsWith('/npc-media') ||
    req.path.startsWith('/tools')
  ) {
    return next();
  }

  const origin = req.headers.origin as string;

  const isProduction = process.env.NODE_ENV === 'production';

  // Same-origin requests (e.g. from /tools pages) are always allowed
  const host = req.headers.host;
  const isSameOrigin = origin && host && (origin === `https://${host}` || origin === `http://${host}`);

  const isDesktopClient = !!origin && DESKTOP_CLIENT_ORIGINS.includes(origin);

  if (isDesktopClient) {
    // Official desktop app (Tauri): a fixed first-party origin, always allowed
    // regardless of CORS_ORIGIN so an env-allowlist drift never locks it out.
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (allowedOrigins.length > 0) {
    if (isSameOrigin || (origin && allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (isProduction && origin) {
      // In production, block requests from non-whitelisted origins
      logger.warn({ event: 'cors.origin_not_allowed', origin, allowedOrigins });
      return res.status(403).json({ error: 'cors_origin_not_allowed' });
    } else if (origin) {
      // Development: allow any origin even if CORS_ORIGIN is set
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else if (isProduction) {
    // SECURITY: In production, CORS_ORIGIN must be configured
    logger.error({ event: 'cors.no_whitelist_in_production', origin });
    return res.status(500).json({ error: 'cors_not_configured' });
  } else {
    // Development only: allow any origin for easier local development
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }

  // Always vary by Origin for proper CDN/proxy caching
  res.setHeader('Vary', 'Origin');
  // Credentials are needed for cookie-based auth
  // If no Origin is provided, some browsers may reject '*' with credentials.
  // We only set '*' when there's no origin and rely on proxies to strip credentials in that case.
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  // Allow requested headers dynamically, fallback to known list including custom correlation headers
  const reqHeaders = req.headers['access-control-request-headers']?.toString();
  const allowed =
    reqHeaders && reqHeaders.length > 0
      ? reqHeaders
      : 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-tenant, x-correlation-id, x-av-identity, x-av-room';
  res.setHeader('Access-Control-Allow-Headers', allowed);
  // Expose custom response headers so browsers can read them in CORS mode
  res.setHeader('Access-Control-Expose-Headers', 'x-correlation-id');

  if (req.method === 'OPTIONS') {
    // Cache preflight responses to reduce roundtrips (24h)
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  } else {
    next();
  }
});

app.use(cookieParser());

// Enterprise billing: install raw-body middleware for /billing/webhook BEFORE
// express.json() so the Stripe SDK can verify webhook signatures against the
// unmodified request body. The hook is provided by the optional
// `@meetropolis/billing` package; in OSS-only builds the module is absent and
// installEarlyMiddleware is a no-op. `compression` runs above this point and
// only touches the response side, so it does not interfere with the request
// body. This must stay BETWEEN cookieParser and express.json — moving it
// after express.json would break Stripe signature verification.
const billingModuleForEarlyHook = await getBillingModule();
billingModuleForEarlyHook?.installEarlyMiddleware?.(app);

// Enterprise telemetry: install the raw-body parser for the Signalyr event
// relay (/_signalyr) BEFORE express.json() so the relay forwards the exact
// bytes the browser SDK sent instead of a re-serialized object (the SDK's
// batch/beacon transports send Content-Type: application/json, which
// express.json would otherwise consume first). Same early-hook contract as the
// billing webhook above; in OSS-only builds the module is absent and this is a
// no-op. Warming the loader here also primes the cache that
// registerEnterpriseTelemetryRelay and /public/config reuse.
const telemetryModuleForEarlyHook = await getTelemetryModule();
telemetryModuleForEarlyHook?.installEarlyMiddleware?.(app);

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

// Tenant resolution (must run before API routes)
app.use(tenantMiddleware as unknown as express.RequestHandler);
// Request logging (after tenant to include context)
app.use(requestLogger);

app.get('/', (_req: express.Request, res: express.Response) => res.send('ok'));

// Static serving for Asset Packs.
//
// Unauthenticated by construction: no tenant (see TENANT_BYPASS_PREFIXES in
// tenancy.ts), no session check, `ACAO: *`, and `Allow-Credentials` explicitly
// removed so the response stays cacheable and cross-origin usable. Everything
// under this prefix is therefore PUBLIC to anyone who knows the path — which
// includes the per-user composed sprites in `/packs/avatars/custom/`, whose
// only protection is an unguessable uuid. The reasoning and what it would take
// to change it are documented on `customSpriteUrl` in
// services/avatarComposer.ts; do not add a gate here without reading it, the
// consumers (Phaser loader, plain <img>) cannot send credentials.
const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../public/packs');
try {
  fs.mkdirSync(packsDir, { recursive: true });
} catch (error) {
  logger.error({ event: 'filesystem.mkdir_failed', path: packsDir, error });
}
app.use(
  '/packs',
  express.static(packsDir, {
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.removeHeader('Access-Control-Allow-Credentials');
    },
  }),
);

// Static serving for default tilesets (referenced by seed maps as /assets/tilesets/...)
const assetsDir = path.resolve(__dirname, '../../../apps/web/public/assets');
app.use(
  '/assets',
  express.static(assetsDir, {
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.removeHeader('Access-Control-Allow-Credentials');
    },
  }),
);

// Static serving for NPC Media
const npcMediaDir = process.env.NPC_MEDIA_DIR || path.resolve(__dirname, '../../../npc-media');
try {
  fs.mkdirSync(npcMediaDir, { recursive: true });
} catch (error) {
  logger.error({ event: 'filesystem.mkdir_failed', path: npcMediaDir, error });
}
app.use(
  '/npc-media',
  express.static(npcMediaDir, {
    maxAge: '7d',
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.removeHeader('Access-Control-Allow-Credentials');
    },
  }),
);

// ── Basic Auth Middleware for Admin Tools ──
function basicAuthMiddleware(
  user: string,
  password: string,
): (req: express.Request, res: express.Response, next: express.NextFunction) => void {
  const expected = Buffer.from(`${user}:${password}`);
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Tools"');
      return res.status(401).send('Authentication required');
    }
    const decoded = Buffer.from(header.slice(6), 'base64');
    if (expected.length !== decoded.length || !crypto.timingSafeEqual(expected, decoded)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Tools"');
      return res.status(401).send('Invalid credentials');
    }
    next();
  };
}

// Static serving for Admin Tools (Basic Auth protected)
const toolsUser = process.env.TOOLS_USER;
const toolsPassword = process.env.TOOLS_PASSWORD;
if (toolsUser && toolsPassword) {
  const toolsDir = path.resolve(__dirname, '../../../tools');
  const htmlOnly = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path !== '/' && !req.path.endsWith('.html')) {
      return res.status(404).send('Not found');
    }
    next();
  };
  app.use('/tools', basicAuthMiddleware(toolsUser, toolsPassword), htmlOnly, express.static(toolsDir));
  logger.info({ event: 'tools.route_enabled', path: '/tools' });
} else {
  logger.info({ event: 'tools.route_disabled', reason: 'TOOLS_USER or TOOLS_PASSWORD not set' });
}

await registerApi(app);

// Expose Prometheus Metriken
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (_e) {
    res.status(500).send('metrics error');
  }
});

const port = Number(process.env.PORT ?? 2567);
const httpServer = createServer(app);
httpServer.on('error', (err) => {
  logger.error('HTTP server error', err);
});

// Attach to existing HTTP server; compatible with Colyseus 0.15+
// Colyseus Server with WebSocketTransport
const gameServer = new ColyseusServer({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define('world', WorldRoom).filterBy(['tenant']);

// Monitor can be enabled by installing @colyseus/monitor

// Make gameServer available globally for debugging.
// global.d.ts declares `var gameServer` with a narrower shape for admin queries;
// the Colyseus Server is structurally compatible at runtime, so we cast through
// unknown rather than maintaining a duplicate type.
(globalThis as unknown as { gameServer: unknown }).gameServer = gameServer;

// In Colyseus 0.17 the matchmake HTTP routes (/matchmake/joinOrCreate/...)
// are registered lazily inside `gameServer.listen()` via bindRouterToTransport.
// Calling httpServer.listen() directly would skip that wiring and leave clients
// with 404s on the matchmake endpoint. The transport shares our httpServer, so
// the bind targets the same port we configured above.
gameServer
  .listen(port, '0.0.0.0', undefined, () => {
    logger.info(`Server listening on :${port}`);
  })
  .catch((err) => {
    logger.error('Colyseus listen failed', err);
    process.exit(1);
  });

// Central error handler last
app.use(errorHandler);

// ── Graceful Shutdown ────────────────────────────────────────────────────────
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`[Server] ${signal} received, initiating graceful shutdown...`);

  const rooms = global.activeWorldRooms;
  let clientCount = 0;

  if (rooms) {
    for (const room of rooms) {
      try {
        // The WorldRoom type imported from broadcast.ts does not declare
        // `clients`, but Colyseus Rooms expose it at runtime. Read through
        // a narrow projection to count active connections.
        const colyseusRoom = room as {
          clients?: unknown[] | Set<unknown>;
          broadcast?: (event: string, data: unknown) => void;
        };
        colyseusRoom.broadcast?.('server_restart', { reason: 'update' });
        const clients = colyseusRoom.clients;
        if (Array.isArray(clients)) clientCount += clients.length;
        else if (clients instanceof Set) clientCount += clients.size;
      } catch (e) {
        logger.error('[Server] Failed to broadcast server_restart to room', e);
      }
    }
  }

  logger.info(`[Server] Notified ${clientCount} clients across ${rooms?.size ?? 0} rooms. Waiting 5s...`);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    await gameServer.gracefullyShutdown(false);
  } catch (e) {
    logger.error('[Server] Error during graceful shutdown', e);
  }

  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

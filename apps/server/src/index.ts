import 'dotenv/config';

// Express 5 catches async route handler rejections natively; no extra polyfill needed.

// Sentry must be initialized before other imports
const sentryDsn = process.env.SENTRY_DSN;
if (sentryDsn) {
  import('@sentry/node')
    .then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.1,
      });
    })
    .catch((error: unknown) => {
      // Logger not available yet - using console.error for early init failure
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Sentry] Initialization failed:', message);
    });
}

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
import { applyEnterpriseMigrationsIfPresent } from './tenancyLoader.js';
import { createPrismaClient } from './db.js';

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

app.set('trust proxy', process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production');

app.use(helmet({ contentSecurityPolicy: false }));
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

  if (allowedOrigins.length > 0) {
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
// Raw body for billing webhook (needed if enterprise billing is loaded)
app.use('/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

// Tenant resolution (must run before API routes)
app.use(tenantMiddleware as unknown as express.RequestHandler);
// Request logging (after tenant to include context)
app.use(requestLogger);

app.get('/', (_req: express.Request, res: express.Response) => res.send('ok'));

// Static serving for Asset Packs
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

// Apply enterprise schema migrations (no-op without enterprise submodule)
try {
  const migrationPrisma = createPrismaClient();
  await applyEnterpriseMigrationsIfPresent(migrationPrisma);
  await migrationPrisma.$disconnect();
} catch (e) {
  logger.error({ event: 'enterprise.migrations.failed', error: e instanceof Error ? e.message : String(e) });
  throw e;
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

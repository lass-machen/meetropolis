// Polyfill must be first import - sets Symbol.metadata for @colyseus/schema v3.x
import './polyfills.js';

import 'dotenv/config';

// express-async-errors must be imported first to catch async errors in route handlers
import 'express-async-errors';

// Sentry must be initialized before other imports
const sentryDsn = process.env.SENTRY_DSN;
if (sentryDsn) {
  import('@sentry/node').then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
    });
  }).catch((error) => {
    // Logger not available yet - using console.error for early init failure
    console.error('[Sentry] Initialization failed:', error?.message || String(error));
  });
}

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Use CJS require for Colyseus to avoid ESM interop issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Colyseus = require('colyseus');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WebSocketTransport } = require('@colyseus/ws-transport');
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
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

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

app.set('trust proxy', process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production');

app.use(helmet({ contentSecurityPolicy: false }) as any);
app.use(compression() as any);
// Prometheus HTTP-Metriken
app.use(metricsMiddleware() as any);

// CORS middleware with explicit OPTIONS handling
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const origin = req.headers.origin as string;
  
  const isProduction = process.env.NODE_ENV === 'production';

  if (allowedOrigins.length > 0) {
    if (origin && allowedOrigins.includes(origin)) {
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
  const reqHeaders = (req.headers['access-control-request-headers'] as string | undefined)?.toString();
  const allowed = reqHeaders && reqHeaders.length > 0
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

app.use(cookieParser() as any);
// Raw body for billing webhook (needed if enterprise billing is loaded)
app.use('/billing/webhook', express.raw({ type: 'application/json' }) as any);
app.use(express.json({ limit: '4mb' }) as any);
app.use(express.urlencoded({ extended: true, limit: '4mb' }) as any);

// Tenant resolution (must run before API routes)
app.use(tenantMiddleware as any);
// Request logging (after tenant to include context)
app.use(requestLogger as any);

app.get('/', (_req: express.Request, res: express.Response) => res.send('ok'));

// Static serving for Asset Packs
const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../public/packs');
try {
  fs.mkdirSync(packsDir, { recursive: true });
} catch (error) {
  logger.error({ event: 'filesystem.mkdir_failed', path: packsDir, error });
}
app.use('/packs', express.static(packsDir, {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('Access-Control-Allow-Credentials');
  }
}));

// Static serving for NPC Media
const npcMediaDir = process.env.NPC_MEDIA_DIR || path.resolve(__dirname, '../../../npc-media');
try {
  fs.mkdirSync(npcMediaDir, { recursive: true });
} catch (error) {
  logger.error({ event: 'filesystem.mkdir_failed', path: npcMediaDir, error });
}
app.use('/npc-media', express.static(npcMediaDir, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('Access-Control-Allow-Credentials');
  }
}));

await registerApi(app);

// Expose Prometheus Metriken
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (e) {
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
const gameServer = new Colyseus.Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define('world', WorldRoom as any).filterBy(['tenant']);

// Monitor can be enabled by installing @colyseus/monitor

// Make gameServer available globally for debugging
(globalThis as any).gameServer = gameServer;

httpServer.listen(port, '0.0.0.0', () => {
  logger.info(`Server listening on :${port}`);
});

// Central error handler last
app.use(errorHandler as any);

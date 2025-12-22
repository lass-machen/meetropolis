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
import bodyParser from 'body-parser';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
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
// Allow override of rate limits for local Docker testing (RATE_LIMIT_DEV=true uses lenient limits)
const isProd = process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_DEV !== 'true';
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

app.set('trust proxy', process.env.TRUST_PROXY === 'true' || isProd);

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
    } else {
      // Log blocked origins for monitoring
      if (origin) {
        logger.warn({ event: 'cors.origin_not_allowed', origin, allowedOrigins });
      }
      // In production, block requests from non-whitelisted origins
      if (isProduction && origin) {
        return res.status(403).json({ error: 'cors_origin_not_allowed' });
      }
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
    : 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-correlation-id, x-av-identity, x-av-room';
  res.setHeader('Access-Control-Allow-Headers', allowed);
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  } else {
    next();
  }
});

// Stripe Webhook requires raw body for signature verification; mount before json parser
app.use('/billing/webhook', bodyParser.raw({ type: 'application/json' }) as any);
app.use(cookieParser() as any);
app.use(express.json({ limit: '4mb' }) as any);
app.use(express.urlencoded({ extended: true, limit: '4mb' }) as any);

// Tenant resolution (must run before API routes)
app.use(tenantMiddleware as any);
// Request logging (after tenant to include context)
app.use(requestLogger as any);

// Rate limiting configuration
const rateLimitKeyGenerator = (req: any): string => {
  if (app.get('trust proxy')) {
    return req.headers['x-forwarded-for'] as string || req.ip || 'anonymous';
  }
  return req.ip || 'anonymous';
};

// Global rate limiter: 1000 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 1000 : 10000, // More lenient in dev
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: (req) => req.path === '/healthz' || req.path === '/readyz' || req.path === '/metrics',
  message: { error: 'rate_limit_exceeded', retryAfter: 900 },
});

// Auth rate limiter: 20 attempts per 15 minutes for login/register
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'too_many_auth_attempts', retryAfter: 900 },
});

// Strict rate limiter for signup/billing: 5 per hour
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isProd ? 5 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'too_many_signup_attempts', retryAfter: 3600 },
});

// API token rate limiter: 60 requests per minute
const apiTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'api_rate_limit_exceeded', retryAfter: 60 },
});

// Apply global limiter
app.use(globalLimiter as any);

// Apply strict limiters to specific paths
const authPaths = new Set(['/auth/login', '/auth/register', '/auth/forgot', '/auth/reset', '/livekit/token']);
const signupPaths = new Set(['/public/tenants', '/billing/checkout-session']);
const apiTokenPaths = new Set(['/controls']);

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (authPaths.has(req.path)) {
    return (authLimiter as unknown as express.RequestHandler)(req, res, next);
  }
  if (signupPaths.has(req.path)) {
    return (signupLimiter as unknown as express.RequestHandler)(req, res, next);
  }
  if (apiTokenPaths.has(req.path)) {
    return (apiTokenLimiter as unknown as express.RequestHandler)(req, res, next);
  }
  return next();
});

app.get('/', (_req: express.Request, res: express.Response) => res.send('ok'));

// Static serving for Asset Packs
const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../public/packs');
try {
  fs.mkdirSync(packsDir, { recursive: true });
} catch (error) {
  logger.error({ event: 'filesystem.mkdir_failed', path: packsDir, error });
}
app.use('/packs', express.static(packsDir, { maxAge: '365d', immutable: true }));

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

import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Use CJS require for Colyseus to avoid ESM interop issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Colyseus = require('colyseus');
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

const app = express();
const isProd = process.env.NODE_ENV === 'production';
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
  
  if (allowedOrigins.length > 0) {
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      // Hilft beim Betrieb: sichtbares Logging, wenn Origin nicht freigegeben ist
      if (origin) {
        try { logger.warn({ event: 'cors.origin_not_allowed', origin, allowedOrigins }); } catch {}
      }
    }
  } else {
    // Fallback: wenn keine Whitelist gesetzt ist, spiegle die Origin (besser für Credentials als '*')
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
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(cookieParser() as any);
app.use(express.json({ limit: '4mb' }) as any);
app.use(express.urlencoded({ extended: true, limit: '4mb' }) as any);

// Basic rate-limiting for sensitive endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use X-Forwarded-For when behind proxy
    if (app.get('trust proxy')) {
      return req.headers['x-forwarded-for'] as string || req.ip || 'anonymous';
    }
    return req.ip || 'anonymous';
  },
});
// Apply strict limiter only to sensitive auth write endpoints
const limitedPaths = new Set<string>([
  '/auth/login',
  '/auth/register',
  '/auth/forgot',
  '/auth/reset',
  '/livekit/token',
]);
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (limitedPaths.has(req.path)) {
    return (authLimiter as unknown as express.RequestHandler)(req, res, next);
  }
  return next();
});

app.get('/', (_req: express.Request, res: express.Response) => res.send('ok'));

// Static serving for Asset Packs
const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../public/packs');
try {
  fs.mkdirSync(packsDir, { recursive: true });
} catch {}
app.use('/packs', express.static(packsDir, { maxAge: '365d', immutable: true }));

registerApi(app);

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

// Attach to existing HTTP server; compatible with Colyseus 0.14/0.15
// Colyseus Server
const gameServer = new Colyseus.Server({ server: httpServer as any });

gameServer.define('world', WorldRoom as any);

// Monitor can be enabled by installing @colyseus/monitor

// Make gameServer available globally for debugging
(globalThis as any).gameServer = gameServer;

httpServer.listen(port, '0.0.0.0', () => {
  logger.info(`Server listening on :${port}`);
});

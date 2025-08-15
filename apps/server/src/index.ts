import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
import { WorldRoom } from './rooms/WorldRoom.js';
import { registerApi } from './api.js';

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

app.set('trust proxy', process.env.TRUST_PROXY === 'true' || isProd);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// CORS middleware with explicit OPTIONS handling
app.use((req, res, next) => {
  const origin = req.headers.origin as string;
  
  if (allowedOrigins.length > 0) {
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(cookieParser());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

// Basic rate-limiting for sensitive endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true, // Explicitly set to avoid validation error
});
app.use(['/auth', '/livekit/token'], authLimiter);

app.get('/', (_req, res) => res.send('ok'));

registerApi(app);

const port = Number(process.env.PORT ?? 2567);
const httpServer = createServer(app);
httpServer.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('HTTP server error', err);
});

// Attach to existing HTTP server; compatible with Colyseus 0.14/0.15
// Colyseus Server
const gameServer = new Colyseus.Server({ server: httpServer as any });

gameServer.define('world', WorldRoom as any);

// Monitor can be enabled by installing @colyseus/monitor

// Make gameServer available globally for debugging
(global as any).gameServer = gameServer;

httpServer.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on :${port}`);
});

import 'dotenv/config';

// Enforce the production credential policy before any application import
// below constructs clients (tenancy.ts and api.ts build database clients at
// import time), so an invalid production start stops before side effects.
import './ops/startupCredentials.js';

// Express 5 catches async route handler rejections natively; no extra polyfill needed.

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
// IMPORTANT: Colyseus and WorldRoom must come from the same module instance.
// Mixing `createRequire('@colyseus/core')` (CJS) with `import '@colyseus/core'`
// (ESM) in WorldRoom.ts causes the matchmaker to compare WorldRoom.prototype.onAuth
// against the CJS Room.prototype.onAuth; they are different Function objects
// even though the source is identical. Result: Colyseus prints
//   "world"'s onAuth() defined at the instance level will be ignored.
// Worse, it then enforces auth via the (CJS) static onAuth, bypassing any
// instance-level checks. Using ESM imports everywhere keeps both sides on the
// same Room class identity, so the heuristic passes and instance hooks work.
import { Server as ColyseusServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer, type IncomingMessage, type OutgoingHttpHeaders } from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { WorldRoom } from './rooms/WorldRoom.js';
import { getApiPrismaClient, registerApi } from './api.js';
import { warnIfPublicBaseUrlUnusable } from './api/utils/publicLinks.js';
import { logger } from './logger.js';
import { metricsMiddleware } from './metrics.js';
import { resolveMetricsBind, startMetricsServer, type MetricsServer } from './ops/metricsServer.js';
import { createToolsRoute, parseToolsApiOrigins, toolsBaseCsp } from './ops/toolsRoute.js';
import { resolvePublicPort } from './ops/startupConfigFindings.js';
import { installOriginGuard } from './ops/originGuard.js';
import { createWsUpgradeLimiter, resolveWsUpgradeLimit, type WsUpgradeLimitSettings } from './ops/wsUpgradeLimit.js';
import {
  ALLOWED_MAX_AGE,
  ALLOWED_REQUEST_HEADERS,
  ALLOWED_REQUEST_METHODS,
  EXPOSED_RESPONSE_HEADERS,
  ORIGIN_ENV_KEY,
  corsHeadersFor,
  isUpgradeOriginAllowed,
  keepsOwnCorsContract,
  resolveOriginPolicy,
} from './ops/originPolicy.js';
import { createClientCompatibilityMiddleware } from './ops/clientCompatibility.js';
import { createLegacyAssetGuard } from './ops/memberAssetRoutes.js';
import { isRestorePending } from './services/tenantDeletionRestoreMarker.js';
import { checkDeletionJournalConfig } from './services/deletionJournalConfig.js';
import { tenantMiddleware } from './tenancy.js';
import { requestLogger } from './api/requestLogger.js';
import { registerNpcMediaStatic } from './api/routes/npcMedia.js';
import { errorHandler } from './api/errorHandler.js';
import { dynamicApiCacheControl } from './api/middleware/dynamicCacheControl.js';
import { getBillingModule } from './billingLoader.js';
import { getTelemetryModule } from './telemetryLoader.js';
import { resolveTrustProxySetting } from './trustProxy.js';
import { installMatchmakeGuard } from './matchmake/guard.js';
import {
  assertValidDefaultTenantSlug,
  createTenantExistsLookup,
  installPartitionKeyValidation,
} from './matchmake/tenantPartition.js';
import { assertBaseAvatarAvailable, listenAfterStartupChecks } from './services/startupInvariant.js';
import { startDeletionTaskWorker } from './services/deletionTaskScheduler.js';
import { startAvAccessServices } from './rooms/lifecycle/avAccessServices.js';
import { createColyseusScalingOptions } from './ops/colyseusScaling.js';
import { closeSharedRedis } from './ops/redisConnection.js';
import { installSessionInvalidationRelay } from './api/utils/sessionInvalidationRelay.js';

// The origin allowlist is read once, before anything is served. A missing or
// malformed list is not a startable configuration: the server refuses to start
// and names the key, never the value. Development needs an explicit local
// list as well - there is no automatic loopback or desktop allowance.
const originConfig = resolveOriginPolicy(process.env);
if (!originConfig.ok) {
  process.stderr.write(
    `${ORIGIN_ENV_KEY} is missing or invalid: list the exact allowed origins, ` +
      'comma-separated (scheme://host[:port]).\n',
  );
  process.exit(1);
}
const originPolicy = originConfig.policy;

// The official desktop app (Tauri) reports `tauri://localhost` on macOS/Linux
// and `http://tauri.localhost` on Windows. Both are ordinary origins now: the
// deployment lists them in CORS_ORIGIN, like every other client.

// Colyseus 0.17 registers a prependListener('request', ...) on the HTTP server
// that answers CORS preflights directly with its own headers, before any
// Express middleware runs. Those headers are replaced here: the origin policy
// decides what is echoed, and a request without an allowed origin gets no CORS
// headers at all. The defaults are emptied for the same reason - they carry a
// wildcard origin together with a credentials flag.
matchMaker.controller.DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
  'Access-Control-Allow-Methods': ALLOWED_REQUEST_METHODS,
  'Access-Control-Allow-Credentials': '',
  'Access-Control-Allow-Origin': '',
  'Access-Control-Max-Age': ALLOWED_MAX_AGE,
};
matchMaker.controller.getCorsHeaders = (headers) => ({
  ...corsHeadersFor(headers.get('origin'), originPolicy),
  Vary: 'Origin',
});
// Refuse a malformed or unknown world partition key (`options.tenant`) before
// Colyseus looks for or creates a room; see matchmake/tenantPartition.ts.
installPartitionKeyValidation(createTenantExistsLookup(getApiPrismaClient));

const app = express();

const trustProxy = resolveTrustProxySetting();
app.set('trust proxy', trustProxy);

// The budget for websocket upgrades is resolved once, before the transport
// exists: a value that is set but unusable is not a startable configuration.
// The error names the key, never the value.
let wsUpgradeLimitSettings: WsUpgradeLimitSettings;
try {
  wsUpgradeLimitSettings = resolveWsUpgradeLimit(process.env);
} catch (err) {
  logger.error(err instanceof Error ? err.message : String(err), { event: 'startup.invalid_ws_upgrade_limit' });
  process.exit(1);
}

app.use(helmet({ contentSecurityPolicy: false }));
// Force revalidation on dynamic public/billing/admin API responses (see
// dynamicCacheControl.ts). Registered before the route table (registerApi
// below) so the header lands on every matching response by default; a
// specific route handler can still override it later in the chain.
app.use(dynamicApiCacheControl);
app.use(compression());
// Prometheus HTTP metrics.
app.use(metricsMiddleware());

// CORS for the Express routes. The origin guard in front of every request
// listener has already refused a foreign origin; what is left here is the
// header contract for the allowed ones. A request without an origin is not a
// browser request: it gets no CORS headers and the route's own auth decides.
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Static asset routes and the operator tools handle their own CORS headers.
  if (keepsOwnCorsContract(req.path)) {
    return next();
  }

  const origin = req.headers.origin;

  if (origin === undefined) {
    res.removeHeader('Access-Control-Allow-Origin');
    res.removeHeader('Access-Control-Allow-Credentials');
    res.removeHeader('Access-Control-Allow-Headers');
    res.removeHeader('Access-Control-Allow-Methods');
    res.removeHeader('Access-Control-Expose-Headers');
    return next();
  }

  if (!originPolicy.isAllowed(origin)) {
    logger.warn({ event: 'cors.origin_not_allowed', origin });
    return res.status(403).json({ error: 'cors_origin_not_allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_REQUEST_METHODS);
  // A fixed list of request headers, never the ones the caller asked for.
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_REQUEST_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_RESPONSE_HEADERS);
  // The answer differs per origin: extend the existing Vary header.
  res.vary('Origin');

  if (req.method === 'OPTIONS') {
    // Cache preflight responses to reduce roundtrips (24h)
    res.setHeader('Access-Control-Max-Age', ALLOWED_MAX_AGE);
    return res.sendStatus(204);
  }
  next();
});

// Outdated desktop apps get 426 once MEMBER_ASSETS_ENFORCE is on; runs after
// the CORS headers so the desktop webview can read the answer.
app.use(createClientCompatibilityMiddleware({ policy: originPolicy }));

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
  createLegacyAssetGuard(),
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

registerNpcMediaStatic(app);

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

function sendPublicMetricsNotFound(_req: express.Request, res: express.Response): void {
  res.status(404).end();
}

// Admin Tools (Basic Auth protected). Only the six allowed tool files are
// served, every other path below /tools answers 404. Every response of the
// mount carries a Content-Security-Policy; the allowed file replaces the
// fallback policy with its own, computed from its own bytes.
const toolsUser = process.env.TOOLS_USER;
const toolsPassword = process.env.TOOLS_PASSWORD;
if (toolsUser && toolsPassword) {
  const toolsDir = path.resolve(__dirname, '../../../tools');
  const toolsRoute = createToolsRoute({
    toolsDir,
    apiOrigins: parseToolsApiOrigins(process.env.TOOLS_API_ORIGINS),
  });
  app.use('/tools', toolsBaseCsp, basicAuthMiddleware(toolsUser, toolsPassword), toolsRoute);
  logger.info({ event: 'tools.route_enabled', path: '/tools' });
} else {
  logger.info({ event: 'tools.route_disabled', reason: 'TOOLS_USER or TOOLS_PASSWORD not set' });
}

// A restored database must not serve before the restore replay has run;
// scripts/replayTenantDeletions.js removes the marker when it is done.
const restoreJournalDir = process.env.DELETION_JOURNAL_DIR?.trim();
if (restoreJournalDir && (await isRestorePending(restoreJournalDir))) {
  logger.error({ event: 'tenant_delete.restore_pending' });
  process.exit(1);
}

const journalConfig = checkDeletionJournalConfig(process.env);
if (!journalConfig.ok) {
  logger.error({ event: 'deletion_journal.config_invalid', key: journalConfig.key });
  process.exit(1);
}

await registerApi(app);
warnIfPublicBaseUrlUnusable();

// Public /metrics is never a scrape target. Prometheus uses METRICS_PORT.
app.head('/metrics', sendPublicMetricsNotFound);
app.get('/metrics', sendPublicMetricsNotFound);

const port = resolvePublicPort(process.env);
const httpServer = createServer(app);
httpServer.on('error', (err) => {
  logger.error('HTTP server error', err);
});

// Attach to existing HTTP server; compatible with Colyseus 0.15+
// Colyseus Server with WebSocketTransport
const wsUpgradeLimiter = createWsUpgradeLimiter(wsUpgradeLimitSettings, trustProxy);
// With REDIS_URL set, presence, room registry and public address are shared
// across server processes; without it the server stays single-process.
const scalingOptions = createColyseusScalingOptions(process.env);
if (scalingOptions.presence) {
  installSessionInvalidationRelay(scalingOptions.presence);
}
const gameServer = new ColyseusServer({
  ...scalingOptions,
  transport: new WebSocketTransport({
    server: httpServer,
    // Every upgrade attempt is counted first, so an exhausted budget answers
    // 429 with a Retry-After instead of a handshake. Only then the origin
    // policy decides: the upgrade is refused before the handshake when it
    // carries an origin the policy does not allow. An upgrade without an
    // origin stays bound to the matchmaking auth and the seat reservation.
    verifyClient: (
      info: { origin: string | undefined; req: IncomingMessage },
      cb: (verified: boolean, code?: number, message?: string, headers?: OutgoingHttpHeaders) => void,
    ) => {
      void wsUpgradeLimiter
        .checkWsUpgrade(info.req)
        .then((decision) => {
          if (!decision.allowed) {
            cb(false, 429, 'Too Many Requests', { 'Retry-After': String(decision.retryAfterSeconds) });
            return;
          }
          if (!isUpgradeOriginAllowed(originPolicy, info.origin)) {
            cb(false);
            return;
          }
          cb(true);
        })
        .catch((error: unknown) => {
          // The counter lives in memory and cannot fail in practice. If it
          // does, the upgrade is refused instead of going uncounted; the
          // record carries no data of the attempt.
          logger.error('Websocket upgrade limit failed', error);
          cb(false);
        });
    },
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
// Before anything listens: a default tenant slug the world-join format check
// would refuse locks the installation out of its own world. Logged here with its
// own message, because the generic handler below cannot show it: the logger
// wrapper only copies an Error's enumerable fields, which has none.
try {
  assertValidDefaultTenantSlug();
} catch (err) {
  logger.error(err instanceof Error ? err.message : String(err), { event: 'startup.invalid_default_tenant_slug' });
  process.exit(1);
}

let metricsServer: MetricsServer | undefined;

async function closeMetricsListener(): Promise<void> {
  if (metricsServer === undefined) return;
  const pending = metricsServer;
  metricsServer = undefined;
  try {
    await pending.close();
  } catch (error) {
    logger.error('[Server] Error while closing metrics listener', error);
  }
}

try {
  const metricsBind = resolveMetricsBind(process.env, port);
  if (metricsBind.listen) {
    metricsServer = await startMetricsServer({ host: metricsBind.host, port: metricsBind.port });
    logger.info({ event: 'metrics.listening', port: metricsBind.port, host: metricsBind.host });
  }
  await listenAfterStartupChecks(
    () => assertBaseAvatarAvailable(getApiPrismaClient()),
    () =>
      gameServer.listen(port, '0.0.0.0', undefined, () => {
        logger.info(`Server listening on :${port}`);
      }),
  );
  // Colyseus binds its matchmake route to the HTTP server inside listen(), so
  // the guard can only be put in front of it now. No request is served in
  // between: the continuation of the awaited listen() runs before the next I/O
  // event. See matchmake/guard.ts.
  installMatchmakeGuard(httpServer, { trustProxy, originPolicy });
  // The origin guard goes in front of every request listener, so a foreign
  // origin reaches neither the matchmaking route nor the Express app.
  installOriginGuard(httpServer, { policy: originPolicy });
} catch (err) {
  logger.error('Server startup failed before listening', err);
  await closeMetricsListener();
  process.exit(1);
}

// The deletion task worker runs only when a journal directory is configured.
let deletionTaskWorker: ReturnType<typeof startDeletionTaskWorker> | undefined;
const deletionJournalDir = process.env.DELETION_JOURNAL_DIR;
if (deletionJournalDir) {
  deletionTaskWorker = startDeletionTaskWorker({
    prisma: getApiPrismaClient(),
    journalDir: deletionJournalDir,
    maxCopyLifetimeDays: process.env.BACKUP_MAX_COPY_LIFETIME_DAYS,
    retentionDays: process.env.BACKUP_RETENTION_DAYS,
  });
}

// Tenant-call access: the reconciler removes participants without a live, session-bound grant.
const avAccessServices = startAvAccessServices(getApiPrismaClient());

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
        room.broadcast('server_restart', { reason: 'update' });
        clientCount += room.clients.length;
      } catch (e) {
        logger.error('[Server] Failed to broadcast server_restart to room', e);
      }
    }
  }

  logger.info(`[Server] Notified ${clientCount} clients across ${rooms?.size ?? 0} rooms. Waiting 5s...`);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    await deletionTaskWorker?.stop();
  } catch (e) {
    logger.error({
      event: 'tenant_deletion.worker_stop_failed',
      errorName: e instanceof Error ? e.name : 'NonError',
    });
  }

  try {
    await avAccessServices.stop();
  } catch (e) {
    logger.error({
      event: 'av.reconciler_stop_failed',
      errorName: e instanceof Error ? e.name : 'NonError',
    });
  }

  try {
    await gameServer.gracefullyShutdown(false);
  } catch (e) {
    logger.error('[Server] Error during graceful shutdown', e);
  }

  try {
    await closeSharedRedis();
  } catch (e) {
    logger.error('[Server] Error closing the shared Redis client', e);
  }

  await closeMetricsListener();

  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

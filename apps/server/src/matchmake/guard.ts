import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import type { IncomingHttpHeaders, IncomingMessage, RequestListener, Server } from 'http';
import { BlockList, isIP } from 'net';
import { matchMaker } from 'colyseus';
import { createMatchmakeRateLimiter } from '../api/middleware/rateLimit.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../logger.js';
import { resolveTrustProxySetting } from '../trustProxy.js';

/**
 * Transport-level guard for Colyseus' matchmake HTTP route
 * (`POST /matchmake/<method>/<room>`).
 *
 * Colyseus answers that route from a `request` listener it prepends to the HTTP
 * server and takes the Express app out of the path for it (see
 * `bindRouterToTransport` in @colyseus/core). Express middleware therefore never
 * sees these requests: no `express.json` size cap, no rate limiter, no
 * `req.ip`. The matchmake call is also the only anonymous way to make the server
 * build a room, so this guard sits in front of it with
 *  - the project's per-IP rate limiter, resolved through the same `trust proxy`
 *    setting as the rest of the API (the server's own mobile gateway is left out,
 *    see {@link isInProcessCaller}),
 *  - a hard cap on the request body, and
 *  - a JSON-only media type.
 *
 * The parsed body is handed to Colyseus through `req.body`, which its
 * request adapter (better-call `getRequest`) reuses instead of reading the
 * stream again, so the cap also bounds what Colyseus parses.
 */

/**
 * Largest accepted matchmake request body. A real join carries a handful of
 * short fields (identity, name, tenant, avatar, map, position, a protocol
 * version, optionally a reconnection token or the NPC service token), roughly
 * 0.3 to 0.5 KB. 16 KB leaves a wide margin for growth while bounding what an
 * anonymous caller can make the server buffer and parse.
 */
export const MATCHMAKE_BODY_LIMIT_BYTES = 16 * 1024;

// Slightly wider than the one route Colyseus registers (extra leading slashes,
// any case): a request that does not match its router just 404s, so
// over-matching only costs that request a rate-limit count.
const MATCHMAKE_PATH = /^\/+matchmake(?:\/|$)/i;

export function isMatchmakeRequest(req: Pick<IncomingMessage, 'method' | 'url'>): boolean {
  // CORS preflights are answered by Colyseus itself and carry no body.
  if (req.method === 'OPTIONS') return false;
  const path = (req.url ?? '').split('?')[0] ?? '';
  return MATCHMAKE_PATH.test(path);
}

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/**
 * Whether a socket address is on the loopback interface. Takes the forms Node
 * reports: `127.x.x.x`, `::1` and, from a dual-stack listener, the mapped
 * `::ffff:127.x.x.x`. Anything that is not an IP address is not loopback.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  const family = address === undefined ? 0 : isIP(address);
  if (address === undefined || family === 0) return false;
  try {
    return LOOPBACK.check(address, family === 6 ? 'ipv6' : 'ipv4');
  } catch {
    return false;
  }
}

// Headers a reverse proxy adds. A caller that carries one has come through a
// proxy, whatever its socket address says.
const PROXY_HEADERS = [
  'x-forwarded-for',
  'forwarded',
  'x-real-ip',
  'x-client-ip',
  'x-forwarded-host',
  'x-forwarded-proto',
];

/**
 * Whether the request comes from this very process or container rather than
 * from the network: its SOCKET is on the loopback interface (`req.socket`, never
 * the address derived from X-Forwarded-For, which a client chooses) and it
 * carries no proxy header.
 *
 * That is the mobile gateway (`mobile/worldBridge.ts`), which joins the world
 * from inside the server process over `http://127.0.0.1:<port>` on behalf of
 * every mobile session. Counted per IP they would all share one budget.
 *
 * Why this cannot be reached from outside: a socket address is the peer of the
 * TCP connection, and a peer on loopback has to be in the same network
 * namespace. Measured with the official Traefik image on a Docker network, as
 * `traefik.docker.network` in the compose file sets it up: through Traefik the
 * server sees Traefik's container address as the peer (and a forged
 * `X-Forwarded-For: 127.0.0.1` from the client is overwritten), through a
 * published port the bridge gateway, from another container that container's
 * address. Only a process inside the container itself is 127.0.0.1. The compose
 * file puts the server on the `traefik` and an internal network only and
 * publishes no port.
 *
 * The proxy-header condition covers the one setup where loopback is not enough:
 * a reverse proxy on the same host as a bare-metal server also connects over
 * loopback, but it forwards the real client in `X-Forwarded-For`, so those
 * requests stay limited per client. A same-host proxy that forwards nothing
 * cannot be told from the gateway and is exempt, as it would otherwise share
 * one budget for every visitor.
 */
export function isInProcessCaller(req: Pick<IncomingMessage, 'socket' | 'headers'>): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  return PROXY_HEADERS.every((name) => req.headers[name] === undefined);
}

/**
 * How much of the body of a request refused for its size the guard still reads,
 * and throws away, before it cuts the connection.
 *
 * Closing a socket that still has unread request data makes the kernel answer
 * with a reset, and a reset can reach the client before it has read the 413.
 * Measured against this guard (900 KB body, sequential requests, real Colyseus
 * server): about one in five uploads ended in `write EPIPE` or
 * `write ECONNRESET` instead of the 413, more under CPU load. Reading the body
 * to its end is what makes the answer arrive, but it must stay bounded: this is
 * the cap, 64 times the body limit, with a time limit for a client that stalls.
 * A client that is still uploading beyond the cap is cut off and may see a
 * reset instead of the 413; that cannot be avoided without reading without
 * bound. Nothing is built either way.
 */
export const REFUSED_BODY_DRAIN_BYTES = 64 * MATCHMAKE_BODY_LIMIT_BYTES;
export const REFUSED_BODY_DRAIN_MS = 5_000;

/**
 * Read and discard the rest of a refused request body, up to
 * {@link REFUSED_BODY_DRAIN_BYTES}, then cut the connection. Called before the
 * refusal is written: it takes over the body before Node would dump it without
 * a bound once the response is finished, and the connection stays a normal
 * keep-alive one when the body ends within the cap.
 */
function discardRefusedBody(req: IncomingMessage): void {
  if (req.complete) return;
  let seen = 0;
  const stop = () => {
    clearTimeout(timer);
    req.off('data', onData);
  };
  const onData = (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > REFUSED_BODY_DRAIN_BYTES) {
      stop();
      req.socket.destroy();
    }
  };
  const timer = setTimeout(() => {
    stop();
    req.socket.destroy();
  }, REFUSED_BODY_DRAIN_MS);
  timer.unref();
  req.on('data', onData);
  req.once('end', stop);
  req.once('close', stop);
  // body-parser has paused the stream when it refused the body for its size.
  req.resume();
}

/** A refusal the guard decided on itself, rendered by {@link renderRejection}. */
class MatchmakeRejection extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

function toFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return out;
}

/**
 * The guard answers before Colyseus gets to set its CORS headers, so a refusal
 * must carry them itself or a browser could not read why a join was refused.
 */
const applyCorsHeaders: RequestHandler = (req, res, next) => {
  const cors = {
    ...matchMaker.controller.DEFAULT_CORS_HEADERS,
    ...matchMaker.controller.getCorsHeaders(toFetchHeaders(req.headers)),
  };
  for (const [name, value] of Object.entries(cors)) res.setHeader(name, value);
  next();
};

// Refuse a body that announces itself as too large without reading any of it.
// The streaming cap in express.json still covers chunked bodies and lying
// Content-Length headers.
const rejectOversizedDeclaredBody: RequestHandler = (req, _res, next) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MATCHMAKE_BODY_LIMIT_BYTES) {
    next(new MatchmakeRejection(413, 'payload_too_large'));
    return;
  }
  next();
};

// `req.is()` is null for a request without a body and false for a body of
// another type. Colyseus would otherwise read such a body unbounded. An
// explicitly empty body is no body of another type and is left alone.
const requireJsonBody: RequestHandler = (req, _res, next) => {
  if (req.headers['content-length'] !== '0' && req.is('application/json') === false) {
    next(new MatchmakeRejection(415, 'unsupported_media_type'));
    return;
  }
  next();
};

// What Node's zlib reports for a body that is not the stream its Content-Encoding
// announces. gzip and deflate: garbage (`Z_DATA_ERROR`), a stream cut off early
// (`Z_BUF_ERROR`, also what a cut-off Brotli stream gives) or one that needs a
// preset dictionary (`Z_NEED_DICT`). Brotli reports its decoder's format errors
// as `ERR__ERROR_FORMAT_<reason>` (`PADDING_1`, `CL_SPACE`, ...). All of that is
// the caller's doing. Other codes (`Z_MEM_ERROR`, a Brotli `ERR__ERROR_ALLOC_*`)
// stay server errors.
const CORRUPT_STREAM_CODES: ReadonlySet<unknown> = new Set(['Z_DATA_ERROR', 'Z_BUF_ERROR', 'Z_NEED_DICT']);
const BROTLI_FORMAT_ERROR_PREFIX = 'ERR__ERROR_FORMAT_';

function isCorruptStreamCode(code: unknown): boolean {
  return CORRUPT_STREAM_CODES.has(code) || (typeof code === 'string' && code.startsWith(BROTLI_FORMAT_ERROR_PREFIX));
}

function classify(err: unknown): { status: number; reason: string } {
  if (err instanceof MatchmakeRejection) return { status: err.status, reason: err.reason };
  if (err instanceof AppError) return { status: err.statusCode, reason: err.code.toLowerCase() };
  if (typeof err === 'object' && err !== null && 'code' in err && isCorruptStreamCode(err.code)) {
    return { status: 400, reason: 'invalid_encoding' };
  }
  // Errors raised by body-parser (http-errors) carry a `type` and a `status`.
  const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : undefined;
  switch (type) {
    case 'entity.too.large':
      return { status: 413, reason: 'payload_too_large' };
    case 'entity.parse.failed':
      return { status: 400, reason: 'invalid_json' };
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return { status: 415, reason: 'unsupported_media_type' };
    case 'request.aborted':
    case 'request.size.invalid':
    case 'stream.encoding.set':
      return { status: 400, reason: 'bad_request' };
    default:
      return { status: 500, reason: 'internal_error' };
  }
}

/**
 * Renders a refusal in the shape Colyseus' own matchmake errors use
 * (`{ code, error }`), which is what the SDK turns into its `ServerError`.
 */
const renderRejection: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const { status, reason } = classify(err);
  // Only a refusal that is the server's own fault is an error. The rest is
  // anonymous input, so it must not be able to flood the error log.
  if (status >= 500) logger.error({ event: 'matchmake.guard_error', error: err });
  else logger.debug({ event: 'matchmake.guard_refused', status, reason });
  if (res.headersSent) {
    req.socket.destroy();
    return;
  }
  // The rest of a body refused for its size is read only up to a bound, see
  // REFUSED_BODY_DRAIN_BYTES. Take it over before the answer goes out.
  if (status === 413) discardRefusedBody(req);
  res.status(status).json({ code: status, error: reason });
};

export interface MatchmakeGuardOptions {
  /** Express `trust proxy` setting used to resolve the client IP. Defaults to `TRUST_PROXY`. */
  trustProxy?: boolean | number;
  /** Replaces the per-IP rate limiter (tests). */
  rateLimiter?: RequestHandler;
  /** Callers the rate limiter leaves alone. Defaults to {@link isInProcessCaller}; tests replace it. */
  isInProcessCaller?: (req: Pick<IncomingMessage, 'socket' | 'headers'>) => boolean;
}

/** Build the guard as a request listener that hands accepted requests to `forward`. */
export function createMatchmakeGuard(forward: RequestListener, options: MatchmakeGuardOptions = {}): RequestListener {
  const guard = express();
  guard.disable('x-powered-by');
  guard.set('trust proxy', options.trustProxy ?? resolveTrustProxySetting());
  guard.use(applyCorsHeaders);
  const rateLimiter = options.rateLimiter ?? createMatchmakeRateLimiter();
  const inProcess = options.isInProcessCaller ?? isInProcessCaller;
  guard.use((req, res, next) => {
    if (inProcess(req)) next();
    else rateLimiter(req, res, next);
  });
  guard.use(rejectOversizedDeclaredBody, requireJsonBody, express.json({ limit: MATCHMAKE_BODY_LIMIT_BYTES }));
  guard.use((req, res) => {
    forward(req, res);
  });
  guard.use(renderRejection);
  return guard;
}

/**
 * Put the guard in front of every `request` listener the HTTP server has.
 *
 * Call this after Colyseus has bound its router, i.e. from the `listen`
 * callback of the game server: that is when its listener exists. Failing hard
 * when there is none keeps a future Colyseus change that binds differently from
 * silently leaving the route unguarded.
 */
export function installMatchmakeGuard(server: Server, options: MatchmakeGuardOptions = {}): void {
  const downstream = server.listeners('request') as RequestListener[];
  if (downstream.length === 0) {
    throw new Error('Matchmake guard: the HTTP server has no request listener to protect');
  }
  server.removeAllListeners('request');
  const forward: RequestListener = (req, res) => {
    for (const listener of downstream) listener.call(server, req, res);
  };
  const guard = createMatchmakeGuard(forward, options);
  server.on('request', (req, res) => {
    if (isMatchmakeRequest(req)) {
      guard(req, res);
      return;
    }
    forward(req, res);
  });
}

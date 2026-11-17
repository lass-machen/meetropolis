/**
 * Origin access over the real HTTP, matchmaking and websocket path: one
 * allowlist (CORS_ORIGIN) decides for every entry point.
 *
 * The server runs as a real child process (the same pattern as
 * metricsAccess.integration.test.ts), so the Express middleware, the Colyseus
 * matchmaking route and the websocket upgrade are the production ones. The
 * application port comes from the environment or, when that key is unset, from
 * an ephemeral loopback bind whose port is read back. Credentials are
 * generated at runtime and never logged.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..', '..');
const PORT_KEY = 'ORIGIN_ACCESS_PORT';
const READY_PATH = '/healthz';
const MATCHMAKE_PATH = '/matchmake/joinOrCreate/world';
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 20_000;
const PORT_PROBE_MS = 5_000;

/** The web client origin a deployment allows. */
const WEB_ORIGIN = 'https://app.example';
/** An origin no deployment allows. */
const FOREIGN_ORIGIN = 'https://foreign.example';
/** The two origins the official desktop app reports. */
const DESKTOP_ORIGINS: ReadonlyArray<[string, string]> = [
  ['the macOS desktop origin', 'tauri://localhost'],
  ['the Windows desktop origin', 'http://tauri.localhost'],
];

interface RunningServer {
  child: ChildProcess;
  port: number;
  metricsPort: number | undefined;
}

interface HttpProbe {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface UpgradeOutcome {
  /** The status the server answered with: 101 for an accepted handshake. */
  status: number;
  /** The socket of an accepted handshake; the caller closes it. */
  socket: Duplex | undefined;
}

describe('origin access', { timeout: 180_000 }, () => {
  let development: RunningServer;
  let production: RunningServer;
  let withoutAllowlistPort: number;

  beforeAll(async () => {
    // All listeners of this file get a port of their own: they run at the
    // same time, so the ports are reserved together and read back.
    const ports = await reserveLoopbackPorts(4);
    withoutAllowlistPort = ports[2];
    development = await startServer({
      port: ports[0],
      mode: 'development',
      origins: [WEB_ORIGIN],
      metrics: false,
      metricsPort: undefined,
    });
    production = await startServer({
      port: configuredPort() ?? ports[1],
      mode: 'production',
      origins: [WEB_ORIGIN, ...DESKTOP_ORIGINS.map(([, origin]) => origin)],
      metrics: true,
      metricsPort: ports[3],
    });
  });

  afterAll(async () => {
    await stopServer(development);
    await stopServer(production);
  });

  it('refuses a foreign origin on an express route in development', async () => {
    const result = await probe('GET', publicUrl(development, READY_PATH), { origin: FOREIGN_ORIGIN });
    expect(result.status).toBe(403);
    expect(header(result, 'access-control-allow-origin')).toBe('');
    expect(header(result, 'access-control-allow-credentials')).toBe('');
  });

  it('refuses a foreign origin on the matchmaking preflight', async () => {
    const result = await probe('OPTIONS', publicUrl(production, MATCHMAKE_PATH), {
      origin: FOREIGN_ORIGIN,
      'access-control-request-method': 'POST',
    });
    expect(result.status).toBe(403);
    expect(header(result, 'access-control-allow-origin')).toBe('');
    expect(header(result, 'access-control-allow-credentials')).toBe('');
  });

  it('does not echo an arbitrary request header', async () => {
    const result = await probe('GET', publicUrl(production, READY_PATH), {
      origin: WEB_ORIGIN,
      'access-control-request-headers': 'x-injected-header',
    });
    expect(result.status).toBe(200);
    const allowed = header(result, 'access-control-allow-headers');
    expect(allowed).not.toContain('x-injected-header');
    expect(allowed).toContain('Authorization');
  });

  it('allows the trace header the browser telemetry adds to every request', async () => {
    for (const path of [READY_PATH, MATCHMAKE_PATH]) {
      const result = await probe('OPTIONS', publicUrl(production, path), {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,traceparent',
      });
      expect(header(result, 'access-control-allow-headers').toLowerCase(), path).toContain('traceparent');
    }
  });

  it('refuses a desktop origin the allowlist does not name', async () => {
    const result = await probe('GET', publicUrl(development, READY_PATH), { origin: 'tauri://localhost' });
    expect(result.status).toBe(403);
    expect(header(result, 'access-control-allow-origin')).toBe('');
  });

  it('refuses to start in production without an origin allowlist', async () => {
    await assertPortFree(withoutAllowlistPort);
    const child = startChild({
      port: withoutAllowlistPort,
      metricsPort: undefined,
      mode: 'production',
      origins: undefined,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const outcome = await waitForListeningOrExit(child, withoutAllowlistPort);
    await stopChild(child);
    expect(outcome).toBe('exited');
    // Only a boolean, so a failure never prints what the child wrote.
    expect(stderr.includes('CORS_ORIGIN')).toBe(true);
  });

  it('refuses a websocket upgrade from a foreign origin before the handshake', async () => {
    const outcome = await upgradeHandshake(production.port, { origin: FOREIGN_ORIGIN });
    expect(outcome.status).not.toBe(101);
    expect(outcome.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a websocket upgrade with a null origin before the handshake', async () => {
    const outcome = await upgradeHandshake(production.port, { origin: 'null' });
    expect(outcome.status).not.toBe(101);
    expect(outcome.status).toBeGreaterThanOrEqual(400);
  });

  it('serves an allowed web origin with the exact allow headers', async () => {
    const result = await probe('GET', publicUrl(production, READY_PATH), { origin: WEB_ORIGIN });
    expect(result.status).toBe(200);
    expect(header(result, 'access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(header(result, 'access-control-allow-credentials')).toBe('true');
    expect(header(result, 'vary')).toContain('Origin');
  });

  it.each(DESKTOP_ORIGINS)('serves %s when the allowlist names it', async (_label, origin) => {
    const result = await probe('GET', publicUrl(production, READY_PATH), { origin });
    expect(result.status).toBe(200);
    expect(header(result, 'access-control-allow-origin')).toBe(origin);
  });

  it('leaves an originless request to the auth of the route', async () => {
    const result = await probe('GET', publicUrl(production, '/auth/me'));
    expect(result.status).toBe(401);
    expect(result.body).toContain('unauthorized');
  });

  it('accepts an originless upgrade but lets it reach no room', async () => {
    const roomsBefore = await roomCount(production);
    const outcome = await upgradeHandshake(production.port, {});
    expect(outcome.status).toBe(101);
    // The upgrade carries no seat reservation, so no room was joined and no
    // world was touched: the room counter does not move.
    expect(await roomCount(production)).toBe(roomsBefore);
    outcome.socket?.destroy();
  });

  it('serves an originless health check without cors headers', async () => {
    const result = await probe('GET', publicUrl(production, READY_PATH));
    expect(result.status).toBe(200);
    expect(header(result, 'access-control-allow-origin')).toBe('');
  });

  it('passes an originless matchmaking request on to matchmaking', async () => {
    // joinById of an unknown room: reaches matchmaking without creating a room.
    const result = await probe('POST', publicUrl(production, '/matchmake/joinById/originless-probe'), {
      'content-type': 'application/json',
    });
    expect(result.body).not.toContain('cors_origin_not_allowed');
  });
});

function publicUrl(server: RunningServer, pathname: string): string {
  return `http://127.0.0.1:${server.port}${pathname}`;
}

/**
 * A plain HTTP request with exactly the headers the test asks for. The raw
 * client is used on purpose: a higher level client may drop or rewrite the
 * headers this test is about.
 */
function probe(method: string, url: string, headers: Record<string, string> = {}): Promise<HttpProbe> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function header(probeResult: HttpProbe, name: string): string {
  const value = probeResult.headers[name];
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

/** The number of rooms the server currently holds, read from its metrics. */
async function roomCount(server: RunningServer): Promise<number> {
  if (server.metricsPort === undefined) throw new Error('the server has no metrics listener');
  const res = await fetch(`http://127.0.0.1:${server.metricsPort}/metrics`);
  const body = await res.text();
  const match = /^meetropolis_colyseus_rooms (\d+(?:\.\d+)?)$/m.exec(body);
  if (match === null) throw new Error('the metrics carry no room counter');
  return Number(match[1]);
}

/**
 * A raw websocket handshake against the server: the answer tells whether the
 * upgrade was accepted (101) or refused before the handshake.
 */
function upgradeHandshake(port: number, headers: Record<string, string>): Promise<UpgradeOutcome> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
        ...headers,
      },
    });
    request.on('upgrade', (_response, socket) => {
      // The frames of the server are of no interest here, but the socket has
      // to be drained so that its events arrive.
      socket.resume();
      resolve({ status: 101, socket });
    });
    request.on('response', (response) => {
      response.resume();
      resolve({ status: response.statusCode ?? 0, socket: undefined });
    });
    request.on('error', reject);
    request.end();
  });
}

interface ServerOptions {
  port: number;
  mode: 'development' | 'production';
  /** The allowlist of the server; absent means the key is not set at all. */
  origins: string[] | undefined;
  /** Whether the server gets a scrape listener for the room counter. */
  metrics: boolean;
  /** The port of that scrape listener. */
  metricsPort: number | undefined;
}

async function startServer(options: ServerOptions): Promise<RunningServer> {
  await assertPortFree(options.port);
  if (options.metricsPort !== undefined) await assertPortFree(options.metricsPort);
  const child = startChild({
    port: options.port,
    metricsPort: options.metricsPort,
    mode: options.mode,
    origins: options.origins,
  });
  const outcome = await waitForListeningOrExit(child, options.port);
  expect(outcome).toBe('listening');
  return { child, port: options.port, metricsPort: options.metricsPort };
}

async function stopServer(server: RunningServer | undefined): Promise<void> {
  if (server === undefined) return;
  await stopChild(server.child);
  await assertPortFree(server.port);
}

function startChild(options: {
  port: number;
  metricsPort: number | undefined;
  mode: 'development' | 'production';
  origins: string[] | undefined;
}): ChildProcess {
  const child = spawn(process.execPath, [resolveTsx(), 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: childEnv(options),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {
    // Drain so a chatty child never blocks on a full pipe.
  });
  child.stderr?.on('data', () => {
    // Drain; never echo. The child env holds runtime credentials.
  });
  return child;
}

function childEnv(options: {
  port: number;
  metricsPort: number | undefined;
  mode: 'development' | 'production';
  origins: string[] | undefined;
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    NODE_ENV: options.mode,
    NODE_OPTIONS: '--no-warnings',
    PORT: String(options.port),
    DATABASE_URL: requiredDatabaseUrl(),
    LIVEKIT_API_KEY: syntheticSecret(),
    LIVEKIT_API_SECRET: syntheticSecret(),
    JWT_SECRET: syntheticSecret(),
    API_TOKEN_PEPPER: syntheticSecret(),
    DOTENV_CONFIG_PATH: emptyEnvFile(),
    LOG_LEVEL: 'error',
  };
  if (options.origins !== undefined) env.CORS_ORIGIN = options.origins.join(',');
  if (options.metricsPort !== undefined) {
    env.METRICS_PORT = String(options.metricsPort);
    env.METRICS_HOST = '127.0.0.1';
  }
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

function requiredDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

function syntheticSecret(): string {
  return randomBytes(32).toString('hex');
}

let emptyEnvPath: string | undefined;

function emptyEnvFile(): string {
  if (emptyEnvPath === undefined) {
    emptyEnvPath = path.join(os.tmpdir(), `origin-access-empty-env-${process.pid}`);
    fs.writeFileSync(emptyEnvPath, '');
  }
  return emptyEnvPath;
}

function resolveTsx(): string {
  const scopedRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
  const packagePath = scopedRequire.resolve('tsx/package.json');
  const cliPath = path.join(path.dirname(packagePath), 'dist', 'cli.mjs');
  if (!fs.existsSync(cliPath)) {
    throw new Error('tsx runner is missing');
  }
  return cliPath;
}

/** The application port the environment names, if it names one. */
function configuredPort(): number | undefined {
  const raw = process.env[PORT_KEY];
  if (raw === undefined || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${PORT_KEY} must be set to an integer between 1 and 65535`);
  }
  return port;
}

/**
 * Reserve `count` loopback ports of their own and read them back. They are
 * held at the same time, so two listeners of this file never get the same
 * port.
 */
async function reserveLoopbackPorts(count: number): Promise<number[]> {
  const servers: net.Server[] = [];
  const ports: number[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('failed to reserve a loopback port');
      }
      ports.push(address.port);
      servers.push(server);
    }
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  }
  return ports;
}

async function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`test port ${port} did not refuse a connection in time`));
    }, PORT_PROBE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`test port ${port} is already in use; refusing a foreign process`));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      if (errnoCode(error) === 'ECONNREFUSED') {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

async function waitForListeningOrExit(child: ChildProcess, port: number): Promise<'listening' | 'exited'> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  const healthUrl = `http://127.0.0.1:${port}${READY_PATH}`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return 'exited';
    try {
      const res = await fetch(healthUrl);
      await res.text();
      return 'listening';
    } catch {
      // Not up yet.
    }
    await sleep(50);
  }
  throw new Error('server neither listened nor exited');
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      const exitTimer = setTimeout(resolve, 5_000);
      if (typeof exitTimer.unref === 'function') exitTimer.unref();
      child.once('exit', () => {
        clearTimeout(exitTimer);
        resolve();
      });
    }, STOP_TIMEOUT_MS);
    if (typeof killTimer.unref === 'function') killTimer.unref();
    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

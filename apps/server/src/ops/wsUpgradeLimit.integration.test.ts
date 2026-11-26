/**
 * Budget for the websocket upgrade path, exercised against the real server
 * process.
 *
 * Every case starts its own server, so every case begins with an empty
 * counter and the cases cannot influence each other. The server runs as a
 * child process (the same pattern as metricsAccess.integration.test.ts), so
 * the Express middleware, the Colyseus transport and the upgrade handshake
 * are the production ones. The port comes from WS_UPGRADE_TEST_PORT and has
 * to be set. Credentials are generated at runtime and never logged.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..', '..');
const PORT_KEY = 'WS_UPGRADE_TEST_PORT';
const READY_PATH = '/healthz';
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 20_000;
const PORT_PROBE_MS = 5_000;
const CLOSE_GRACE_MS = 250;

/** The origin every upgrade of this file carries; the server allows it. */
const ALLOWED_ORIGIN = 'https://ws-limit.test';

/** The budget every case of this file runs with. */
const ATTEMPT_LIMIT = 3;

interface UpgradeOutcome {
  /** The status the server answered with: 101 for an accepted handshake. */
  status: number;
  /** The headers of the answer. */
  headers: http.IncomingHttpHeaders;
  /** Whether the server closed the connection after its answer. */
  closed: boolean;
}

interface ServerOptions {
  /** The trust proxy setting of the server. */
  trustProxy: string;
  /** The upgrade budget of the server. */
  max?: string;
  /** The upgrade window of the server. */
  windowMs?: string;
}

const children: ChildProcess[] = [];

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop();
    if (child) await stopChild(child);
  }
});

describe('websocket upgrade limit', { timeout: 180_000 }, () => {
  it('refuses the upgrade that exceeds the budget', async () => {
    const port = await startServer({ trustProxy: 'false' });
    for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt++) {
      expect((await upgradeHandshake(port)).status).toBe(101);
    }
    const refused = await upgradeHandshake(port);
    expect(refused.status).toBe(429);
    expect(refused.closed).toBe(true);
    const retryAfter = refused.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(Number.isInteger(Number(retryAfter))).toBe(true);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('counts a forged forwarding header as the same client without proxy trust', async () => {
    const port = await startServer({ trustProxy: 'false' });
    for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt++) {
      const outcome = await upgradeHandshake(port, { 'x-forwarded-for': `203.0.113.${attempt}` });
      expect(outcome.status).toBe(101);
    }
    const refused = await upgradeHandshake(port, { 'x-forwarded-for': '203.0.113.200' });
    expect(refused.status).toBe(429);
  });

  it('accepts the upgrades inside the budget', async () => {
    const port = await startServer({ trustProxy: 'false' });
    for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt++) {
      expect((await upgradeHandshake(port)).status).toBe(101);
    }
  });

  it('counts a trusted forwarded client apart from another one', async () => {
    const port = await startServer({ trustProxy: '1' });
    for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt++) {
      const outcome = await upgradeHandshake(port, { 'x-forwarded-for': '198.51.100.7' });
      expect(outcome.status).toBe(101);
    }
    const other = await upgradeHandshake(port, { 'x-forwarded-for': '198.51.100.8' });
    expect(other.status).toBe(101);
  });

  it('counts ipv6 clients from different subnets apart', async () => {
    const port = await startServer({ trustProxy: '1' });
    for (const address of ['2001:db8:1:2::1', '2001:db8:2:3::1']) {
      for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt++) {
        const outcome = await upgradeHandshake(port, { 'x-forwarded-for': address });
        expect(outcome.status).toBe(101);
      }
    }
  });

  it('accepts upgrades again after the window has passed', async () => {
    const port = await startServer({ trustProxy: 'false', windowMs: '1000' });
    for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt++) {
      expect((await upgradeHandshake(port)).status).toBe(101);
    }
    await sleep(1200);
    for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt++) {
      expect((await upgradeHandshake(port)).status).toBe(101);
    }
  });
});

/**
 * One upgrade attempt against the server. The socket of an accepted
 * handshake is closed right away: the case is about the answer, not about
 * the session.
 */
function upgradeHandshake(port: number, headers: Record<string, string> = {}): Promise<UpgradeOutcome> {
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
        origin: ALLOWED_ORIGIN,
        ...headers,
      },
    });
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve({ status: 101, headers: response.headers, closed: false });
    });
    request.on('response', (response) => {
      const socket = response.socket;
      response.resume();
      let closed = socket.destroyed;
      socket.once('close', () => {
        closed = true;
      });
      response.once('end', () => {
        // The server closes the connection after a refusal; give the close
        // event the moment it needs before the answer is reported.
        setTimeout(() => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, closed });
        }, CLOSE_GRACE_MS);
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function startServer(options: ServerOptions): Promise<number> {
  const port = configuredPort();
  await assertPortFree(port);
  const child = startChild({ port, ...options });
  const outcome = await waitForListeningOrExit(child, port);
  expect(outcome).toBe('listening');
  return port;
}

function startChild(options: { port: number; trustProxy: string; max?: string; windowMs?: string }): ChildProcess {
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
  children.push(child);
  return child;
}

function childEnv(options: {
  port: number;
  trustProxy: string;
  max?: string;
  windowMs?: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    NODE_ENV: 'production',
    NODE_OPTIONS: '--no-warnings',
    PORT: String(options.port),
    // The server refuses to start without an origin allowlist. This test does
    // not exercise the origin rules, it only needs the server to come up.
    CORS_ORIGIN: ALLOWED_ORIGIN,
    TRUST_PROXY: options.trustProxy,
    WS_UPGRADE_RATE_LIMIT_MAX: options.max ?? String(ATTEMPT_LIMIT),
    DATABASE_URL: requiredDatabaseUrl(),
    LIVEKIT_API_KEY: syntheticSecret(),
    LIVEKIT_API_SECRET: syntheticSecret(),
    JWT_SECRET: syntheticSecret(),
    API_TOKEN_PEPPER: syntheticSecret(),
    DOTENV_CONFIG_PATH: emptyEnvFile(),
    LOG_LEVEL: 'error',
  };
  if (options.windowMs !== undefined) env.WS_UPGRADE_RATE_LIMIT_WINDOW_MS = options.windowMs;
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

/** The port the environment names. The tests cannot run without it. */
function configuredPort(): number {
  const raw = process.env[PORT_KEY];
  if (raw === undefined || raw === '') {
    throw new Error(`${PORT_KEY} must be set to a port for the websocket upgrade tests`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${PORT_KEY} must be set to an integer between 1 and 65535`);
  }
  return port;
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
    emptyEnvPath = path.join(os.tmpdir(), `ws-upgrade-limit-empty-env-${process.pid}`);
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

function stopChild(child: ChildProcess): Promise<void> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Access boundary for Prometheus metrics: the public app answers 404 for
 * GET/HEAD /metrics, and a separate listener (METRICS_PORT) serves scrape
 * traffic. Spawns the real server process. Ports come from the environment
 * or, if those keys are unset, from ephemeral loopback binds whose assigned
 * ports are read back. Credentials are generated at runtime and never logged.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..', '..');
const PUBLIC_PORT_KEY = 'METRICS_ACCESS_PUBLIC_PORT';
const INTERNAL_PORT_KEY = 'METRICS_ACCESS_INTERNAL_PORT';
const READY_PATH = '/healthz';
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 20_000;
const PORT_PROBE_MS = 5_000;

interface HttpProbe {
  kind: 'http';
  status: number;
  contentType: string | null;
  body: string;
}

interface ConnectionProbe {
  kind: 'connection';
  code: string;
}

type Probe = HttpProbe | ConnectionProbe;

interface RunningServer {
  child: ChildProcess;
  publicPort: number;
  metricsPort: number;
}

const children: ChildProcess[] = [];
const blockers: net.Server[] = [];

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop();
    if (child) await stopChild(child);
  }
  while (blockers.length > 0) {
    const blocker = blockers.pop();
    if (blocker) await closeServer(blocker);
  }
});

describe('metrics access', { timeout: 180_000 }, () => {
  it('returns 404 for GET /metrics on the public app', async () => {
    const server = await startServer({ metrics: true });
    const result = expectHttp(
      await probe('GET', publicUrl(server, '/metrics'), {
        cookie: 'session=synthetic-session',
        authorization: 'Basic c3ludGhldGljOnN5bnRoZXRpYw==',
      }),
    );
    expect(result.status).toBe(404);
  });

  it('returns 404 for HEAD /metrics on the public app', async () => {
    const server = await startServer({ metrics: true });
    const result = expectHttp(await probe('HEAD', publicUrl(server, '/metrics')));
    expect(result.status).toBe(404);
  });

  it('serves Prometheus metrics on the internal listener', async () => {
    const server = await startServer({ metrics: true });
    const result = expectHttp(await probe('GET', metricsUrl(server, '/metrics')));
    expect(result.status).toBe(200);
    expect(result.contentType ?? '').toContain('text/plain');
    expect(result.body).toContain('meetropolis_');
  });

  it('returns 404 for unknown paths on the internal listener', async () => {
    const server = await startServer({ metrics: true });
    const result = expectHttp(await probe('GET', metricsUrl(server, '/healthz')));
    expect(result.status).toBe(404);
    expect(result.body).not.toContain('meetropolis_');
  });

  it('starts the public app without binding the metrics port when unset', async () => {
    const server = await startServer({ metrics: false });
    const ready = expectHttp(await probe('GET', publicUrl(server, READY_PATH)));
    expect(ready.status).toBe(200);
    const metrics = await probe('GET', metricsUrl(server, '/metrics'));
    expect(metrics.kind).toBe('connection');
  });

  it('does not become ready with an invalid metrics listener configuration', async () => {
    const publicPort = await allocatePort(PUBLIC_PORT_KEY);
    const metricsPort = await allocatePort(INTERNAL_PORT_KEY);
    expect(publicPort).not.toBe(metricsPort);
    await assertPortFree(publicPort);
    await assertPortFree(metricsPort);

    const invalidPort = startChild({ publicPort, metricsPort: 'not-a-port' });
    expect(await waitForListeningOrExit(invalidPort, publicPort)).toBe('exited');
    await stopChild(invalidPort);

    const samePort = startChild({ publicPort, metricsPort: String(publicPort) });
    expect(await waitForListeningOrExit(samePort, publicPort)).toBe('exited');
    await stopChild(samePort);

    const blocker = await occupyPort(metricsPort);
    blockers.push(blocker);
    const bindFail = startChild({ publicPort, metricsPort: String(metricsPort) });
    expect(await waitForListeningOrExit(bindFail, publicPort)).toBe('exited');
    await stopChild(bindFail);
  });

  it('closes both listeners after shutdown', async () => {
    const server = await startServer({ metrics: true });
    await stopChild(server.child);
    await assertPortFree(server.publicPort);
    await assertPortFree(server.metricsPort);
  });
});

function expectHttp(result: Probe): HttpProbe {
  expect(result.kind).toBe('http');
  if (result.kind !== 'http') {
    throw new Error('expected an HTTP response');
  }
  return result;
}

function publicUrl(server: RunningServer, pathname: string): string {
  return `http://127.0.0.1:${server.publicPort}${pathname}`;
}

function metricsUrl(server: RunningServer, pathname: string): string {
  return `http://127.0.0.1:${server.metricsPort}${pathname}`;
}

async function startServer(options: { metrics: boolean }): Promise<RunningServer> {
  const publicPort = await allocatePort(PUBLIC_PORT_KEY);
  const metricsPort = await allocatePort(INTERNAL_PORT_KEY);
  expect(publicPort).not.toBe(metricsPort);
  await assertPortFree(publicPort);
  await assertPortFree(metricsPort);
  const child = startChild({
    publicPort,
    metricsPort: options.metrics ? String(metricsPort) : undefined,
  });
  const outcome = await waitForListeningOrExit(child, publicPort);
  expect(outcome).toBe('listening');
  return { child, publicPort, metricsPort };
}

function startChild(options: { publicPort: number; metricsPort: string | undefined }): ChildProcess {
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

function childEnv(options: { publicPort: number; metricsPort: string | undefined }): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    NODE_ENV: 'production',
    NODE_OPTIONS: '--no-warnings',
    PORT: String(options.publicPort),
    // The server refuses to start without an origin allowlist. This test does
    // not exercise the origin rules, it only needs the server to come up.
    CORS_ORIGIN: 'https://app.example',
    DATABASE_URL: requiredDatabaseUrl(),
    LIVEKIT_API_KEY: syntheticSecret(),
    LIVEKIT_API_SECRET: syntheticSecret(),
    JWT_SECRET: syntheticSecret(),
    API_TOKEN_PEPPER: syntheticSecret(),
    DOTENV_CONFIG_PATH: emptyEnvFile(),
    LOG_LEVEL: 'error',
  };
  if (options.metricsPort !== undefined) {
    env.METRICS_PORT = options.metricsPort;
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
    emptyEnvPath = path.join(os.tmpdir(), `metrics-access-empty-env-${process.pid}`);
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

async function allocatePort(key: string): Promise<number> {
  const raw = process.env[key];
  if (raw !== undefined && raw !== '') {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${key} must be set to an integer between 1 and 65535`);
    }
    return port;
  }
  return reserveLoopbackPort();
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('failed to reserve a loopback port'));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function assertPortFree(port: number): Promise<void> {
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

function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function waitForListeningOrExit(child: ChildProcess, publicPort: number): Promise<'listening' | 'exited'> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  const healthUrl = `http://127.0.0.1:${publicPort}${READY_PATH}`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return 'exited';
    const result = await probe('GET', healthUrl);
    if (result.kind === 'http') return 'listening';
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

async function probe(method: string, url: string, headers?: Record<string, string>): Promise<Probe> {
  try {
    const res = await fetch(url, { method, headers });
    const body = method === 'HEAD' ? '' : await res.text();
    return {
      kind: 'http',
      status: res.status,
      contentType: res.headers.get('content-type'),
      body,
    };
  } catch (error) {
    return { kind: 'connection', code: connectionCode(error) };
  }
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function connectionCode(error: unknown): string {
  const direct = errnoCode(error);
  if (direct !== undefined) return direct;
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    const nested = errnoCode(error.cause);
    if (nested !== undefined) return nested;
  }
  return 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

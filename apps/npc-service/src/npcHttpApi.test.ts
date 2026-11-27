import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serviceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const authHeader = 'x-npc-secret';
const validSecret = `test-secret-${'x'.repeat(52)}`;
const testPortKey = 'NPC_TEST_PORT';
// Fixed loopback port for the spawned service; override with NPC_TEST_PORT when it is taken.
const DEFAULT_TEST_PORT = 39731;

function getTestPort(): number {
  const raw = process.env[testPortKey];
  if (raw === undefined || raw === '') {
    return DEFAULT_TEST_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${testPortKey} must be set to an integer between 1 and 65535`);
  }
  return port;
}

function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`test port ${port} did not refuse a connection in time`));
    }, 5000);
    if (typeof timer.unref === 'function') timer.unref();
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`test port ${port} is already in use; refusing a foreign process`));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function resolveRunner(): string {
  const scopedRequire = createRequire(join(serviceDir, 'package.json'));
  const packagePath = scopedRequire.resolve('tsx/package.json');
  const cliPath = join(dirname(packagePath), 'dist', 'cli.mjs');
  if (!existsSync(cliPath)) {
    throw new Error('tsx runner not found below the service directory');
  }
  return cliPath;
}

interface RunningService {
  baseUrl: string;
  stop: () => Promise<void>;
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // Not listening yet; retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`service did not become ready at ${baseUrl}`);
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      const exitTimer = setTimeout(resolve, 5000);
      if (typeof exitTimer.unref === 'function') exitTimer.unref();
      child.once('exit', () => {
        clearTimeout(exitTimer);
        resolve();
      });
    }, 10000);
    if (typeof killTimer.unref === 'function') killTimer.unref();
    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function startService(): Promise<RunningService> {
  const port = getTestPort();
  await assertPortFree(port);
  const child = spawn(process.execPath, [resolveRunner(), 'src/index.ts'], {
    cwd: serviceDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LIVEKIT_API_KEY: 'http-probe-key',
      LIVEKIT_API_SECRET: 'http-probe-secret-at-least-32-characters',
      PORT: String(port),
      NPC_SERVICE_SECRET: validSecret,
      SERVER_URL: 'http://127.0.0.1:9',
      LOG_LEVEL: 'fatal',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {
    // Drain output so a chatty child never blocks on a full pipe.
  });
  child.stderr?.on('data', () => {
    // Drain output so a chatty child never blocks on a full pipe.
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  return { baseUrl, stop: () => stopChild(child) };
}

function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  secret: string | null = validSecret,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers[authHeader] = secret;
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('npc service command validation', () => {
  it('rejects an incomplete spawn payload before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/spawn', {
        npc: { identity: 'incomplete-spawn-probe' },
        tenantSlug: 'probe-tenant',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects a mistyped despawn payload before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/despawn', {
        identity: 123,
        tenantSlug: 'probe-tenant',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects an unknown command action before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-unknown-action/command', {
        action: 'teleport',
        tenantSlug: 'probe-tenant',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects an invalid move payload before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-bad-move/command', {
        action: 'move',
        payload: { x: 'far', y: 10 },
        tenantSlug: 'probe-tenant',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects a non-boolean dnd payload before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-bad-dnd/command', {
        action: 'set_dnd',
        payload: { dnd: 'yes' },
        tenantSlug: 'probe-tenant',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects an empty avatar payload before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-bad-avatar/command', {
        action: 'set_avatar',
        payload: { avatarId: '' },
        tenantSlug: 'probe-tenant',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects a media payload outside the media root before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-bad-media/command', {
        action: 'play_audio',
        payload: { mediaFileId: 'clip', storagePath: '../../outside.mp3' },
        tenantSlug: 'probe-tenant',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects a repeated query tenant before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-multi-tenant/command?tenant=alpha&tenant=beta', {
        action: 'stop_movement',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects a conflicting query and body tenant before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-split-tenant/command?tenant=alpha', {
        action: 'stop_movement',
        tenantSlug: 'beta',
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects an overlong tenant slug before execution', async () => {
    const service = await startService();
    try {
      const res = await postJson(service.baseUrl, '/bots/probe-long-tenant/command', {
        action: 'stop_movement',
        tenantSlug: 'a'.repeat(129),
      });
      expect(res.status).toBe(400);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('accepts valid auth for status reads', async () => {
    const service = await startService();
    try {
      const res = await fetch(`${service.baseUrl}/bots`, { headers: { [authHeader]: validSecret } });
      expect(res.status).toBe(200);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects a wrong secret', async () => {
    const service = await startService();
    try {
      const res = await fetch(`${service.baseUrl}/bots`, { headers: { [authHeader]: 'wrong-secret' } });
      expect(res.status).toBe(401);
    } finally {
      await service.stop();
    }
  }, 120000);

  it('rejects a missing secret', async () => {
    const service = await startService();
    try {
      const res = await fetch(`${service.baseUrl}/bots`);
      expect(res.status).toBe(401);
    } finally {
      await service.stop();
    }
  }, 120000);
});
